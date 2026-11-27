// Package quantity represents stock exactly in thousandths of a measurement unit.
package quantity

import (
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

type Amount int64

const Scale Amount = 1000
const Max Amount = 1000000000 * Scale

var pattern = regexp.MustCompile(`^-?\d{1,10}(\.\d{1,3})?$`)

func Parse(text string) (Amount, error) {
	if !pattern.MatchString(text) {
		return 0, fmt.Errorf("invalid quantity: use up to three decimals")
	}
	negative := strings.HasPrefix(text, "-")
	parts := strings.Split(strings.TrimPrefix(text, "-"), ".")
	whole, _ := strconv.ParseInt(parts[0], 10, 64)
	fraction := "000"
	if len(parts) == 2 {
		fraction = parts[1] + strings.Repeat("0", 3-len(parts[1]))
	}
	decimals, _ := strconv.ParseInt(fraction, 10, 64)
	value := Amount(whole*1000 + decimals)
	if value > Max {
		return 0, fmt.Errorf("cantidad fuera de rango")
	}
	if negative {
		value = -value
	}
	return value, nil
}

func (a Amount) String() string {
	sign := ""
	if a < 0 {
		sign = "-"
		a = -a
	}
	return sign + strings.TrimRight(strings.TrimRight(fmt.Sprintf("%d.%03d", a/Scale, a%Scale), "0"), ".")
}
func (a Amount) MarshalJSON() ([]byte, error) { return []byte(a.String()), nil }
func (a *Amount) UnmarshalJSON(raw []byte) error {
	var number json.Number
	if len(raw) == 0 || raw[0] == '"' || string(raw) == "null" {
		return fmt.Errorf("the quantity must be a number")
	}
	if err := json.Unmarshal(raw, &number); err != nil {
		return err
	}
	value, err := Parse(number.String())
	if err == nil {
		*a = value
	}
	return err
}
func (a Amount) NumericValue() (pgtype.Numeric, error) {
	return pgtype.Numeric{Int: big.NewInt(int64(a)), Exp: -3, Valid: true}, nil
}
func (a *Amount) ScanNumeric(value pgtype.Numeric) error {
	if !value.Valid || value.NaN || value.InfinityModifier != 0 {
		return fmt.Errorf("cantidad no finita")
	}
	coefficient := new(big.Int).Set(value.Int)
	exponent := value.Exp + 3
	if exponent >= 0 {
		coefficient.Mul(coefficient, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(exponent)), nil))
	} else {
		divisor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(-exponent)), nil)
		remainder := new(big.Int)
		coefficient.QuoRem(coefficient, divisor, remainder)
		if remainder.Sign() != 0 {
			return fmt.Errorf("quantity has more than three decimals")
		}
	}
	if !coefficient.IsInt64() {
		return fmt.Errorf("cantidad fuera de rango")
	}
	*a = Amount(coefficient.Int64())
	return nil
}

func (a Amount) Fits(decimals int32) bool {
	switch decimals {
	case 0:
		return a%1000 == 0
	case 1:
		return a%100 == 0
	case 2:
		return a%10 == 0
	case 3:
		return true
	default:
		return false
	}
}
