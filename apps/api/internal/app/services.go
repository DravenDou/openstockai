// Package app composes the modules. Business rules belong to their owning module.
package app

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/DravenDou/openstockai/apps/api/internal/modules/inventory"
)

type Services struct {
	Pool      *pgxpool.Pool
	Inventory *inventory.Service
}

func New(pool *pgxpool.Pool) *Services {
	return &Services{Pool: pool, Inventory: inventory.New(pool)}
}
