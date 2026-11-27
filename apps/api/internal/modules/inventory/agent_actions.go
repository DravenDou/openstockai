package inventory

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/quantity"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

type ActionInput struct {
	ID             string          `json:"id"`
	ConversationID string          `json:"conversationId"`
	Operation      string          `json:"operation"`
	ToolInput      json.RawMessage `json:"toolInput"`
}

var staticOperations = map[string]bool{
	"GET /v1/identity": true, "GET /v1/inventory/summary": true, "GET /v1/units": true, "GET /v1/products": true,
	"GET /v1/categories": true, "GET /v1/warehouses": true, "GET /v1/inventory": true, "GET /v1/stock-movements": true,
	"GET /v1/suppliers": true, "GET /v1/low-stock": true,
	"POST /v1/products": true, "POST /v1/categories": true, "POST /v1/warehouses": true, "POST /v1/suppliers": true,
	"POST /v1/units": true, "POST /v1/purchases": true, "POST /v1/inventory/adjustments": true,
	"POST /v1/inventory/transfers": true, "POST /v1/inventory/counts": true, "PATCH /v1/settings": true,
}

// splitOperation validates "METHOD /v1/<resource>/<id>[/<action>]" and returns its parts.
func splitOperation(operation string) (method, resource, id, action string, ok bool) {
	method, path, found := strings.Cut(operation, " ")
	if !found || !strings.HasPrefix(path, "/v1/") {
		return "", "", "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, "/v1/"), "/")
	if len(parts) < 2 || len(parts) > 3 || !validate.ID(parts[1]) {
		return "", "", "", "", false
	}
	if len(parts) == 3 {
		action = parts[2]
	}
	return method, parts[0], parts[1], action, true
}

func isLookup(resource string) bool {
	return resource == "categories" || resource == "warehouses" || resource == "suppliers"
}

// validOperation lists every operation an agent action may register.
func validOperation(operation string) bool {
	if staticOperations[operation] {
		return true
	}
	method, resource, _, action, ok := splitOperation(operation)
	if !ok {
		return false
	}
	switch {
	case method == "GET" && resource == "products" && action == "":
		return true
	case method == "PATCH" && (resource == "products" || isLookup(resource)) && action == "":
		return true
	case method == "DELETE" && (resource == "products" || isLookup(resource)) && action == "":
		return true
	case method == "POST" && resource == "products" && action == "restore":
		return true
	}
	return false
}

func (s *Service) CreateAction(ctx context.Context, t principal.Principal, in ActionInput) (any, error) {
	if t.ActorType != "ai" {
		return nil, apperror.Fail("FORBIDDEN", "Only the agent service can register tool calls.", 403)
	}
	if !validOperation(in.Operation) || !validate.ID(in.ID) || !validate.Name(in.ConversationID, 200) || !json.Valid(in.ToolInput) || len(in.ToolInput) > 65536 {
		return nil, apperror.Fail("INVALID_ACTION", "Invalid tool call.", 422)
	}
	var payload struct {
		Quantity     quantity.Amount `json:"quantity"`
		InitialStock quantity.Amount `json:"initialStock"`
	}
	_ = json.Unmarshal(in.ToolInput, &payload)
	approval := "not_required"
	if !strings.HasPrefix(in.Operation, "GET ") {
		required, err := approvalRequired(ctx, s.Q, in.Operation, payload.Quantity > 1000*quantity.Scale || payload.Quantity < -1000*quantity.Scale || payload.InitialStock > 1000*quantity.Scale)
		if err != nil {
			return nil, err
		}
		if required {
			approval = "pending"
		}
	}
	id, e := s.Q.CreateAgentAction(ctx, database.CreateAgentActionParams{ID: database.ID(in.ID), UserID: t.UserID, ConversationID: in.ConversationID, ToolName: in.Operation, ToolInput: in.ToolInput, ApprovalStatus: approval})
	if errors.Is(e, pgx.ErrNoRows) {
		old, err := s.Q.GetAgentAction(ctx, database.GetAgentActionParams{UserID: t.UserID, ID: database.ID(in.ID)})
		if err != nil {
			return nil, apperror.DomainError(err)
		}
		if old.ToolName != in.Operation || old.ConversationID != in.ConversationID || hash(old.ToolInput) != hash(in.ToolInput) {
			return nil, apperror.Fail("ACTION_MISMATCH", "The action ID already identifies a different input.", 409)
		}
		return map[string]string{"id": in.ID, "approvalStatus": old.ApprovalStatus}, nil
	}
	return map[string]string{"id": database.IDString(id), "approvalStatus": approval}, e
}
func (s *Service) ApproveAction(ctx context.Context, t principal.Principal, id string, approved bool) (any, error) {
	if t.ActorType != "human" {
		return nil, apperror.Fail("FORBIDDEN", "Approval requires a signed-in human user.", 403)
	}
	status := "rejected"
	if approved {
		status = "approved"
	}
	tx, e := database.Begin(ctx, s.Pool)
	if e != nil {
		return nil, e
	}
	defer database.Rollback(ctx, tx)
	q := s.Q.WithTx(tx)
	if _, e = q.SessionActive(ctx, database.SessionActiveParams{UserID: database.ID(t.UserID), SessionID: database.ID(t.SessionID)}); e != nil {
		return nil, apperror.Fail("FORBIDDEN", "Invalid session.", 403)
	}
	changed, e := q.ApproveAgentAction(ctx, database.ApproveAgentActionParams{UserID: t.UserID, ID: database.ID(id), ApprovalStatus: status})
	if e != nil {
		return nil, e
	}
	if changed != 1 {
		return nil, apperror.Fail("ACTION_NOT_PENDING", "The action is not pending or does not belong to the user.", 409)
	}
	result := map[string]string{"approvalStatus": status}
	e = q.RecordAudit(ctx, database.RecordAuditParams{UserID: t.UserID, ActorType: "human", Action: "approve_agent_action", ResourceType: "agent_actions", ResourceID: id, Before: []byte(`{"approvalStatus":"pending"}`), After: jsonBytes(result), Metadata: []byte(`{}`)})
	if e != nil {
		return nil, e
	}
	return result, tx.Commit(ctx)
}

// ExecuteApproved uses the exact persisted input, never an edited browser payload.
func (s *Service) ExecuteApproved(ctx context.Context, t principal.Principal, id string) (json.RawMessage, error) {
	if t.ActorType != "human" {
		return nil, apperror.Fail("FORBIDDEN", "A signed-in human user is required.", 403)
	}
	a, e := s.Q.GetAgentAction(ctx, database.GetAgentActionParams{UserID: t.UserID, ID: database.ID(id)})
	if e != nil {
		return nil, apperror.DomainError(e)
	}
	if a.ApprovalStatus != "approved" {
		return nil, apperror.Fail("APPROVAL_REQUIRED", "The action requires approval.", 409)
	}
	t.ActorType = "ai"
	t.ActionID = id
	raw := a.ToolInput
	switch a.ToolName {
	case "POST /v1/products":
		var in ProductInput
		if e = json.Unmarshal(raw, &in); e == nil {
			return s.CreateProduct(ctx, t, id, raw, in)
		}
	case "POST /v1/inventory/adjustments":
		var in Adjustment
		if e = json.Unmarshal(raw, &in); e == nil {
			return s.Adjust(ctx, t, id, raw, in)
		}
	case "POST /v1/inventory/transfers":
		var in Transfer
		if e = json.Unmarshal(raw, &in); e == nil {
			return s.Transfer(ctx, t, id, raw, in)
		}
	case "POST /v1/inventory/counts":
		var in StockCount
		if e = json.Unmarshal(raw, &in); e == nil {
			return s.CountStock(ctx, t, id, raw, in)
		}
	case "POST /v1/purchases":
		var in Purchase
		if e = json.Unmarshal(raw, &in); e == nil {
			return s.Purchase(ctx, t, id, raw, in)
		}
	case "POST /v1/units":
		var in UnitInput
		if e = json.Unmarshal(raw, &in); e == nil {
			return s.SaveUnit(ctx, t, id, raw, in)
		}
	case "PATCH /v1/settings":
		var in Settings
		if e = json.Unmarshal(raw, &in); e == nil {
			return s.SaveSettings(ctx, t, id, raw, in)
		}
	case "POST /v1/categories", "POST /v1/warehouses", "POST /v1/suppliers":
		var in LookupInput
		if e = json.Unmarshal(raw, &in); e == nil {
			return s.CreateLookup(ctx, t, id, strings.TrimPrefix(a.ToolName, "POST /v1/"), raw, in)
		}
	default:
		method, resource, target, action, ok := splitOperation(a.ToolName)
		if !ok {
			break
		}
		switch {
		case method == "PATCH" && resource == "products":
			var in ProductPatch
			if e = json.Unmarshal(raw, &in); e == nil {
				return s.UpdateProduct(ctx, t, id, target, raw, in)
			}
		case method == "PATCH" && isLookup(resource):
			var in LookupInput
			if e = json.Unmarshal(raw, &in); e == nil {
				return s.UpdateLookup(ctx, t, id, resource, target, raw, in)
			}
		case method == "DELETE" && resource == "products":
			return s.DeleteProduct(ctx, t, id, target)
		case method == "DELETE" && isLookup(resource):
			return s.DeleteLookup(ctx, t, id, resource, target)
		case method == "POST" && resource == "products" && action == "restore":
			return s.RestoreProduct(ctx, t, id, target)
		}
	}
	return nil, apperror.Fail("INVALID_ACTION", "This action cannot be executed after approval.", 422)
}

func (s *Service) CompleteReadAction(ctx context.Context, t principal.Principal, id string, result json.RawMessage, status, message string) error {
	tx, e := database.Begin(ctx, s.Pool)
	if e != nil {
		return e
	}
	defer database.Rollback(ctx, tx)
	q := s.Q.WithTx(tx)
	a, e := q.GetAgentAction(ctx, database.GetAgentActionParams{UserID: t.UserID, ID: database.ID(id)})
	if e != nil {
		return apperror.DomainError(e)
	}
	if a.Status != "pending" {
		return nil
	}
	if status == "completed" && !strings.HasPrefix(a.ToolName, "GET ") {
		return apperror.Fail("INVALID_ACTION", "Mutations complete inside their own transaction.", 409)
	}
	if len(result) == 0 {
		result = json.RawMessage(`null`)
	}
	e = q.CompleteAgentAction(ctx, database.CompleteAgentActionParams{UserID: t.UserID, ID: database.ID(id), Result: result, Status: status, Error: pgtype.Text{String: message, Valid: message != ""}})
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
