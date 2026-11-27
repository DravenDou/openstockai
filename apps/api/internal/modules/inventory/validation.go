package inventory

import "regexp"

var money = regexp.MustCompile(`^\d{1,16}(\.\d{1,2})?$`)

func ValidMoney(value string) bool { return money.MatchString(value) }
