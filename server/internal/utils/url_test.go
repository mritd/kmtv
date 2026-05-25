package utils

import (
	"errors"
	"testing"

	"github.com/mritd/kmtv/internal/errs"
)

func TestValidateExternalURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"valid http", "http://example.com/video.m3u8", false},
		{"valid https", "https://example.com/video.m3u8", false},
		{"ftp scheme blocked", "ftp://example.com/file", true},
		{"file scheme blocked", "file:///etc/passwd", true},
		{"empty scheme blocked", "://no-scheme", true},
		{"javascript blocked", "javascript:alert(1)", true},
		{"relative URL blocked", "/path/to/file", true},
		{"http URL without host blocked", "http:///path/to/file", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateExternalURL(tt.url)
			if tt.wantErr && err == nil {
				t.Errorf("expected error for URL %q", tt.url)
			}
			if tt.wantErr && !errors.Is(err, errs.ErrInvalidExternalURL) {
				t.Errorf("expected ErrInvalidExternalURL for URL %q, got %v", tt.url, err)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error for URL %q: %v", tt.url, err)
			}
		})
	}
}

func TestValidateExternalURLPreservesErrorMessageAndSentinel(t *testing.T) {
	err := ValidateExternalURL("ftp://example.com/file")
	if !errors.Is(err, errs.ErrInvalidExternalURL) {
		t.Fatalf("expected ErrInvalidExternalURL, got %v", err)
	}
	if got := err.Error(); got != "only http/https URLs are allowed" {
		t.Fatalf("error message = %q", got)
	}
}

func TestResolveURL(t *testing.T) {
	tests := []struct {
		name string
		base string
		ref  string
		want string
	}{
		{
			name: "absolute URL unchanged",
			base: "https://example.com/path/",
			ref:  "https://cdn.example.com/video.ts",
			want: "https://cdn.example.com/video.ts",
		},
		{
			name: "relative file",
			base: "https://example.com/path/",
			ref:  "segment.ts",
			want: "https://example.com/path/segment.ts",
		},
		{
			name: "absolute path",
			base: "https://example.com/path/",
			ref:  "/other/segment.ts",
			want: "https://example.com/other/segment.ts",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveURL(tt.base, tt.ref)
			if got != tt.want {
				t.Errorf("ResolveURL(%q, %q) = %q, want %q", tt.base, tt.ref, got, tt.want)
			}
		})
	}
}

func TestExtractBaseURL(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"https://example.com/path/to/file.m3u8", "https://example.com/path/to/"},
		{"https://example.com/file.m3u8", "https://example.com/"},
		{"nopath", "nopath"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ExtractBaseURL(tt.input)
			if got != tt.want {
				t.Errorf("ExtractBaseURL(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
