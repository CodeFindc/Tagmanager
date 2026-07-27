package service

import (
	"strings"
	"unicode"
)

// NormalizeTag produces a deterministic key used for exact published-tag matching.
func NormalizeTag(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	value = strings.Join(strings.Fields(value), " ")
	value = strings.Map(func(r rune) rune {
		switch {
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			return -1
		case unicode.IsSpace(r):
			return ' '
		default:
			return r
		}
	}, value)
	return strings.Join(strings.Fields(value), " ")
}
