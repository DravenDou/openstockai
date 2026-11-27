package inventory

import "testing"

func TestValidOperationAllowlist(t *testing.T) {
	const id = "0b6f5a50-3c1f-4c5e-9a53-2c6d1f1c0a11"
	allowed := []string{
		"GET /v1/products/by-sku", "GET /v1/purchases-page", "GET /v1/purchases/" + id,
		"GET /v1/audit-page", "GET /v1/settings", "PATCH /v1/settings",
		"POST /v1/purchases", "POST /v1/inventory/counts", "POST /v1/units",
		"PATCH /v1/categories/" + id, "DELETE /v1/suppliers/" + id, "DELETE /v1/warehouses/" + id,
		"DELETE /v1/products/" + id, "POST /v1/products/" + id + "/restore",
	}
	for _, operation := range allowed {
		if !validOperation(operation) {
			t.Errorf("%q should be allowed", operation)
		}
	}
	denied := []string{
		"GET /v1/agent-actions", "DELETE /v1/purchases/" + id, "PATCH /v1/purchases/" + id,
		"GET /v1/audit-logs", "DELETE /v1/units/" + id, "POST /v1/settings", "GET /v1/purchases/not-an-id",
	}
	for _, operation := range denied {
		if validOperation(operation) {
			t.Errorf("%q must not be allowed", operation)
		}
	}
}

func TestDestructiveOperationsAlwaysNeedApproval(t *testing.T) {
	const id = "0b6f5a50-3c1f-4c5e-9a53-2c6d1f1c0a11"
	for _, operation := range []string{"DELETE /v1/categories/" + id, "DELETE /v1/products/" + id, "POST /v1/products/" + id + "/restore"} {
		if !needsApproval(true, operation, false) {
			t.Errorf("%q must need approval even with auto-approve on", operation)
		}
	}
	if needsApproval(true, "POST /v1/purchases", false) {
		t.Error("a routine purchase should not need approval when auto-approve is on")
	}
}
