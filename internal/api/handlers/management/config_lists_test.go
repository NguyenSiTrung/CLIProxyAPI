package management

import (
	"testing"
	"time"
)

func TestParseCompoundDuration(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    time.Duration
		wantErr bool
	}{
		// Simple durations
		{"simple hours", "1h", time.Hour, false},
		{"simple days", "2d", 48 * time.Hour, false},
		{"simple minutes", "30m", 30 * time.Minute, false},
		{"uppercase hours", "3H", 3 * time.Hour, false},

		// Compound durations
		{"hours and minutes", "3h12m", 3*time.Hour + 12*time.Minute, false},
		{"days and hours", "2d6h", 54 * time.Hour, false},
		{"full compound", "1d12h30m", 36*time.Hour + 30*time.Minute, false},
		{"days and minutes", "1d30m", 24*time.Hour + 30*time.Minute, false},

		// Edge cases
		{"zero values mixed", "0h30m", 30 * time.Minute, false},

		// Error cases
		{"empty string", "", 0, true},
		{"no unit", "123", 0, true},
		{"invalid char", "3h12x", 0, true},
		{"missing number", "h", 0, true},
		{"double unit", "3hh", 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseCompoundDuration(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseCompoundDuration(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("parseCompoundDuration(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseExpiresIn(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantNil bool
		wantErr bool
	}{
		{"empty", "", true, false},
		{"simple hour", "1h", false, false},
		{"compound", "3h12m", false, false},
		{"rfc3339", "2030-01-01T00:00:00Z", false, false},
		{"invalid", "abc", true, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseExpiresIn(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseExpiresIn(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if (got == nil) != tt.wantNil {
				t.Errorf("parseExpiresIn(%q) = %v, wantNil %v", tt.input, got, tt.wantNil)
			}
		})
	}
}
