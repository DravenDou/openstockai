package validate

import (
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

func ID(value string) bool { _, err := uuid.Parse(value); return err == nil }
func Name(value string, max int) bool {
	return strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= max
}
