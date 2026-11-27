package inventory

import (
	"context"
	"encoding/json"
	"net/mail"
	"time"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

type Settings struct {
	Store     string `json:"store"`
	Email     string `json:"email"`
	Currency  string `json:"currency"`
	Timezone  string `json:"timezone"`
	Automatic bool   `json:"automatic"`
	LowStock  bool   `json:"lowStock"`
	Voice     bool   `json:"voice"`
}

var currencies = map[string]bool{"USD": true, "EUR": true, "GBP": true, "BOB": true}

func (s *Service) SaveSettings(ctx context.Context, t principal.Principal, key string, raw []byte, in Settings) (json.RawMessage, error) {
	if _, e := time.LoadLocation(in.Timezone); e != nil || !validate.Name(in.Store, 120) || !currencies[in.Currency] {
		return nil, apperror.Fail("INVALID_SETTINGS", "Check the store name, currency and time zone.", 422)
	}
	if _, e := mail.ParseAddress(in.Email); e != nil {
		return nil, apperror.Fail("INVALID_EMAIL", "Invalid email address.", 422)
	}
	return s.Mutate(ctx, t, key, "PATCH /v1/settings", raw, func(q *database.Queries) (Change, error) {
		old, _ := q.GetSettings(ctx)
		e := q.SaveSettings(ctx, jsonBytes(in))
		return Change{Result: in, Before: json.RawMessage(old), ID: "settings"}, e
	})
}
