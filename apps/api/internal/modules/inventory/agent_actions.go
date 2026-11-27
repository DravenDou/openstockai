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
	"GET /v1/products/by-sku": true, "GET /v1/purchases-page": true, "GET /v1/audit-page": true, "GET /v1/settings": true,
	"GET /v1/analytics/stock-valuation": true, "GET /v1/analytics/turnover": true, "GET /v1/analytics/supplier-spend": true,
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
	case method == "GET" && resource == "purchases" && action == "":
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
	approval := "not_required"
	if !strings.HasPrefix(in.Operation, "GET ") {
		required, err := approvalRequired(ctx, s.Q, in.Operation, in.ToolInput)
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
