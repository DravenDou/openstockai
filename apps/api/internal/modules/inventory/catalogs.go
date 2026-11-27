package inventory

import (
	"context"
	"encoding/json"
	"net/mail"
	"strings"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

type LookupInput struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

func (s *Service) CreateLookup(ctx context.Context, t principal.Principal, key, resource string, raw []byte, in LookupInput) (json.RawMessage, error) {
	if !validate.Name(in.Name, 120) {
		return nil, apperror.Fail("INVALID_NAME", "Enter a valid name of up to 120 characters.", 422)
	}
	if in.Email != "" {
		if _, e := mail.ParseAddress(in.Email); e != nil {
			return nil, apperror.Fail("INVALID_EMAIL", "Invalid email address.", 422)
		}
	}
	return s.Mutate(ctx, t, key, "POST /v1/"+resource, raw, false, func(q *database.Queries) (Change, error) {
		switch resource {
		case "categories":
			r, e := q.CreateCategory(ctx, strings.TrimSpace(in.Name))
			return Change{Result: r, ID: database.IDString(r.ID)}, e
		case "warehouses":
			r, e := q.CreateWarehouse(ctx, strings.TrimSpace(in.Name))
			return Change{Result: r, ID: database.IDString(r.ID)}, e
		case "suppliers":
			r, e := q.CreateSupplier(ctx, database.CreateSupplierParams{Name: strings.TrimSpace(in.Name), Email: in.Email})
			return Change{Result: r, ID: database.IDString(r.ID)}, e
		}
		return Change{}, apperror.Fail("NOT_FOUND", "Resource not found.", 404)
	})
}
