package apihttp

import (
	"bytes"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
)

type pendingResponse struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func (p *pendingResponse) Header() http.Header { return p.header }
func (p *pendingResponse) WriteHeader(status int) {
	if p.status == 0 {
		p.status = status
	}
}
func (p *pendingResponse) Write(b []byte) (int, error) {
	if p.status == 0 {
		p.status = 200
	}
	return p.body.Write(b)
}

// Commit before sending a success response; failed responses roll back.
func transaction(pool *pgxpool.Pool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tx, err := database.Begin(r.Context(), pool)
		if err != nil {
			failure(w, err)
			return
		}
		defer database.Rollback(r.Context(), tx)
		pending := &pendingResponse{header: make(http.Header)}
		next.ServeHTTP(pending, r.WithContext(database.WithTransaction(r.Context(), tx)))
		if pending.status == 0 {
			pending.status = 200
		}
		if pending.status < 400 {
			if err = tx.Commit(r.Context()); err != nil {
				failure(w, err)
				return
			}
		}
		for key, values := range pending.header {
			w.Header()[key] = values
		}
		w.WriteHeader(pending.status)
		_, _ = w.Write(pending.body.Bytes())
	})
}
