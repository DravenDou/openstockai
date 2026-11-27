package inventory

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/quantity"
)

// highRiskQuantity is the quantity above which a stock write always needs confirmation.
const highRiskQuantity = 1000 * quantity.Scale

func abs(a quantity.Amount) quantity.Amount {
	if a < 0 {
		return -a
	}
	return a
}

// isHighRisk is the single source of truth for quantity-based risk. It is used when an
// agent action is registered and again inside the mutation transaction, so both always
// agree. raw is the exact JSON body of the operation. Input that cannot be parsed is
// treated as high risk so it can never skip confirmation.
func isHighRisk(operation string, raw []byte) bool {
	switch operation {
	case "POST /v1/inventory/adjustments", "POST /v1/inventory/transfers":
		var in struct {
			Quantity quantity.Amount `json:"quantity"`
		}
		return json.Unmarshal(raw, &in) != nil || abs(in.Quantity) > highRiskQuantity
	case "POST /v1/products":
		var in struct {
			InitialStock quantity.Amount `json:"initialStock"`
		}
		return json.Unmarshal(raw, &in) != nil || abs(in.InitialStock) > highRiskQuantity
	case "POST /v1/inventory/counts":
		var in struct {
			Counted  quantity.Amount `json:"counted"`
			Expected quantity.Amount `json:"expected"`
		}
		return json.Unmarshal(raw, &in) != nil || abs(in.Counted) > highRiskQuantity || abs(in.Expected) > highRiskQuantity
	case "POST /v1/purchases":
		var in struct {
			Items []struct {
				Quantity quantity.Amount `json:"quantity"`
			} `json:"items"`
		}
		if json.Unmarshal(raw, &in) != nil {
			return true
		}
		var total quantity.Amount
		for _, item := range in.Items {
			total += abs(item.Quantity)
		}
		return total > highRiskQuantity
	}
	return false
}

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
// both when an agent action is registered and inside the mutation transaction, with
// the same operation and raw input, so the two decisions cannot diverge.
func approvalRequired(ctx context.Context, q *database.Queries, operation string, raw []byte) (bool, error) {
	highRisk := isHighRisk(operation, raw)
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
	return needsApproval(preferences.Automatic != nil && *preferences.Automatic, operation, highRisk), nil
}
