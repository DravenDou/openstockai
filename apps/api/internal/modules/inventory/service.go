package inventory

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
)

// Service owns inventory, catalogs, stock, purchases and their audit transaction.
type Service struct {
	Pool *pgxpool.Pool
	Q    *database.Queries
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{Pool: pool, Q: database.New(database.ContextDB{Pool: pool})}
}
