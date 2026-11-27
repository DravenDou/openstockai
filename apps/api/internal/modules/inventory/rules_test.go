package inventory

import "testing"

func TestMoneyAndMovementValidation(t *testing.T) {
	for _, value := range []string{"0", "10.10", "9999999999999999.99"} {
		if !ValidMoney(value) {
			t.Fatalf("rejected valid decimal %s", value)
		}
	}
	for _, value := range []string{"-1", "1.001", "1e2", "NaN", "10000000000000000.00"} {
		if ValidMoney(value) {
			t.Fatalf("accepted invalid money %s", value)
		}
	}
	id := "550e8400-e29b-41d4-a716-446655440000"
	for _, a := range []Adjustment{{ProductID: id, WarehouseID: id, Quantity: -1, Type: "purchase"}, {ProductID: id, WarehouseID: id, Quantity: 1, Type: "sale"}, {ProductID: id, WarehouseID: id, Quantity: 0, Type: "initial"}, {ProductID: id, WarehouseID: id, Quantity: 1, Type: "transfer_in"}} {
		if a.Validate() == nil {
			t.Fatal("invalid movement accepted")
		}
	}
}
