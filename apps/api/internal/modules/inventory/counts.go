package inventory

import (
	"context"
	"encoding/json"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/quantity"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

type StockCount struct {
	ProductID   string          `json:"productId"`
	WarehouseID string          `json:"warehouseId"`
	Counted     quantity.Amount `json:"counted"`
	Expected    quantity.Amount `json:"expected"`
	Reference   string          `json:"reference"`
}

// Compare the displayed balance after locking; a stale count never overwrites a sale.
func (s *Service) CountStock(ctx context.Context, t principal.Principal, key string, raw []byte, in StockCount) (json.RawMessage, error) {
	if !validate.ID(in.ProductID) || !validate.ID(in.WarehouseID) || in.Counted < 0 || in.Counted > quantity.Max || in.Expected < 0 || in.Expected > quantity.Max || !validate.Name(in.Reference, 200) {
		return nil, apperror.Fail("INVALID_COUNT", "Check the product, warehouse, quantities and count reference.", 422)
	}
	return s.Mutate(ctx, t, key, "POST /v1/inventory/counts", raw, func(q *database.Queries) (Change, error) {
		if _, err := q.LockProduct(ctx, database.ID(in.ProductID)); err != nil {
			return Change{}, err
		}
		if err := s.validateProductQuantity(ctx, q, t, in.ProductID, in.Counted); err != nil {
			return Change{}, err
		}
		if err := q.EnsureInventory(ctx, database.EnsureInventoryParams{ProductID: database.ID(in.ProductID), WarehouseID: database.ID(in.WarehouseID)}); err != nil {
			return Change{}, err
		}
		old, err := q.LockInventory(ctx, database.LockInventoryParams{ProductID: database.ID(in.ProductID), WarehouseID: database.ID(in.WarehouseID)})
		if err != nil {
			return Change{}, err
		}
		if old != in.Expected {
			return Change{}, apperror.Fail("COUNT_STALE", "Stock changed since you opened the count. Refresh the view and check again.", 409)
		}
		difference := in.Counted - old
		if difference != 0 {
			kind := "adjustment_in"
			if difference < 0 {
				kind = "adjustment_out"
			}
			if _, err = s.adjust(ctx, q, t, Adjustment{ProductID: in.ProductID, WarehouseID: in.WarehouseID, Quantity: difference, Type: kind, Reference: in.Reference}); err != nil {
				return Change{}, err
			}
		}
		result := map[string]any{"productId": in.ProductID, "warehouseId": in.WarehouseID, "previous": old, "counted": in.Counted, "difference": difference}
		return Change{Result: result, Before: old, ID: in.ProductID}, nil
	})
}
