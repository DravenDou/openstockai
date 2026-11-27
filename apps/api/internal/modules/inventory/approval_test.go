package inventory

import "testing"

func TestApprovalPolicy(t *testing.T) {
	cases := []struct {
		name      string
		auto      bool
		operation string
		highRisk  bool
		want      bool
	}{
		{"auto on, low risk create", true, "POST /v1/products", false, false},
		{"auto on, low risk patch", true, "PATCH /v1/products/1", false, false},
		{"auto off, low risk create", false, "POST /v1/products", false, true},
		{"auto on, high risk", true, "POST /v1/inventory/adjustments", true, true},
		{"auto on, product delete", true, "DELETE /v1/products/1", false, true},
		{"auto on, supplier delete", true, "DELETE /v1/suppliers/1", false, true},
		{"auto on, restore", true, "POST /v1/products/1/restore", false, true},
		{"auto on, archive", true, "POST /v1/products/1/archive", false, true},
		{"auto off, restore", false, "POST /v1/products/1/restore", false, true},
	}
	for _, c := range cases {
		if got := needsApproval(c.auto, c.operation, c.highRisk); got != c.want {
			t.Errorf("%s: needsApproval=%v, want %v", c.name, got, c.want)
		}
	}
}

func TestIsDestructive(t *testing.T) {
	for _, op := range []string{"DELETE /v1/products/1", "DELETE /v1/categories/1", "POST /v1/products/1/restore", "POST /v1/products/1/archive"} {
		if !isDestructive(op) {
			t.Errorf("%s should be destructive", op)
		}
	}
	for _, op := range []string{"POST /v1/products", "PATCH /v1/products/1", "POST /v1/inventory/adjustments", "GET /v1/products/1", "PATCH /v1/settings"} {
		if isDestructive(op) {
			t.Errorf("%s should not be destructive", op)
		}
	}
}
