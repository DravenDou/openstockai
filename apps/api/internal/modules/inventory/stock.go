package inventory

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/quantity"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

type Adjustment struct {
	ProductID   string          `json:"productId"`
	WarehouseID string          `json:"warehouseId"`
	Quantity    quantity.Amount `json:"quantity"`
	Type        string          `json:"type"`
	Reference   string          `json:"reference"`
}

func (a Adjustment) Validate() error {
	if !validate.ID(a.ProductID) || !validate.ID(a.WarehouseID) || a.Quantity == 0 || a.Quantity > quantity.Max || a.Quantity < -quantity.Max || len(a.Reference) > 200 {
		return apperror.Fail("INVALID_ADJUSTMENT", "Provide a product, a warehouse and a valid quantity with up to three decimals.", 422)
	}
	positive := a.Type == "initial" || a.Type == "purchase" || a.Type == "adjustment_in" || a.Type == "return_in"
	negative := a.Type == "sale" || a.Type == "adjustment_out" || a.Type == "return_out"
	if (!positive && !negative) || (positive && a.Quantity < 0) || (negative && a.Quantity > 0) {
		return apperror.Fail("INVALID_MOVEMENT_TYPE", "The movement type and sign do not match.", 422)
	}
	return nil
}
func (s *Service) adjust(ctx context.Context, q *database.Queries, t principal.Principal, a Adjustment) (map[string]any, error) {
	if err := s.validateProductQuantity(ctx, q, t, a.ProductID, a.Quantity); err != nil {
		return nil, err
	}
	if err := q.EnsureInventory(ctx, database.EnsureInventoryParams{WarehouseID: database.ID(a.WarehouseID), ProductID: database.ID(a.ProductID)}); err != nil {
		return nil, err
	}
	old, err := q.LockInventory(ctx, database.LockInventoryParams{WarehouseID: database.ID(a.WarehouseID), ProductID: database.ID(a.ProductID)})
	if err != nil {
		return nil, err
	}
	next := old + a.Quantity
	if next < 0 || next > quantity.Max {
		return nil, apperror.Fail("INSUFFICIENT_STOCK", "The resulting stock balance is out of range.", 409)
	}
	if err = q.SetInventory(ctx, database.SetInventoryParams{WarehouseID: database.ID(a.WarehouseID), ProductID: database.ID(a.ProductID), Quantity: next}); err != nil {
		return nil, err
	}
	transferID := database.ID("")
	if strings.HasPrefix(a.Type, "transfer_") {
		transferID = database.ID(a.Reference)
	}
	movement, err := q.RecordMovement(ctx, database.RecordMovementParams{ProductID: database.ID(a.ProductID), WarehouseID: database.ID(a.WarehouseID), Quantity: a.Quantity, Type: a.Type, UserID: t.UserID, ActorType: t.ActorType, Reference: a.Reference, TransferID: transferID})
	return map[string]any{"id": database.IDString(movement), "before": old, "after": next, "productId": a.ProductID, "warehouseId": a.WarehouseID}, err
}
func (s *Service) Adjust(ctx context.Context, t principal.Principal, key string, raw []byte, a Adjustment) (json.RawMessage, error) {
	if err := a.Validate(); err != nil {
		return nil, err
	}
	return s.Mutate(ctx, t, key, "POST /v1/inventory/adjustments", raw, func(q *database.Queries) (Change, error) {
		if _, err := q.LockProduct(ctx, database.ID(a.ProductID)); err != nil {
			return Change{}, err
		}
		result, err := s.adjust(ctx, q, t, a)
		return Change{Result: result, Before: result["before"], ID: a.ProductID}, err
	})
}

type Transfer struct {
	ProductID       string          `json:"productId"`
	FromWarehouseID string          `json:"fromWarehouseId"`
	ToWarehouseID   string          `json:"toWarehouseId"`
	Quantity        quantity.Amount `json:"quantity"`
}

func (s *Service) Transfer(ctx context.Context, t principal.Principal, key string, raw []byte, a Transfer) (json.RawMessage, error) {
	if !validate.ID(a.ProductID) || !validate.ID(a.FromWarehouseID) || !validate.ID(a.ToWarehouseID) || a.FromWarehouseID == a.ToWarehouseID || a.Quantity <= 0 || a.Quantity > quantity.Max {
		return nil, apperror.Fail("INVALID_TRANSFER", "Select two different warehouses and a positive quantity.", 422)
	}
	return s.Mutate(ctx, t, key, "POST /v1/inventory/transfers", raw, func(q *database.Queries) (Change, error) {
		if _, err := q.LockProduct(ctx, database.ID(a.ProductID)); err != nil {
			return Change{}, err
		}
		// One product lock serializes transfers and adjustments; no opposite-direction deadlock.
		results := make([]map[string]any, 0, 2)
		for _, leg := range []struct {
			warehouse string
			quantity  quantity.Amount
			kind      string
		}{{a.FromWarehouseID, -a.Quantity, "transfer_out"}, {a.ToWarehouseID, a.Quantity, "transfer_in"}} {
			result, err := s.adjust(ctx, q, t, Adjustment{ProductID: a.ProductID, WarehouseID: leg.warehouse, Quantity: leg.quantity, Type: leg.kind, Reference: key})
			if err != nil {
				return Change{}, err
			}
			results = append(results, result)
		}
		return Change{Result: map[string]any{"id": key, "movements": results}, Before: map[string]any{"from": results[0]["before"], "to": results[1]["before"]}, ID: a.ProductID}, nil
	})
}
