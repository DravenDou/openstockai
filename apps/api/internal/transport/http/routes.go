package apihttp

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/DravenDou/openstockai/apps/api/internal/modules/inventory"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
)

func respond(w http.ResponseWriter, value any, err error) {
	if err != nil {
		failure(w, err)
		return
	}
	write(w, http.StatusOK, value)
}

// jsonHandler owns the HTTP boundary: strict decoding, body limits and error responses.
func jsonHandler[T any](fn func(*http.Request, T, []byte) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input T
		raw, err := decode(w, r, &input)
		if err != nil {
			failure(w, err)
			return
		}
		value, err := fn(r, input, raw)
		respond(w, value, err)
	}
}

type listOptions struct {
	limit, offset int32
	search        string
}

func get(r chi.Router, path string, fn func(*http.Request, listOptions) (any, error)) {
	r.Get(path, func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := page(r)
		if err != nil {
			failure(w, err)
			return
		}
		for _, name := range []string{"category", "warehouse", "product"} {
			if value := r.URL.Query().Get(name); value != "" {
				if _, err := uuid.Parse(value); err != nil {
					failure(w, apperror.Fail("INVALID_QUERY", "Invalid filter identifier.", 400))
					return
				}
			}
		}
		search := r.URL.Query().Get("query")
		if len(search) > 160 {
			failure(w, apperror.Fail("INVALID_QUERY", "Search text is too long.", 400))
			return
		}
		if since := r.URL.Query().Get("since"); since != "" {
			if _, err := time.Parse(time.RFC3339, since); err != nil {
				failure(w, apperror.Fail("INVALID_QUERY", "Invalid start date.", 400))
				return
			}
		}
		value, err := fn(r, listOptions{limit, offset, search})
		respond(w, value, err)
	})
}

