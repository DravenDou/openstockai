package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/DravenDou/openstockai/apps/api/internal/app"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/auth"
	apihttp "github.com/DravenDou/openstockai/apps/api/internal/transport/http"
)

func main() {
	migrate := flag.Bool("migrate", false, "Apply versioned Goose migrations and exit")
	provisionRoles := flag.Bool("provision", false, "Provision local runtime DB logins after migrations")
	migrations := flag.String("migrations", "db/migrations", "Migration directory")
	flag.Parse()
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if e := run(*migrate, *provisionRoles, *migrations); e != nil {
		slog.Error("startup failed", "error", e.Error())
		os.Exit(1)
	}
}
func run(migrate, provisionRoles bool, migrations string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}
	if migrate || provisionRoles {
		db, e := sql.Open("pgx", dsn)
		if e != nil {
			return errors.New("database configuration invalid")
		}
		defer db.Close()
		if e = goose.SetDialect("postgres"); e != nil {
			return e
		}
		if provisionRoles {
			return provision(ctx, db)
		}
		return goose.UpContext(ctx, db, migrations)
	}
	config, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		return errors.New("database configuration invalid")
	}
	maxConnections := int64(8)
	if value := os.Getenv("API_DB_MAX_CONNS"); value != "" {
		maxConnections, e = strconv.ParseInt(value, 10, 32)
		if e != nil || maxConnections < 1 || maxConnections > 64 {
			return errors.New("API_DB_MAX_CONNS must be between 1 and 64")
		}
	}
	config.MaxConns = int32(maxConnections)
	config.MinConns = 0
	config.MaxConnIdleTime = 5 * time.Minute
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnLifetimeJitter = 5 * time.Minute
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	config.ConnConfig.RuntimeParams["application_name"] = "openstockai-api"
	config.ConnConfig.RuntimeParams["statement_timeout"] = "15000"
	config.ConnConfig.RuntimeParams["lock_timeout"] = "5000"
	config.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "15000"
	pool, e := pgxpool.NewWithConfig(ctx, config)
	if e != nil {
		return errors.New("database configuration invalid")
	}
	defer pool.Close()
	if e = pool.Ping(ctx); e != nil {
		return errors.New("PostgreSQL unavailable")
	}
	for _, key := range []string{"BETTER_AUTH_JWKS_URL", "JWT_ISSUER", "JWT_AUDIENCE", "AGENT_SERVICE_SECRET"} {
		if os.Getenv(key) == "" {
			return errors.New(key + " is required")
		}
	}
	if len(os.Getenv("AGENT_SERVICE_SECRET")) < 32 {
		return errors.New("AGENT_SERVICE_SECRET must contain at least 32 characters")
	}
	v := auth.NewVerifier(os.Getenv("BETTER_AUTH_JWKS_URL"), os.Getenv("JWT_ISSUER"), os.Getenv("JWT_AUDIENCE"))
	addr := os.Getenv("API_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8087"
	}
	services := app.New(pool)
	server := &http.Server{Addr: addr, Handler: apihttp.Router(services, v, os.Getenv("AGENT_SERVICE_SECRET")), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("API listening", "address", addr)
	e = server.ListenAndServe()
	if errors.Is(e, http.ErrServerClosed) {
		return nil
	}
	return e
}
