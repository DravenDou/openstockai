package inventory

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

func jsonBytes(v any) []byte { b, _ := json.Marshal(v); return b }
func hash(raw []byte) string {
	var v any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&v) == nil {
		raw = jsonBytes(v)
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

type Change struct {
	Result, Before any
	After          any
	ID             string
}

// Mutate claims the retry key and commits stock, ledger, audit and the response together.
func (s *Service) Mutate(ctx context.Context, t principal.Principal, key, operation string, raw []byte, fn func(*database.Queries) (Change, error)) (json.RawMessage, error) {
	if err := rejectMCPSettings(t, operation); err != nil {
		return nil, err
	}
	if !validate.ID(key) {
		return nil, apperror.Fail("IDEMPOTENCY_REQUIRED", "Send an Idempotency-Key header containing a UUID.", 400)
	}
	tx, err := database.Begin(ctx, s.Pool)
	if err != nil {
		return nil, err
	}
	defer database.Rollback(ctx, tx)
	q := s.Q.WithTx(tx)
	if t.ActorType != "mcp" {
		if _, err = q.SessionActive(ctx, database.SessionActiveParams{UserID: database.ID(t.UserID), SessionID: database.ID(t.SessionID)}); err != nil {
			return nil, apperror.Fail("FORBIDDEN", "The session is no longer valid.", 403)
		}
	}
	if err = q.ClaimIdempotency(ctx, database.ClaimIdempotencyParams{UserID: t.UserID, Key: database.ID(key), Operation: operation, RequestHash: hash(raw)}); err != nil {
		return nil, err
	}
	claim, err := q.LockIdempotency(ctx, database.LockIdempotencyParams{UserID: t.UserID, Key: database.ID(key)})
	if err != nil {
		return nil, err
	}
	if claim.Operation != operation || claim.RequestHash != hash(raw) {
		return nil, apperror.Fail("IDEMPOTENCY_CONFLICT", "The key was already used for a different operation.", 409)
	}
	if len(claim.Response) > 0 {
		return json.RawMessage(claim.Response), tx.Commit(ctx)
	}
	agentic := t.ActorType == "ai" || t.ActorType == "mcp"
	if agentic {
		if !validate.ID(t.ActionID) {
			return nil, apperror.Fail("ACTION_REQUIRED", "The tool must register its action before it runs.", 400)
		}
		action, e := q.GetAgentAction(ctx, database.GetAgentActionParams{UserID: t.UserID, ID: database.ID(t.ActionID)})
		if e != nil {
			return nil, apperror.DomainError(e)
		}
		if action.ActorType != t.ActorType || (t.ActorType == "mcp" && action.ClientID != clientID(t)) || action.ToolName != operation || hash(action.ToolInput) != hash(raw) || action.Status != "pending" {
			return nil, apperror.Fail("ACTION_MISMATCH", "The action does not match this operation.", 409)
		}
		if action.ApprovalStatus == "rejected" {
			return nil, apperror.Fail("ACTION_REJECTED", "The action was rejected.", 403)
		}
		required, e := approvalRequired(ctx, q, operation, raw)
		if e != nil {
			return nil, e
		}
		if required && action.ApprovalStatus == "not_required" {
			return nil, apperror.Fail("ACTION_STALE", "The approval settings changed. Request the operation again to confirm it.", 409)
		}
		if (required || action.ApprovalStatus == "pending") && action.ApprovalStatus != "approved" {
			return nil, apperror.Fail("APPROVAL_REQUIRED", "Confirm this sensitive operation before it runs.", 409)
		}
	}
	change, err := fn(q)
	if err != nil {
		return nil, apperror.DomainError(err)
	}
	result := jsonBytes(change.Result)
	after := change.After
	if after == nil {
		after = change.Result
	}
	metadata := map[string]string{"idempotencyKey": key, "agentActionId": t.ActionID}
	if t.ActorType == "mcp" {
		metadata["clientId"] = t.ClientID
	}
	if err = q.RecordAudit(ctx, database.RecordAuditParams{UserID: t.UserID, ActorType: t.ActorType, Action: operation, ResourceType: strings.Split(operation, "/")[2], ResourceID: change.ID, Before: jsonBytes(change.Before), After: jsonBytes(after), Metadata: jsonBytes(metadata)}); err != nil {
		return nil, err
	}
	if agentic {
		if err = q.CompleteAgentAction(ctx, database.CompleteAgentActionParams{UserID: t.UserID, ID: database.ID(t.ActionID), Result: result, Status: "completed"}); err != nil {
			return nil, err
		}
	}
	if err = q.CompleteIdempotency(ctx, database.CompleteIdempotencyParams{UserID: t.UserID, Key: database.ID(key), Response: result}); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}
