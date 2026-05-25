package utils

import "testing"

func TestExtractBearerToken(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"empty", "", ""},
		{"missing prefix", "Basic abc", ""},
		{"valid", "Bearer token123", "token123"},
		{"trim spaces", "  Bearer   token123  ", "token123"},
		{"case sensitive", "bearer token123", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExtractBearerToken(tt.header); got != tt.want {
				t.Fatalf("ExtractBearerToken(%q) = %q, want %q", tt.header, got, tt.want)
			}
		})
	}
}
