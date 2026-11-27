package inventory

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/quantity"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

type PurchaseItem struct {
	ProductID string          `json:"productId"`
	Product   *ProductInput   `json:"product"`
	Quantity  quantity.Amount `json:"quantity"`
	CostPrice string          `json:"costPrice"`
}
type Purchase struct {
	WarehouseID string         `json:"warehouseId"`
	SupplierID  string         `json:"supplierId"`
	Reference   string         `json:"reference"`
	Items       []PurchaseItem `json:"items"`
}

func (s *Service) Purchase(ctx context.Context, t principal.Principal, key string, raw []byte, in Purchase) (json.RawMessage, error) {
	if !validate.ID(in.WarehouseID) || (in.SupplierID != "" && !validate.ID(in.SupplierID)) || !validate.Name(in.Reference, 200) || len(in.Items) == 0 || len(in.Items) > 100 {
		return nil, apperror.Fail("INVALID_PURCHASE", "Check the warehouse, reference and purchase lines (up to 100).", 422)
	}
	for _, item := range in.Items {
		if item.Quantity <= 0 || item.Quantity > quantity.Max || !ValidMoney(item.CostPrice) {
			return nil, apperror.Fail("INVALID_PURCHASE_ITEM", "Invalid purchase quantity or cost.", 422)
		}
		if item.ProductID == "" {
			if item.Product == nil || item.Product.InitialStock != 0 {
				return nil, apperror.Fail("PRODUCT_REQUIRED", "Each line needs an existing product or product details without initial stock.", 422)
			}
			if e := item.Product.Validate(); e != nil {
				return nil, e
			}
		} else if !validate.ID(item.ProductID) {
			return nil, apperror.Fail("INVALID_ID", "Invalid product.", 422)
		}
	}
	return s.Mutate(ctx, t, key, "POST /v1/purchases", raw, func(q *database.Queries) (Change, error) {
		id, e := q.CreatePurchase(ctx, database.CreatePurchaseParams{WarehouseID: database.ID(in.WarehouseID), SupplierID: database.ID(in.SupplierID), Reference: in.Reference, UserID: t.UserID, ActorType: t.ActorType})
		if e != nil {
			return Change{}, e
		}
		items := append([]PurchaseItem(nil), in.Items...)
		for i, item := range items {
			if item.ProductID == "" {
				p := item.Product
				if e := s.resolveProduct(ctx, q, t, p, ""); e != nil {
					return Change{}, e
				}
				newID, e := q.CreateProduct(ctx, database.CreateProductParams{UnitCode: p.UnitCode, Name: p.Name, Sku: p.SKU, CategoryID: database.ID(p.CategoryID), Column4: database.Number(item.CostPrice), Column5: database.Number(p.SalePrice), Minimum: p.Minimum, Description: p.Description, Location: p.Location, Icon: "package", Barcode: p.Barcode})
				if e != nil {
					return Change{}, e
				}
				items[i].ProductID = database.IDString(newID)
			}
		}
		sort.Slice(items, func(i, j int) bool { return items[i].ProductID < items[j].ProductID })
		seen := map[string]bool{}
		stockChanges := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if seen[item.ProductID] {
				return Change{}, apperror.Fail("DUPLICATE_PURCHASE_ITEM", "Combine the lines for the same product.", 422)
			}
			seen[item.ProductID] = true
			if _, e = q.LockProduct(ctx, database.ID(item.ProductID)); e != nil {
				return Change{}, e
			}
			stockChange, e := s.adjust(ctx, q, t, Adjustment{ProductID: item.ProductID, WarehouseID: in.WarehouseID, Quantity: item.Quantity, Type: "purchase", Reference: in.Reference})
			if e != nil {
				return Change{}, e
			}
			stockChanges = append(stockChanges, stockChange)
			if e = q.RecordPurchaseItem(ctx, database.RecordPurchaseItemParams{PurchaseID: id, ProductID: database.ID(item.ProductID), Quantity: item.Quantity, Column4: database.Number(item.CostPrice)}); e != nil {
				return Change{}, e
			}
		}
		return Change{Result: map[string]any{"id": database.IDString(id), "reference": in.Reference, "items": len(items)}, After: map[string]any{"reference": in.Reference, "warehouseId": in.WarehouseID, "supplierId": in.SupplierID, "items": items, "stockChanges": stockChanges}, ID: database.IDString(id)}, nil
	})
}
