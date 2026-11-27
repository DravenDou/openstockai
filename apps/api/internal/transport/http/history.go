package apihttp

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/DravenDou/openstockai/apps/api/internal/modules/inventory"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
)

func historyCursor(r *http.Request) (string, string, error) {
	id, date := r.URL.Query().Get("beforeId"), r.URL.Query().Get("beforeDate")
	if id == "" && date == "" {
		return "", "", nil
	}
	if _, err := uuid.Parse(id); err != nil {
		return "", "", apperror.Fail("INVALID_CURSOR", "Invalid cursor.", 400)
	}
	if _, err := time.Parse(time.RFC3339Nano, date); err != nil {
		return "", "", apperror.Fail("INVALID_CURSOR", "Invalid cursor.", 400)
	}
	return id, date, nil
}
func nextHistory(id string, date time.Time) map[string]string {
	return map[string]string{"id": id, "date": date.UTC().Format(time.RFC3339Nano)}
}
func registerHistory(r chi.Router, s *inventory.Service) {
	get(r, "/purchases-page", func(r *http.Request, o listOptions) (any, error) {
		id, date, err := historyCursor(r)
		if err != nil {
			return nil, err
		}
		rows, err := s.Q.PurchaseHistory(r.Context(), database.PurchaseHistoryParams{Query: o.search, BeforeID: id, BeforeDate: date, PageLimit: o.limit + 1})
		var next any
		if len(rows) > int(o.limit) {
			rows = rows[:o.limit]
			last := rows[len(rows)-1]
			next = nextHistory(uuid.UUID(last.ID.Bytes).String(), last.CreatedAt.Time)
		}
		return map[string]any{"items": rows, "next": next}, err
	})
	get(r, "/purchases/{id}", func(r *http.Request, _ listOptions) (any, error) {
		id := database.ID(chi.URLParam(r, "id"))
		header, err := s.Q.PurchaseHeader(r.Context(), id)
		if err != nil {
			return nil, apperror.DomainError(err)
		}
		lines, err := s.Q.PurchaseLines(r.Context(), id)
		return map[string]any{"purchase": header, "items": lines}, err
	})
	get(r, "/audit-page", func(r *http.Request, o listOptions) (any, error) {
		id, date, err := historyCursor(r)
		if err != nil {
			return nil, err
		}
		actor := r.URL.Query().Get("actor")
		if actor != "" && actor != "human" && actor != "ai" && actor != "system" {
			return nil, apperror.Fail("INVALID_QUERY", "Invalid actor.", 400)
		}
		rows, err := s.Q.AuditHistory(r.Context(), database.AuditHistoryParams{Query: o.search, Actor: actor, BeforeID: id, BeforeDate: date, PageLimit: o.limit + 1})
		var next any
		if len(rows) > int(o.limit) {
			rows = rows[:o.limit]
			last := rows[len(rows)-1]
			next = nextHistory(uuid.UUID(last.ID.Bytes).String(), last.CreatedAt.Time)
		}
		return map[string]any{"items": rows, "next": next}, err
	})
	get(r, "/products-export", func(r *http.Request, o listOptions) (any, error) {
		query := r.URL.Query()
		id := query.Get("afterId")
		if id != "" {
			if _, err := uuid.Parse(id); err != nil {
				return nil, apperror.Fail("INVALID_CURSOR", "Invalid cursor.", 400)
			}
		}
		status := query.Get("status")
		if status == "" {
			status = "active"
		}
		if status != "active" && status != "archived" {
			return nil, apperror.Fail("INVALID_QUERY", "Invalid status.", 400)
		}
		warehouse := query.Get("warehouse")
		if warehouse != "" {
			if _, err := uuid.Parse(warehouse); err != nil {
				return nil, apperror.Fail("INVALID_QUERY", "Invalid warehouse.", 400)
			}
		}
		rows, err := s.Q.ExportProducts(r.Context(), database.ExportProductsParams{Query: o.search, Category: query.Get("category"), StockFilter: query.Get("stock"), Status: status, Warehouse: warehouse, AfterID: id, PageLimit: o.limit + 1})
		var next any
		if len(rows) > int(o.limit) {
			rows = rows[:o.limit]
			last := rows[len(rows)-1]
			next = map[string]string{"id": uuid.UUID(last.ID.Bytes).String()}
		}
		return map[string]any{"items": rows, "next": next}, err
	})
}
