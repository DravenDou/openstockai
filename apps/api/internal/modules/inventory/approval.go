package inventory

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
)

// isDestructive reports whether an operation deletes, archives or restores data.
// These always need human confirmation, even when auto-approval is enabled.
func isDestructive(operation string) bool {
	method, path, _ := strings.Cut(operation, " ")
	return method == "DELETE" || strings.HasSuffix(path, "/archive") || strings.HasSuffix(path, "/restore")
}

// needsApproval is the approval policy: confirmation is needed when auto-approval
// is off, when the operation is high-risk, or when it is destructive.
func needsApproval(autoApprove bool, operation string, highRisk bool) bool {
	return !autoApprove || highRisk || isDestructive(operation)
}

// approvalRequired applies the policy using the current settings row. It is checked
// both when an agent action is registered and inside the mutation transaction.
func approvalRequired(ctx context.Context, q *database.Queries, operation string, highRisk bool) (bool, error) {
	if highRisk || isDestructive(operation) {
		return true, nil
	}
	settings, err := q.GetSettings(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	var preferences struct {
		Automatic *bool `json:"automatic"`
	}
	if err := json.Unmarshal(settings, &preferences); err != nil {
		return false, err
	}
	return needsApproval(preferences.Automatic == nil || *preferences.Automatic, operation, highRisk), nil
}
