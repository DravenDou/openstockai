package inventory

import (
	"context"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

func (s *Service) Products(ctx context.Context, t principal.Principal, search, category, stockFilter, status, warehouse string, limit, offset int32) (any, error) {
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "archived" {
		return nil, apperror.Fail("INVALID_QUERY", "Invalid product status.", 400)
	}
	if warehouse != "" && !validate.ID(warehouse) {
		return nil, apperror.Fail("INVALID_QUERY", "Invalid warehouse.", 400)
	}
	if stockFilter != "" && stockFilter != "low" && stockFilter != "out" {
		return nil, apperror.Fail("INVALID_QUERY", "Invalid stock filter.", 400)
	}
	rows, err := s.Q.ListProducts(ctx, database.ListProductsParams{Query: search, Category: category, StockFilter: stockFilter, Status: status, Warehouse: warehouse, PageLimit: limit, PageOffset: offset})
	if err != nil {
		return nil, err
	}
	total, err := s.Q.CountProducts(ctx, database.CountProductsParams{Query: search, Category: category, StockFilter: stockFilter, Status: status, Warehouse: warehouse})
	return map[string]any{"items": rows, "total": total}, err
}
func (s *Service) Product(ctx context.Context, t principal.Principal, id string) (any, error) {
	p, e := s.Q.GetProductView(ctx, database.ID(id))
	return p, apperror.DomainError(e)
}
