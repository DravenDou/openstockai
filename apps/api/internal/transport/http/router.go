package apihttp

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/DravenDou/openstockai/apps/api/internal/app"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/auth"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/principal"
)

func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func failure(w http.ResponseWriter, err error) {
	err = apperror.DomainError(err)
	var domain *apperror.Error
	if !errors.As(err, &domain) {
		slog.Error("request failed", "error", err.Error())
		domain = &apperror.Error{Code: "INTERNAL_ERROR", Message: "The operation could not be completed.", Status: 500}
	}
	write(w, domain.Status, map[string]any{"error": map[string]string{"code": domain.Code, "message": domain.Message}})
}
func decode(w http.ResponseWriter, r *http.Request, target any) ([]byte, error) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return nil, apperror.Fail("INVALID_CONTENT_TYPE", "Content-Type must be application/json.", 415)
	}
	raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10))
	if e != nil {
		return nil, apperror.Fail("BODY_TOO_LARGE", "The request body exceeds 256 KB.", 413)
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if e = d.Decode(target); e != nil {
		return nil, apperror.Fail("INVALID_JSON", "The JSON contains unknown fields or invalid values.", 400)
	}
	if e = d.Decode(new(any)); e != io.EOF {
		return nil, apperror.Fail("INVALID_JSON", "Only a single JSON object is accepted.", 400)
	}
	return raw, nil
}
func page(r *http.Request) (int32, int32, error) {
	limit := int64(100)
	offset := int64(0)
	var e error
	if s := r.URL.Query().Get("limit"); s != "" {
		limit, e = strconv.ParseInt(s, 10, 32)
		if e != nil {
			return 0, 0, apperror.Fail("INVALID_PAGE", "Invalid pagination.", 400)
		}
	}
	if s := r.URL.Query().Get("offset"); s != "" {
		offset, e = strconv.ParseInt(s, 10, 32)
	}
	if e != nil || limit < 1 || limit > 500 || offset < 0 {
		return 0, 0, apperror.Fail("INVALID_PAGE", "Limit must be between 1 and 500; offset must not be negative.", 400)
	}
	return int32(limit), int32(offset), nil
}
func secretEqual(a, b string) bool {
	return len(b) >= 32 && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func Router(services *app.Services, v *auth.Verifier, agentSecret string) http.Handler {
	q := database.New(database.ContextDB{Pool: services.Pool})
	router := chi.NewRouter()
	router.Use(middleware.RequestID, middleware.Recoverer, middleware.Timeout(30*time.Second))
	router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		if e := services.Pool.Ping(r.Context()); e != nil {
			write(w, 503, map[string]string{"status": "unavailable"})
			return
		}
		write(w, 200, map[string]string{"status": "ok"})
	})
	router.Route("/v1", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				started := time.Now()
				ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
				p := principal.Principal{}
				defer func() {
					slog.Info("request", "request_id", middleware.GetReqID(r.Context()), "user_id", p.UserID, "actor_type", p.ActorType, "method", r.Method, "path", r.URL.Path, "status", ww.Status(), "latency_ms", time.Since(started).Milliseconds())
				}()
				header := r.Header.Get("Authorization")
				if !strings.HasPrefix(header, "Bearer ") {
					failure(ww, apperror.Fail("UNAUTHORIZED", "Sign in to continue.", 401))
					return
				}
				claims, e := v.Verify(r.Context(), strings.TrimPrefix(header, "Bearer "))
				if e != nil {
					failure(ww, apperror.Fail("UNAUTHORIZED", "Invalid or expired token.", 401))
					return
				}
				for _, id := range []string{claims.Subject, claims.SID} {
					if _, e = uuid.Parse(id); e != nil {
						failure(ww, apperror.Fail("FORBIDDEN", "Invalid identity.", 403))
						return
					}
				}
				if _, e = q.SessionActive(r.Context(), database.SessionActiveParams{UserID: database.ID(claims.Subject), SessionID: database.ID(claims.SID)}); e != nil {
					failure(ww, apperror.Fail("FORBIDDEN", "The session has expired or is no longer valid.", 403))
					return
				}
				p = principal.Principal{UserID: claims.Subject, SessionID: claims.SID, ActorType: "human"}
				if r.Header.Get("X-Agent-Secret") != "" {
					if !secretEqual(r.Header.Get("X-Agent-Secret"), agentSecret) {
						failure(ww, apperror.Fail("FORBIDDEN", "Invalid agent service credentials.", 403))
						return
					}
					p.ActorType = "ai"
					p.ActionID = r.Header.Get("X-Agent-Action-ID")
				}
				transaction(services.Pool, next).ServeHTTP(ww, r.WithContext(principal.With(r.Context(), p)))
			})
		})
		get(r, "/identity", func(r *http.Request, _ listOptions) (any, error) {
			return q.Identity(r.Context(), database.ID(principal.From(r.Context()).UserID))
		})
		registerRoutes(r, services.Inventory)
	})
	return router
}