func registerRoutes(r chi.Router, s *inventory.Service) {
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		failure(w, apperror.Fail("NOT_FOUND", "Unknown route.", 404))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		failure(w, apperror.Fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405))
	})
	get(r, "/products", func(r *http.Request, o listOptions) (any, error) {
		return s.Products(r.Context(), principal.From(r.Context()), o.search, r.URL.Query().Get("category"), r.URL.Query().Get("stock"), r.URL.Query().Get("status"), r.URL.Query().Get("warehouse"), o.limit, o.offset)
	})
	get(r, "/products/by-sku", func(r *http.Request, _ listOptions) (any, error) {
		if sku := r.URL.Query().Get("sku"); sku == "" || len(sku) > 80 {
			return nil, apperror.Fail("INVALID_QUERY", "Enter a SKU of up to 80 characters.", 400)
		}
		row, err := s.Q.GetProductViewBySKU(r.Context(), r.URL.Query().Get("sku"))
		return row, apperror.DomainError(err)
	})
	get(r, "/products/{id}", func(r *http.Request, _ listOptions) (any, error) {
		return s.Product(r.Context(), principal.From(r.Context()), chi.URLParam(r, "id"))
	})
	get(r, "/categories", func(r *http.Request, o listOptions) (any, error) {
		return s.Q.ListCategories(r.Context(), database.ListCategoriesParams{Column1: o.search, Limit: o.limit, Offset: o.offset})
	})
	get(r, "/warehouses", func(r *http.Request, o listOptions) (any, error) {
		return s.Q.ListWarehouses(r.Context(), database.ListWarehousesParams{Column1: o.search, Limit: o.limit, Offset: o.offset})
	})
	get(r, "/suppliers", func(r *http.Request, o listOptions) (any, error) {
		return s.Q.ListSuppliers(r.Context(), database.ListSuppliersParams{Column1: o.search, Limit: o.limit, Offset: o.offset})
	})
	get(r, "/inventory", func(r *http.Request, o listOptions) (any, error) {
		product, warehouse := r.URL.Query().Get("product"), r.URL.Query().Get("warehouse")
		for _, id := range []string{product, warehouse} {
			if id != "" {
				if _, err := uuid.Parse(id); err != nil {
					return nil, apperror.Fail("INVALID_QUERY", "Invalid product or warehouse.", 400)
				}
			}
		}
		return s.Q.GetInventory(r.Context(), database.GetInventoryParams{Product: product, Warehouse: warehouse, PageLimit: o.limit, PageOffset: o.offset})
	})
	get(r, "/units", func(r *http.Request, _ listOptions) (any, error) {
		return s.Q.ListUnits(r.Context())
	})
	get(r, "/inventory/summary", func(r *http.Request, _ listOptions) (any, error) {
		return s.Q.InventorySummary(r.Context())
	})
	movementParams := func(r *http.Request, o listOptions) database.ListMovementsParams {
		return database.ListMovementsParams{Query: o.search, Product: r.URL.Query().Get("product"), Warehouse: r.URL.Query().Get("warehouse"), Kind: r.URL.Query().Get("kind"), Since: r.URL.Query().Get("since"), PageLimit: o.limit, PageOffset: o.offset}
	}
	get(r, "/stock-movements", func(r *http.Request, o listOptions) (any, error) {
		return s.Q.ListMovements(r.Context(), movementParams(r, o))
	})
	get(r, "/movements-page", func(r *http.Request, o listOptions) (any, error) {
		p := movementParams(r, o)
		rows, err := s.Q.ListMovements(r.Context(), p)
		if err != nil {
			return nil, err
		}
		total, err := s.Q.CountMovements(r.Context(), database.CountMovementsParams{Query: p.Query, Product: p.Product, Warehouse: p.Warehouse, Kind: p.Kind, Since: p.Since})
		return map[string]any{"items": rows, "total": total}, err
	})
	get(r, "/low-stock", func(r *http.Request, o listOptions) (any, error) {
		return s.Q.LowStock(r.Context(), database.LowStockParams{Limit: o.limit, Offset: o.offset})
	})
	r.Get("/analytics/dashboard", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.Dashboard(r.Context())
		respond(w, value, err)
	})
	r.Get("/analytics/stock-valuation", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.StockValuation(r.Context(), r.URL.Query().Get("warehouse"), r.URL.Query().Get("category"))
		respond(w, value, err)
	})
	r.Get("/analytics/turnover", func(w http.ResponseWriter, r *http.Request) {
		days, limit, err := intParams(r, "days", "limit")
		if err == nil {
			var d, l int32
			if d, l, err = inventory.ClampTurnover(days, limit); err == nil {
				value, e := s.Turnover(r.Context(), d, l)
				respond(w, value, e)
				return
			}
		}
		failure(w, err)
	})
	r.Get("/analytics/supplier-spend", func(w http.ResponseWriter, r *http.Request) {
		from, to, err := inventory.SpendRange(time.Now(), r.URL.Query().Get("from"), r.URL.Query().Get("to"))
		if err != nil {
			failure(w, err)
			return
		}
		value, err := s.SupplierSpend(r.Context(), from, to)
		respond(w, value, err)
	})
	get(r, "/purchases", func(r *http.Request, o listOptions) (any, error) {
		return s.Q.ListPurchases(r.Context(), database.ListPurchasesParams{Limit: o.limit, Offset: o.offset})
	})
	get(r, "/audit-logs", func(r *http.Request, o listOptions) (any, error) {
		return s.Q.ListAudit(r.Context(), database.ListAuditParams{Limit: o.limit, Offset: o.offset})
	})
	get(r, "/agent-actions", func(r *http.Request, _ listOptions) (any, error) {
		t := principal.From(r.Context())
		return s.Q.ListAgentActions(r.Context(), t.UserID)
	})
	get(r, "/settings", func(r *http.Request, _ listOptions) (any, error) {
		raw, err := s.Q.GetSettings(r.Context())
		return json.RawMessage(raw), err
	})
	get(r, "/agent-sessions/{id}", func(r *http.Request, _ listOptions) (any, error) {
		t := principal.From(r.Context())
		_, err := s.Q.CheckAgentSession(r.Context(), database.CheckAgentSessionParams{UserID: t.UserID, SessionID: chi.URLParam(r, "id")})
		return map[string]bool{"ok": err == nil}, err
	})
	r.Post("/products/{id}/restore", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.RestoreProduct(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), chi.URLParam(r, "id"))
		respond(w, value, err)
	})
	r.Post("/inventory/counts", jsonHandler(func(r *http.Request, in inventory.StockCount, raw []byte) (any, error) {
		return s.CountStock(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), raw, in)
	}))
	registerHistory(r, s)
	r.Post("/units", jsonHandler(func(r *http.Request, in inventory.UnitInput, raw []byte) (any, error) {
		return s.SaveUnit(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), raw, in)
	}))
	r.Post("/products", jsonHandler(func(r *http.Request, in inventory.ProductInput, raw []byte) (any, error) {
		return s.CreateProduct(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), raw, in)
	}))
	r.Patch("/products/{id}", jsonHandler(func(r *http.Request, in inventory.ProductPatch, raw []byte) (any, error) {
		return s.UpdateProduct(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), chi.URLParam(r, "id"), raw, in)
	}))
	r.Delete("/products/{id}", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.DeleteProduct(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), chi.URLParam(r, "id"))
		respond(w, value, err)
	})
	for _, resource := range []string{"categories", "warehouses", "suppliers"} {
		get(r, "/"+resource+"/{id}", func(r *http.Request, _ listOptions) (any, error) {
			row, err := s.Q.GetLookup(r.Context(), database.GetLookupParams{Resource: resource, ID: database.ID(chi.URLParam(r, "id"))})
			return row, apperror.DomainError(err)
		})
		r.Patch("/"+resource+"/{id}", jsonHandler(func(r *http.Request, in inventory.LookupInput, raw []byte) (any, error) {
			return s.UpdateLookup(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), resource, chi.URLParam(r, "id"), raw, in)
		}))
		r.Delete("/"+resource+"/{id}", func(w http.ResponseWriter, r *http.Request) {
			value, err := s.DeleteLookup(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), resource, chi.URLParam(r, "id"))
			respond(w, value, err)
		})
		r.Post("/"+resource, jsonHandler(func(r *http.Request, in inventory.LookupInput, raw []byte) (any, error) {
			return s.CreateLookup(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), resource, raw, in)
		}))
	}
	r.Post("/inventory/adjustments", jsonHandler(func(r *http.Request, in inventory.Adjustment, raw []byte) (any, error) {
		return s.Adjust(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), raw, in)
	}))
	r.Post("/inventory/transfers", jsonHandler(func(r *http.Request, in inventory.Transfer, raw []byte) (any, error) {
		return s.Transfer(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), raw, in)
	}))
	r.Post("/purchases", jsonHandler(func(r *http.Request, in inventory.Purchase, raw []byte) (any, error) {
		return s.Purchase(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), raw, in)
	}))
	r.Patch("/settings", jsonHandler(func(r *http.Request, in inventory.Settings, raw []byte) (any, error) {
		return s.SaveSettings(r.Context(), principal.From(r.Context()), r.Header.Get("Idempotency-Key"), raw, in)
	}))
	r.Post("/agent-actions", jsonHandler(func(r *http.Request, in inventory.ActionInput, _ []byte) (any, error) {
		return s.CreateAction(r.Context(), principal.From(r.Context()), in)
	}))
	r.Post("/agent-actions/{id}/approval", jsonHandler(func(r *http.Request, in struct {
		Approved bool `json:"approved"`
	}, _ []byte) (any, error) {
		return s.ApproveAction(r.Context(), principal.From(r.Context()), chi.URLParam(r, "id"), in.Approved)
	}))
	r.Post("/agent-actions/{id}/execute", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.ExecuteApproved(r.Context(), principal.From(r.Context()), chi.URLParam(r, "id"))
		respond(w, value, err)
	})
	r.Patch("/agent-actions/{id}", jsonHandler(func(r *http.Request, in struct {
		Result json.RawMessage `json:"result"`
		Status string          `json:"status"`
		Error  string          `json:"error"`
	}, _ []byte) (any, error) {
		t := principal.From(r.Context())
		if t.ActorType != "ai" {
			return nil, apperror.Fail("FORBIDDEN", "Only the agent service can do this.", 403)
		}
		if (in.Status != "completed" && in.Status != "failed") || len(in.Error) > 500 || len(in.Result) > 65536 {
			return nil, apperror.Fail("INVALID_ACTION", "Invalid result.", 422)
		}
		err := s.CompleteReadAction(r.Context(), t, chi.URLParam(r, "id"), in.Result, in.Status, in.Error)
		return map[string]bool{"ok": err == nil}, err
	}))
	r.Post("/agent-sessions", jsonHandler(func(r *http.Request, in struct {
		SessionID string `json:"sessionId"`
	}, _ []byte) (any, error) {
		t := principal.From(r.Context())
		if t.ActorType != "ai" {
			return nil, apperror.Fail("FORBIDDEN", "Only the agent service can do this.", 403)
		}
		if len(in.SessionID) > 200 || in.SessionID == "" {
			return nil, apperror.Fail("INVALID_SESSION", "Invalid session.", 422)
		}
		_, err := s.Q.BindAgentSession(r.Context(), database.BindAgentSessionParams{UserID: t.UserID, SessionID: in.SessionID})
		return map[string]bool{"ok": err == nil}, err
	}))
}

// intParams reads optional non-negative integer query parameters (0 when absent).
func intParams(r *http.Request, names ...string) (a, b int, err error) {
	out := [2]int{}
	for i, name := range names {
		if v := r.URL.Query().Get(name); v != "" {
			n, e := strconv.Atoi(v)
			if e != nil {
				return 0, 0, apperror.Fail("INVALID_QUERY", "Invalid number in query.", 400)
			}
			out[i] = n
		}
	}
	return out[0], out[1], nil
}
