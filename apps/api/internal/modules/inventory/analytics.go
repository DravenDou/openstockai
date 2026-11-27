package inventory

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/DravenDou/openstockai/apps/api/internal/platform/apperror"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/database"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/validate"
)

const (
	defaultTurnoverDays  = 90
	maxTurnoverDays      = 365
	defaultTurnoverLimit = 10
	maxTurnoverLimit     = 50
	dashboardMovements   = 10
	maxSpendRange        = 5 * 366 * 24 * time.Hour
)

// storeCurrency reads the configured currency, falling back to USD before settings exist.
func (s *Service) storeCurrency(ctx context.Context) string {
	raw, err := s.Q.GetSettings(ctx)
	if err != nil {
		return "USD"
	}
	var in struct {
		Currency string `json:"currency"`
	}
	if json.Unmarshal(raw, &in) != nil || in.Currency == "" {
		return "USD"
	}
	return in.Currency
}

// Dashboard returns the home-page figures: stock value at cost, low-stock count,
// purchase spend over the last 30 days and the latest stock movements.
func (s *Service) Dashboard(ctx context.Context) (any, error) {
	totals, err := s.Q.AnalyticsDashboardTotals(ctx)
	if err != nil {
		return nil, err
	}
	movements, err := s.Q.AnalyticsRecentMovements(ctx, dashboardMovements)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"currency":           s.storeCurrency(ctx),
		"stock_value":        totals.StockValue,
		"low_stock_count":    totals.LowStockCount,
		"movements_7d":       totals.Movements7d,
		"purchase_spend_30d": totals.PurchaseSpend30d,
		"purchases_30d":      totals.Purchases30d,
		"recent_movements":   movements,
	}, nil
}

// StockValuation totals stock at cost and splits it by category and warehouse.
func (s *Service) StockValuation(ctx context.Context, warehouse, category string) (any, error) {
	for _, id := range []string{warehouse, category} {
		if id != "" && !validate.ID(id) {
			return nil, apperror.Fail("INVALID_QUERY", "Invalid filter identifier.", 400)
		}
	}
	total, err := s.Q.AnalyticsValuationTotal(ctx, database.AnalyticsValuationTotalParams{Warehouse: warehouse, Category: category})
	if err != nil {
		return nil, err
	}
	byCategory, err := s.Q.AnalyticsValuationByCategory(ctx, database.AnalyticsValuationByCategoryParams{Warehouse: warehouse, Category: category})
	if err != nil {
		return nil, err
	}
	byWarehouse, err := s.Q.AnalyticsValuationByWarehouse(ctx, database.AnalyticsValuationByWarehouseParams{Warehouse: warehouse, Category: category})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"currency":     s.storeCurrency(ctx),
		"stock_value":  total.StockValue,
		"products":     total.Products,
		"by_category":  byCategory,
		"by_warehouse": byWarehouse,
	}, nil
}

// SlowMover is an on-hand product with little or no outbound movement.
type SlowMover struct {
	database.AnalyticsSlowMoversRow
	DaysSinceLastOutbound *int32 `json:"days_since_last_outbound"`
}

// daysSince returns whole days elapsed since t, or nil when t is not set.
func daysSince(now time.Time, t pgtype.Timestamptz) *int32 {
	if !t.Valid {
		return nil
	}
	days := int32(now.Sub(t.Time) / (24 * time.Hour))
	if days < 0 {
		days = 0
	}
	return &days
}

// ClampTurnover validates the days and limit parameters, applying defaults.
func ClampTurnover(days, limit int) (int32, int32, error) {
	if days == 0 {
		days = defaultTurnoverDays
	}
	if limit == 0 {
		limit = defaultTurnoverLimit
	}
	if days < 1 || days > maxTurnoverDays || limit < 1 || limit > maxTurnoverLimit {
		return 0, 0, apperror.Fail("INVALID_QUERY", "Days must be 1-365 and limit 1-50.", 400)
	}
	return int32(days), int32(limit), nil
}

// Turnover lists the fastest sellers and the slowest on-hand products in a window.
func (s *Service) Turnover(ctx context.Context, days, limit int32) (any, error) {
	top, err := s.Q.AnalyticsTopMovers(ctx, database.AnalyticsTopMoversParams{Days: days, RowLimit: limit})
	if err != nil {
		return nil, err
	}
	slowRows, err := s.Q.AnalyticsSlowMovers(ctx, database.AnalyticsSlowMoversParams{Days: days, RowLimit: limit})
	if err != nil {
		return nil, err
	}
	now := time.Now()
	slow := make([]SlowMover, 0, len(slowRows))
	for _, row := range slowRows {
		slow = append(slow, SlowMover{AnalyticsSlowMoversRow: row, DaysSinceLastOutbound: daysSince(now, row.LastOutboundAt)})
	}
	return map[string]any{"days": days, "top_movers": top, "slow_movers": slow}, nil
}

// SpendRange resolves the from/to query values (RFC3339 or YYYY-MM-DD; a date-only
// "to" includes that whole day). It defaults to the last 90 days.
func SpendRange(now time.Time, from, to string) (time.Time, time.Time, error) {
	end := now
	if to != "" {
		t, err := parseBoundary(to, true)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		end = t
	}
	start := end.AddDate(0, 0, -defaultTurnoverDays)
	if from != "" {
		t, err := parseBoundary(from, false)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		start = t
	}
	if !start.Before(end) || end.Sub(start) > maxSpendRange {
		return time.Time{}, time.Time{}, apperror.Fail("INVALID_QUERY", "The start date must be before the end date, within five years.", 400)
	}
	return start, end, nil
}

func parseBoundary(value string, endOfDay bool) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t, nil
	}
	t, err := time.Parse(time.DateOnly, value)
	if err != nil {
		return time.Time{}, apperror.Fail("INVALID_QUERY", "Dates must be RFC3339 or YYYY-MM-DD.", 400)
	}
	if endOfDay {
		t = t.AddDate(0, 0, 1)
	}
	return t, nil
}

// SupplierSpend sums purchase cost per supplier between from (inclusive) and to (exclusive).
func (s *Service) SupplierSpend(ctx context.Context, from, to time.Time) (any, error) {
	f := pgtype.Timestamptz{Time: from, Valid: true}
	t := pgtype.Timestamptz{Time: to, Valid: true}
	rows, err := s.Q.AnalyticsSupplierSpend(ctx, database.AnalyticsSupplierSpendParams{FromAt: f, ToAt: t})
	if err != nil {
		return nil, err
	}
	total, err := s.Q.AnalyticsSupplierSpendTotal(ctx, database.AnalyticsSupplierSpendTotalParams{FromAt: f, ToAt: t})
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}
	return map[string]any{
		"currency":    s.storeCurrency(ctx),
		"from":        from.UTC().Format(time.RFC3339),
		"to":          to.UTC().Format(time.RFC3339),
		"total_spend": total.Spend,
		"purchases":   total.Purchases,
		"suppliers":   rows,
	}, nil
}
