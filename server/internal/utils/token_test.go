package utils

import (
	"strings"
	"testing"

	"github.com/mritd/kmtv/internal/base58"
)

func TestGenerateOpaqueTokenReturnsBase58RandomToken(t *testing.T) {
	first, err := GenerateOpaqueToken()
	if err != nil {
		t.Fatalf("GenerateOpaqueToken first: %v", err)
	}
	second, err := GenerateOpaqueToken()
	if err != nil {
		t.Fatalf("GenerateOpaqueToken second: %v", err)
	}
	if first == second {
		t.Fatal("two generated tokens should differ")
	}
	if len(first) < 40 || len(first) > 50 {
		t.Fatalf("token length = %d, want base58 encoded 32 bytes", len(first))
	}
	if decoded := base58.Decode(first); len(decoded) != opaqueTokenBytes {
		t.Fatalf("decoded token bytes = %d, want %d", len(decoded), opaqueTokenBytes)
	}
	if strings.ContainsAny(first, "0OIl+/=") {
		t.Fatalf("token contains non-copy-friendly characters: %q", first)
	}
}

func TestHashTokenIsStableAndDoesNotExposeToken(t *testing.T) {
	token := "5HueCGU8rMjxEXxiPuD5BDuV7UEh2qFqQeTvmM8"
	first := HashToken(token)
	second := HashToken(token)
	if first != second {
		t.Fatal("HashToken should be stable")
	}
	if first == token || strings.Contains(first, token) {
		t.Fatal("hash must not expose plaintext token")
	}
	if len(first) != 64 {
		t.Fatalf("sha256 hex length = %d, want 64", len(first))
	}
}

func TestValidateOpaqueToken(t *testing.T) {
	valid, err := GenerateOpaqueToken()
	if err != nil {
		t.Fatalf("GenerateOpaqueToken: %v", err)
	}
	tests := []struct {
		name string
		in   string
		ok   bool
	}{
		{name: "valid", in: valid, ok: true},
		{name: "empty", in: "", ok: false},
		{name: "invalid charset", in: "abc0", ok: false},
		{name: "too short", in: "abc", ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateOpaqueToken(tt.in)
			if tt.ok && err != nil {
				t.Fatalf("ValidateOpaqueToken error: %v", err)
			}
			if !tt.ok && err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}
