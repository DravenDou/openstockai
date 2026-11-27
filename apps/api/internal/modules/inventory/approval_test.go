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

func TestIsHighRisk(t *testing.T) {
	cases := []struct {
		name      string
		operation string
		raw       string
		want      bool
	}{
		{"adjustment at limit", "POST /v1/inventory/adjustments", `{"quantity":1000}`, false},
		{"adjustment above limit", "POST /v1/inventory/adjustments", `{"quantity":1000.001}`, true},
		{"negative adjustment above limit", "POST /v1/inventory/adjustments", `{"quantity":-2000}`, true},
		{"small adjustment", "POST /v1/inventory/adjustments", `{"quantity":5}`, false},
		{"transfer above limit", "POST /v1/inventory/transfers", `{"quantity":1500}`, true},
		{"small transfer", "POST /v1/inventory/transfers", `{"quantity":10}`, false},
		{"product with large initial stock", "POST /v1/products", `{"name":"A","initialStock":5000}`, true},
		{"product without initial stock", "POST /v1/products", `{"name":"A"}`, false},
		{"count with large counted", "POST /v1/inventory/counts", `{"counted":2000,"expected":1}`, true},
		{"count with large expected", "POST /v1/inventory/counts", `{"counted":1,"expected":2000}`, true},
		{"small count", "POST /v1/inventory/counts", `{"counted":10,"expected":12}`, false},
		{"purchase summed above limit", "POST /v1/purchases", `{"items":[{"quantity":600},{"quantity":600}]}`, true},
		{"purchase at limit", "POST /v1/purchases", `{"items":[{"quantity":600},{"quantity":400}]}`, false},
		{"small purchase", "POST /v1/purchases", `{"items":[{"quantity":3}]}`, false},
		{"unparseable adjustment fails safe", "POST /v1/inventory/adjustments", `{"quantity":"lots"}`, true},
		{"unparseable purchase fails safe", "POST /v1/purchases", `[]`, true},
		{"delete is not quantity-based", "DELETE /v1/products/1", `{}`, false},
		{"restore is not quantity-based", "POST /v1/products/1/restore", `{}`, false},
		{"settings", "PATCH /v1/settings", `{"automatic":true}`, false},
	}
	for _, c := range cases {
		if got := isHighRisk(c.operation, []byte(c.raw)); got != c.want {
			t.Errorf("%s: isHighRisk=%v, want %v", c.name, got, c.want)
		}
	}
}

// Every write kind must be covered: either quantity-based risk or destructive.
func TestEveryWriteKindIsClassified(t *testing.T) {
	big := map[string]string{
		"POST /v1/inventory/adjustments": `{"quantity":5000}`,
		"POST /v1/inventory/transfers":   `{"quantity":5000}`,
		"POST /v1/products":              `{"initialStock":5000}`,
		"POST /v1/inventory/counts":      `{"counted":5000}`,
		"POST /v1/purchases":             `{"items":[{"quantity":5000}]}`,
	}
	for op, raw := range big {
		if !isHighRisk(op, []byte(raw)) {
			t.Errorf("%s with a large quantity must be high risk", op)
		}
	}
	for _, op := range []string{"DELETE /v1/products/1", "DELETE /v1/warehouses/1", "POST /v1/products/1/restore", "POST /v1/products/1/archive"} {
		if !isDestructive(op) {
			t.Errorf("%s must be destructive", op)
		}
	}
}
