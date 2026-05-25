package errs

import (
	"errors"
	"testing"
)

func TestNewInvalidExternalURLError(t *testing.T) {
	err := NewInvalidExternalURLError("bad external URL")
	if !errors.Is(err, ErrInvalidExternalURL) {
		t.Fatalf("expected ErrInvalidExternalURL, got %v", err)
	}
	if got := err.Error(); got != "bad external URL" {
		t.Fatalf("message = %q", got)
	}
}
