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

type ProductInput struct {
	CategoryName string          `json:"categoryName"`
	UnitCode     string          `json:"unitCode"`
	Name         string          `json:"name"`
	SKU          string          `json:"sku"`
	CategoryID   string          `json:"categoryId"`
	CostPrice    string          `json:"costPrice"`
	SalePrice    string          `json:"salePrice"`
	Minimum      quantity.Amount `json:"minimum"`
	Description  string          `json:"description"`
	Location     string          `json:"location"`
	Icon         string          `json:"icon"`
	Barcode      string          `json:"barcode"`
	InitialStock quantity.Amount `json:"initialStock"`
	WarehouseID  string          `json:"warehouseId"`
}

func (p ProductInput) Validate() error {
	if !validate.Name(p.Name, 160) || !validate.Name(p.SKU, 80) || !ValidMoney(p.CostPrice) || !ValidMoney(p.SalePrice) || p.Minimum < 0 || p.Minimum > quantity.Max || p.InitialStock < 0 || p.InitialStock > quantity.Max || len(p.Description) > 4000 || len(p.Location) > 300 || len(p.Barcode) > 100 {
		return apperror.Fail("INVALID_PRODUCT", "Check the product name, SKU, decimal prices and quantities.", 422)
	}
	if len(p.CategoryName) > 120 || (p.CategoryName != "" && p.CategoryID != "") {
		return apperror.Fail("INVALID_CATEGORY", "Use a category name or ID, not both.", 422)
	}
	if p.CategoryID != "" && !validate.ID(p.CategoryID) {
		return apperror.Fail("INVALID_CATEGORY", "The category must have a valid ID.", 422)
	}
	if p.InitialStock > 0 && !validate.ID(p.WarehouseID) {
		return apperror.Fail("WAREHOUSE_REQUIRED", "Select a warehouse for the initial stock.", 422)
	}
	return nil
}
func (s *Service) CreateProduct(ctx context.Context, t principal.Principal, key string, raw []byte, p ProductInput) (json.RawMessage, error) {
	if err := p.Validate(); err != nil {
		return nil, err
	}
	if p.Icon == "" {
		p.Icon = "package"
	}
	return s.Mutate(ctx, t, key, "POST /v1/products", raw, func(q *database.Queries) (Change, error) {
		if err := s.resolveProduct(ctx, q, t, &p, ""); err != nil {
			return Change{}, err
		}
		id, err := q.CreateProduct(ctx, database.CreateProductParams{UnitCode: p.UnitCode, Name: strings.TrimSpace(p.Name), Sku: strings.TrimSpace(p.SKU), CategoryID: database.ID(p.CategoryID), Column4: database.Number(p.CostPrice), Column5: database.Number(p.SalePrice), Minimum: p.Minimum, Description: p.Description, Location: p.Location, Icon: p.Icon, Barcode: p.Barcode})
		if err != nil {
			return Change{}, err
		}
		if p.InitialStock > 0 {
			_, err = s.adjust(ctx, q, t, Adjustment{ProductID: database.IDString(id), WarehouseID: p.WarehouseID, Quantity: p.InitialStock, Type: "initial"})
		}
		return Change{Result: map[string]any{"id": database.IDString(id)}, After: p, ID: database.IDString(id)}, err
	})
}

type ProductPatch struct {
	CategoryName *string          `json:"categoryName"`
	UnitCode     *string          `json:"unitCode"`
	Name         *string          `json:"name"`
	CategoryID   *string          `json:"categoryId"`
	CostPrice    *string          `json:"costPrice"`
	SalePrice    *string          `json:"salePrice"`
	Minimum      *quantity.Amount `json:"minimum"`
	Description  *string          `json:"description"`
	Location     *string          `json:"location"`
	Barcode      *string          `json:"barcode"`
}

func (s *Service) UpdateProduct(ctx context.Context, t principal.Principal, key, id string, raw []byte, p ProductPatch) (json.RawMessage, error) {
	if !validate.ID(id) {
		return nil, apperror.Fail("INVALID_ID", "Invalid ID.", 400)
	}
	return s.Mutate(ctx, t, key, "PATCH /v1/products/"+id, raw, func(q *database.Queries) (Change, error) {
		old, err := q.LockProduct(ctx, database.ID(id))
		if err != nil {
			return Change{}, err
		}
		next := ProductInput{Name: old.Name, SKU: old.Sku, CategoryID: database.IDString(old.CategoryID), CostPrice: database.Decimal(old.CostPrice), SalePrice: database.Decimal(old.SalePrice), Minimum: old.Minimum, Description: old.Description, Location: old.Location, Barcode: old.Barcode, UnitCode: old.UnitCode}
		if p.UnitCode != nil {
			next.UnitCode = *p.UnitCode
		}
		if p.CategoryName != nil {
			next.CategoryName = *p.CategoryName
			next.CategoryID = ""
		}
		if p.Name != nil {
			next.Name = *p.Name
		}
		if p.CategoryID != nil {
			next.CategoryID = *p.CategoryID
		}
		if p.CostPrice != nil {
			next.CostPrice = *p.CostPrice
		}
		if p.SalePrice != nil {
			next.SalePrice = *p.SalePrice
		}
		if p.Minimum != nil {
			next.Minimum = *p.Minimum
		}
		if p.Description != nil {
			next.Description = *p.Description
		}
		if p.Location != nil {
			next.Location = *p.Location
		}
		if p.Barcode != nil {
			next.Barcode = *p.Barcode
		}
		if err = next.Validate(); err != nil {
			return Change{}, err
		}
		if p.UnitCode != nil && *p.UnitCode != old.UnitCode {
			hasHistory, e := q.HasProductMovements(ctx, database.ID(id))
			if e != nil {
				return Change{}, e
			}
			if hasHistory {
				return Change{}, apperror.Fail("UNIT_HAS_HISTORY", "A product with movements keeps its unit to protect its history. Create another product for a different unit.", 409)
			}
		}
		if err = s.resolveProduct(ctx, q, t, &next, old.UnitCode); err != nil {
			return Change{}, err
		}
		err = q.UpdateProduct(ctx, database.UpdateProductParams{UnitCode: next.UnitCode, ID: database.ID(id), Name: next.Name, CategoryID: database.ID(next.CategoryID), Column4: database.Number(next.CostPrice), Column5: database.Number(next.SalePrice), Minimum: next.Minimum, Description: next.Description, Location: next.Location, Barcode: next.Barcode})
		return Change{Result: map[string]any{"id": id}, Before: old, After: next, ID: id}, err
	})
}
func (s *Service) DeleteProduct(ctx context.Context, t principal.Principal, key, id string) (json.RawMessage, error) {
	return s.Mutate(ctx, t, key, "DELETE /v1/products/"+id, []byte(`{}`), func(q *database.Queries) (Change, error) {
		old, e := q.LockProduct(ctx, database.ID(id))
		if e != nil {
			return Change{}, e
		}
		stock, e := q.ProductStock(ctx, database.ID(id))
		if e != nil {
			return Change{}, e
		}
		if stock.Int.Sign() != 0 {
			return Change{}, apperror.Fail("STOCK_REMAINS", "Empty the stock before archiving the product.", 409)
		}
		e = q.ArchiveProduct(ctx, database.ID(id))
		return Change{Result: map[string]string{"id": id, "status": "archived"}, Before: old, ID: id}, e
	})
}
