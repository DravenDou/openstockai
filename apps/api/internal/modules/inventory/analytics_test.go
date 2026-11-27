package inventory

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestClampTurnover(t *testing.T) {
	if d, l, err := ClampTurnover(0, 0); err != nil || d != 90 || l != 10 {
		t.Fatalf("defaults: %d %d %v", d, l, err)
	}
	for _, c := range [][2]int{{-1, 5}, {366, 5}, {30, 51}, {30, -2}} {
		if _, _, err := ClampTurnover(c[0], c[1]); err == nil {
			t.Fatalf("accepted %v", c)
		}
	}
}

func TestSpendRange(t *testing.T) {
	now := time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)
	from, to, err := SpendRange(now, "", "")
	if err != nil || !to.Equal(now) || !from.Equal(now.AddDate(0, 0, -90)) {
		t.Fatalf("default range %v %v %v", from, to, err)
	}
	from, to, err = SpendRange(now, "2026-01-01", "2026-01-31")
	if err != nil || !from.Equal(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)) || !to.Equal(time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("date range %v %v %v", from, to, err)
	}
	for _, c := range [][2]string{{"2026-02-01", "2026-01-01"}, {"nope", ""}, {"", "2026/01/01"}, {"2000-01-01", "2026-01-01"}} {
		if _, _, err := SpendRange(now, c[0], c[1]); err == nil {
			t.Fatalf("accepted %v", c)
		}
	}
}

func TestDaysSince(t *testing.T) {
	now := time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)
	if daysSince(now, pgtype.Timestamptz{}) != nil {
		t.Fatal("unset timestamp must have no days")
	}
	if d := daysSince(now, pgtype.Timestamptz{Time: now.Add(-49 * time.Hour), Valid: true}); d == nil || *d != 2 {
		t.Fatalf("days %v", d)
	}
}
