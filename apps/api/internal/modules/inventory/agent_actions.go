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

// ownerApprovalRequired is true when the owner must approve in the app: high-risk or
// destructive writes can never be approved by an MCP client.
func ownerApprovalRequired(operation string, raw []byte) bool {
	return !strings.HasPrefix(operation, "GET ") && (isHighRisk(operation, raw) || isDestructive(operation))
}

func clientID(t principal.Principal) pgtype.Text {
	return pgtype.Text{String: t.ClientID, Valid: t.ActorType == "mcp"}
}

// rejectMCPSettings keeps settings (including auto-approval) out of reach of an MCP client, which
// could otherwise register the change and approve it itself.
func rejectMCPSettings(t principal.Principal, operation string) error {
	if t.ActorType == "mcp" && operation == "PATCH /v1/settings" {
		return apperror.Fail("FORBIDDEN", "An MCP client cannot change settings. The owner changes them in the app.", 403)
	}
	return nil
}

func (s *Service) CreateAction(ctx context.Context, t principal.Principal, in ActionInput) (any, error) {
	if t.ActorType != "ai" && t.ActorType != "mcp" {
		return nil, apperror.Fail("FORBIDDEN", "Only the agent service or an MCP client can register tool calls.", 403)
	}
	if err := rejectMCPSettings(t, in.Operation); err != nil {
		return nil, err
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
	owner := ownerApprovalRequired(in.Operation, in.ToolInput)
	id, e := s.Q.CreateAgentAction(ctx, database.CreateAgentActionParams{ID: database.ID(in.ID), UserID: t.UserID, ConversationID: in.ConversationID, ToolName: in.Operation, ToolInput: in.ToolInput, ApprovalStatus: approval, ActorType: t.ActorType, ClientID: clientID(t)})
	if errors.Is(e, pgx.ErrNoRows) {
		old, err := s.Q.GetAgentAction(ctx, database.GetAgentActionParams{UserID: t.UserID, ID: database.ID(in.ID)})
		if err != nil {
			return nil, apperror.DomainError(err)
		}
		if old.ToolName != in.Operation || old.ConversationID != in.ConversationID || hash(old.ToolInput) != hash(in.ToolInput) || old.ActorType != t.ActorType || old.ClientID != clientID(t) {
			return nil, apperror.Fail("ACTION_MISMATCH", "The action ID already identifies a different input.", 409)
		}
		return map[string]any{"id": in.ID, "approvalStatus": old.ApprovalStatus, "ownerApprovalRequired": owner}, nil
	}
	return map[string]any{"id": database.IDString(id), "approvalStatus": approval, "ownerApprovalRequired": owner}, e
}

// GetAction reads one agent action. The owner sees every action; the agent sees its own
// actions; an MCP client sees only the actions its own client registered. Anything else is 404.
func (s *Service) GetAction(ctx context.Context, t principal.Principal, id string) (any, error) {
	if !validate.ID(id) {
		return nil, apperror.Fail("NOT_FOUND", "Resource not found.", 404)
	}
	a, err := s.Q.ReadAgentAction(ctx, database.ReadAgentActionParams{UserID: t.UserID, ID: database.ID(id)})
	if err != nil {
		return nil, apperror.DomainError(err)
	}
	if (t.ActorType == "ai" && a.ActorType != "ai") || (t.ActorType == "mcp" && (a.ActorType != "mcp" || a.ClientID != clientID(t))) {
		return nil, apperror.Fail("NOT_FOUND", "Resource not found.", 404)
	}
	view := map[string]any{"id": database.IDString(a.ID), "operation": a.ToolName, "toolInput": a.ToolInput, "status": a.Status, "approvalStatus": a.ApprovalStatus,
		"actorType": a.ActorType, "clientId": nil, "ownerApprovalRequired": ownerApprovalRequired(a.ToolName, a.ToolInput), "startedAt": a.StartedAt.Time, "completedAt": nil, "error": nil}
	if a.ClientID.Valid {
		view["clientId"] = a.ClientID.String
	}
	if a.CompletedAt.Valid {
		view["completedAt"] = a.CompletedAt.Time
	}
	if a.Error.Valid {
		view["error"] = a.Error.String
	}
	return view, nil
}

// ApproveAction records the owner's decision. An MCP client may decide only on its own pending
// actions, may always reject, and may approve only what is neither high-risk nor destructive.
func (s *Service) ApproveAction(ctx context.Context, t principal.Principal, id string, approved bool) (any, error) {
	if t.ActorType != "human" && t.ActorType != "mcp" {
		return nil, apperror.Fail("FORBIDDEN", "Approval requires a signed-in human user or an MCP client.", 403)
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
	metadata := []byte(`{}`)
	if t.ActorType == "human" {
		if _, e = q.SessionActive(ctx, database.SessionActiveParams{UserID: database.ID(t.UserID), SessionID: database.ID(t.SessionID)}); e != nil {
			return nil, apperror.Fail("FORBIDDEN", "Invalid session.", 403)
		}
	} else {
		if !validate.ID(id) {
			return nil, apperror.Fail("NOT_FOUND", "Resource not found.", 404)
		}
		a, e := q.GetAgentAction(ctx, database.GetAgentActionParams{UserID: t.UserID, ID: database.ID(id)})
		if e != nil {
			return nil, apperror.DomainError(e)
		}
		if a.ActorType != "mcp" || a.ClientID != clientID(t) {
			return nil, apperror.Fail("NOT_FOUND", "Resource not found.", 404)
		}
		if approved && ownerApprovalRequired(a.ToolName, a.ToolInput) {
			return nil, apperror.Fail("OWNER_APPROVAL_REQUIRED", "This operation must be approved by the owner in OpenStock.", 403)
		}
		metadata = jsonBytes(map[string]string{"agentActionId": id, "clientId": t.ClientID})
	}
	changed, e := q.ApproveAgentAction(ctx, database.ApproveAgentActionParams{UserID: t.UserID, ID: database.ID(id), ApprovalStatus: status})
	if e != nil {
		return nil, e
	}
	if changed != 1 {
		return nil, apperror.Fail("ACTION_NOT_PENDING", "The action is not pending or does not belong to the user.", 409)
	}
	result := map[string]string{"approvalStatus": status}
	e = q.RecordAudit(ctx, database.RecordAuditParams{UserID: t.UserID, ActorType: t.ActorType, Action: "approve_agent_action", ResourceType: "agent_actions", ResourceID: id, Before: []byte(`{"approvalStatus":"pending"}`), After: jsonBytes(result), Metadata: metadata})
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
