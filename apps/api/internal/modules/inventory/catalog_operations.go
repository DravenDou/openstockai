package inventory

import (
	"context"
	"encoding/json"
	"errors"
	"net/mail"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

func (s *Service) UpdateLookup(ctx context.Context, t principal.Principal, key, resource, id string, raw []byte, in LookupInput) (json.RawMessage, error) {
	if !validate.ID(id) || !validate.Name(in.Name, 120) {
		return nil, apperror.Fail("INVALID_NAME", "Check the identifier and the name (up to 120 characters).", 422)
	}
	if in.Email != "" {
		if _, err := mail.ParseAddress(in.Email); err != nil {
			return nil, apperror.Fail("INVALID_EMAIL", "Invalid email address.", 422)
		}
	}
	in.Name = strings.TrimSpace(in.Name)
	return s.Mutate(ctx, t, key, "PATCH /v1/"+resource+"/"+id, raw, func(q *database.Queries) (Change, error) {
		old, err := lockLookup(ctx, q, resource, id)
		if err != nil {
			return Change{}, err
		}
		var result any
		err = nil
		switch resource {
		case "categories":
			result, err = q.UpdateCategory(ctx, database.UpdateCategoryParams{ID: database.ID(id), Name: in.Name})
		case "warehouses":
			result, err = q.UpdateWarehouse(ctx, database.UpdateWarehouseParams{ID: database.ID(id), Name: in.Name})
		case "suppliers":
			result, err = q.UpdateSupplier(ctx, database.UpdateSupplierParams{ID: database.ID(id), Name: in.Name, Email: in.Email})
		default:
			return Change{}, apperror.Fail("NOT_FOUND", "Unknown resource.", 404)
		}
		return Change{Result: result, Before: old, ID: id}, err
	})
}
func (s *Service) DeleteLookup(ctx context.Context, t principal.Principal, key, resource, id string) (json.RawMessage, error) {
	if !validate.ID(id) {
		return nil, apperror.Fail("INVALID_ID", "Invalid identifier.", 422)
	}
	return s.Mutate(ctx, t, key, "DELETE /v1/"+resource+"/"+id, []byte(`{}`), func(q *database.Queries) (Change, error) {
		old, err := lockLookup(ctx, q, resource, id)
		if err != nil {
			return Change{}, err
		}
		var count int64
		err = nil
		switch resource {
		case "categories":
			count, err = q.DeleteCategory(ctx, database.ID(id))
		case "warehouses":
			count, err = q.DeleteWarehouse(ctx, database.ID(id))
		case "suppliers":
			count, err = q.DeleteSupplier(ctx, database.ID(id))
		default:
			return Change{}, apperror.Fail("NOT_FOUND", "Unknown resource.", 404)
		}
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23503" {
			return Change{}, apperror.Fail("RESOURCE_IN_USE", "It has related products, stock or history. You can edit it, but not delete it.", 409)
		}
		if err == nil && count == 0 {
			return Change{}, apperror.Fail("NOT_FOUND", "Record not found.", 404)
		}
		return Change{Result: map[string]bool{"ok": true}, Before: old, ID: id}, err
	})
}
func (s *Service) RestoreProduct(ctx context.Context, t principal.Principal, key, id string) (json.RawMessage, error) {
	if !validate.ID(id) {
		return nil, apperror.Fail("INVALID_ID", "Invalid identifier.", 422)
	}
	return s.Mutate(ctx, t, key, "POST /v1/products/"+id+"/restore", []byte(`{}`), func(q *database.Queries) (Change, error) {
		row, err := q.RestoreProduct(ctx, database.ID(id))
		return Change{Result: row, Before: map[string]string{"status": "archived"}, ID: id}, err
	})
}

func lockLookup(ctx context.Context, q *database.Queries, resource, id string) (any, error) {
	switch resource {
	case "categories":
		return q.LockCategory(ctx, database.ID(id))
	case "warehouses":
		return q.LockWarehouse(ctx, database.ID(id))
	case "suppliers":
		return q.LockSupplier(ctx, database.ID(id))
	}
	return nil, apperror.Fail("NOT_FOUND", "Unknown resource.", 404)
}
