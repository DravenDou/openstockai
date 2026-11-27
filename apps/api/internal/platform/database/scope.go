package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type transactionKey struct{}

func WithTransaction(ctx context.Context, tx pgx.Tx) context.Context {
	return context.WithValue(ctx, transactionKey{}, tx)
}

// ContextDB routes every sqlc query in an HTTP request through its request transaction.
// Outside a request it uses the supplied pool (migration/test helpers).
type ContextDB struct{ Pool *pgxpool.Pool }

func (d ContextDB) connection(ctx context.Context) DBTX {
	if tx, ok := ctx.Value(transactionKey{}).(pgx.Tx); ok {
		return tx
	}
	return d.Pool
}
func (d ContextDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return d.connection(ctx).Exec(ctx, sql, args...)
}
func (d ContextDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return d.connection(ctx).Query(ctx, sql, args...)
}
func (d ContextDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return d.connection(ctx).QueryRow(ctx, sql, args...)
}

// Begin starts the request transaction; nested mutations use a savepoint and
// never acquire a second pool connection.
func Begin(ctx context.Context, pool *pgxpool.Pool) (pgx.Tx, error) {
	if parent, ok := ctx.Value(transactionKey{}).(pgx.Tx); ok {
		return parent.Begin(ctx)
	}
	return pool.Begin(ctx)
}

// Release locks even after the client disconnects.
func Rollback(ctx context.Context, tx pgx.Tx) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(cleanup)
}
