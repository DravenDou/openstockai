package main

import (
	"context"
	"database/sql"
	"errors"
	"os"
)

// Local bootstrap only. Production can provision equivalent logins separately.
func provision(ctx context.Context, db *sql.DB) error {
	for _, entry := range []struct{ login, group, key string }{
		{"openstock_api_login", "openstock_api", "API_DATABASE_PASSWORD"},
		{"openstock_auth_login", "openstock_auth", "AUTH_DATABASE_PASSWORD"},
	} {
		password := os.Getenv(entry.key)
		if len(password) < 32 {
			return errors.New(entry.key + " must contain at least 32 characters")
		}
		var exists bool
		if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)", entry.login).Scan(&exists); err != nil {
			return err
		}
		verb := "CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L"
		if exists {
			verb = "ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L"
		}
		var command string
		if err := db.QueryRowContext(ctx, "SELECT format($1::text,$2::text,$3::text)", verb, entry.login, password).Scan(&command); err != nil {
			return err
		}
		if _, err := db.ExecContext(ctx, command); err != nil {
			return errors.New("cannot provision runtime login")
		}
		if _, err := db.ExecContext(ctx, "GRANT "+entry.group+" TO "+entry.login); err != nil {
			return err
		}
	}
	return nil
}
