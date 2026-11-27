package inventory

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/quantity"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

var unitCode = regexp.MustCompile(`^[a-z][a-z0-9_]{0,23}$`)

type UnitInput struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Symbol   string `json:"symbol"`
	Decimals int32  `json:"decimals"`
	Active   bool   `json:"active"`
}

func (s *Service) SaveUnit(ctx context.Context, t principal.Principal, key string, raw []byte, in UnitInput) (json.RawMessage, error) {
	if !unitCode.MatchString(in.Code) || !validate.Name(in.Name, 80) || !validate.Name(in.Symbol, 16) || in.Decimals < 0 || in.Decimals > 3 {
		return nil, apperror.Fail("INVALID_UNIT", "Check the code, name, symbol and decimals (0 to 3).", 422)
	}
	return s.Mutate(ctx, t, key, "POST /v1/units", raw, func(q *database.Queries) (Change, error) {
		old, err := q.LockUnit(ctx, in.Code)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return Change{}, err
		}
		if err == nil && old.Decimals != in.Decimals {
			return Change{}, apperror.Fail("UNIT_PRECISION_FIXED", "An existing unit's precision cannot change. Create another unit.", 409)
		}
		row, err := q.SaveUnit(ctx, database.SaveUnitParams{Code: in.Code, Name: strings.TrimSpace(in.Name), Symbol: strings.TrimSpace(in.Symbol), Decimals: in.Decimals, Active: in.Active})
		return Change{Result: row, Before: old, ID: in.Code}, err
	})
}

// Resolve category and unit inside the same transaction as the product/purchase.
func (s *Service) resolveProduct(ctx context.Context, q *database.Queries, t principal.Principal, p *ProductInput, currentUnit string) error {
	if p.UnitCode == "" {
		p.UnitCode = "pcs"
	}
	u, err := q.GetUnit(ctx, p.UnitCode)
	if err != nil {
		return apperror.DomainError(err)
	}
	if !u.Active && u.Code != currentUnit {
		return apperror.Fail("UNIT_INACTIVE", "The unit is inactive.", 422)
	}
	if !p.Minimum.Fits(u.Decimals) || !p.InitialStock.Fits(u.Decimals) {
		return apperror.Fail("UNIT_PRECISION", "The quantity has more decimals than its unit allows.", 422)
	}
	if strings.TrimSpace(p.CategoryName) != "" {
		id, err := q.ResolveCategory(ctx, strings.TrimSpace(p.CategoryName))
		if err != nil {
			return err
		}
		p.CategoryID = database.IDString(id)
	}
	return nil
}

func (s *Service) validateProductQuantity(ctx context.Context, q *database.Queries, t principal.Principal, id string, value quantity.Amount) error {
	p, err := q.GetProduct(ctx, database.ID(id))
	if err != nil {
		return apperror.DomainError(err)
	}
	u, err := q.GetUnit(ctx, p.UnitCode)
	if err != nil {
		return err
	}
	if !value.Fits(u.Decimals) {
		return apperror.Fail("UNIT_PRECISION", "The quantity does not respect the unit's decimals.", 422)
	}
	return nil
}
