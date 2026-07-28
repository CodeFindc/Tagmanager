package service

import (
	"testing"
)

func TestValidatePasswordStrength(t *testing.T) {
	tests := []struct {
		name     string
		password string
		wantErr  bool
	}{
		{"too short", "Short1!", true},
		{"missing upper", "weakpassword123!", true},
		{"missing lower", "WEAKPASSWORD123!", true},
		{"missing number", "WeakPasswordSpecial!", true},
		{"missing special", "WeakPassword1234", true},
		{"valid strong password", "ValidPass123!#", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePasswordStrength(tt.password)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidatePasswordStrength(%q) error = %v, wantErr %v", tt.password, err, tt.wantErr)
			}
		})
	}
}
