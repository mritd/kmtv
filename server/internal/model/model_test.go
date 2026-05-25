package model

import "testing"

func TestFormatID(t *testing.T) {
	tests := []struct {
		name string
		id   any
		want string
	}{
		{name: "float64 from json", id: float64(101), want: "101"},
		{name: "string id", id: "abc", want: "abc"},
		{name: "integer fallback", id: 42, want: "42"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatID(tt.id); got != tt.want {
				t.Fatalf("FormatID() = %q, want %q", got, tt.want)
			}
		})
	}
}
