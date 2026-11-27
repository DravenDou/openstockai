package database

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func ID(value string) pgtype.UUID { var id pgtype.UUID; _ = id.Scan(value); return id }
func IDString(value pgtype.UUID) string {
	if !value.Valid {
		return ""
	}
	return uuid.UUID(value.Bytes).String()
}
func Number(value string) pgtype.Numeric  { var n pgtype.Numeric; _ = n.Scan(value); return n }
func Decimal(value pgtype.Numeric) string { v, _ := value.Value(); s, _ := v.(string); return s }
