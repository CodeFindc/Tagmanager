package service

import "testing"

func TestNormalizeTag(t *testing.T) {
	cases := map[string]string{
		"  Cloud-Computing  ": "cloudcomputing",
		"数据   治理":             "数据 治理",
		"API / Integration":   "api integration",
	}
	for input, expected := range cases {
		if actual := NormalizeTag(input); actual != expected {
			t.Errorf("NormalizeTag(%q) = %q, want %q", input, actual, expected)
		}
	}
}
