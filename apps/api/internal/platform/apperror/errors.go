package apperror

import (
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Error struct {
	Code, Message string
	Status        int
}

func (e *Error) Error() string                    { return e.Message }
func Fail(code, message string, status int) error { return &Error{code, message, status} }
func DomainError(err error) error {
	if err == nil {
		return nil
	}
	var domain *Error
	if errors.As(err, &domain) {
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Fail("NOT_FOUND", "Resource not found.", 404)
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "23505":
			return Fail("CONFLICT", "This SKU, name or reference already exists.", 409)
		case "23503":
			return Fail("INVALID_REFERENCE", "The related resource does not exist.", 422)
		case "23514", "22003":
			return Fail("INVALID_VALUE", "The operation contains out-of-range values.", 422)
		}
	}
	return err
}
