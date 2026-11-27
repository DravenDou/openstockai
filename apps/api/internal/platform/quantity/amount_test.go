package quantity

import (
	"encoding/json"
	"math/big"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestExactQuantities(t *testing.T) {
	for _, text := range []string{"0", "0.001", "1.25", "-0.5", "1000000000"} {
		var value Amount
		if err := json.Unmarshal([]byte(text), &value); err != nil {
			t.Fatal(text, err)
		}
		encoded, _ := json.Marshal(value)
		if string(encoded) != text {
			t.Fatalf("round trip %s: %s", text, encoded)
		}
		numeric, _ := value.NumericValue()
		var scanned Amount
		if err := scanned.ScanNumeric(numeric); err != nil || scanned != value {
			t.Fatalf("numeric round trip: %s %v", text, err)
		}
	}
	for _, text := range []string{`"0.5"`, "null", "0.0001", "1000000000.001", "1e3", "true"} {
		var value Amount
		if json.Unmarshal([]byte(text), &value) == nil {
			t.Fatalf("accepted invalid quantity %s", text)
		}
	}
	a, _ := Parse("0.1")
	b, _ := Parse("0.2")
	if (a + b).String() != "0.3" {
		t.Fatal("fraction arithmetic lost precision")
	}
	if a.Fits(0) || !a.Fits(1) || Amount(1).Fits(2) || !Amount(1).Fits(3) {
		t.Fatal("unit precision ignored")
	}
	var value Amount
	if err := value.ScanNumeric(pgtype.Numeric{Int: big.NewInt(12500), Exp: -4, Valid: true}); err != nil || value.String() != "1.25" {
		t.Fatal("equivalent scale rejected", err)
	}
	if value.ScanNumeric(pgtype.Numeric{Int: big.NewInt(12501), Exp: -4, Valid: true}) == nil {
		t.Fatal("database quantity silently rounded")
	}
}
