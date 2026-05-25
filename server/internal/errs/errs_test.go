package errs

import "testing"

func TestErrorAndWithMsg(t *testing.T) {
	err := InvalidRequest.WithMsg("custom message")
	if err.Code != InvalidRequest.Code {
		t.Fatalf("code = %d, want %d", err.Code, InvalidRequest.Code)
	}
	if err.Message != "custom message" {
		t.Fatalf("message = %q, want custom message", err.Message)
	}
	if got := err.Error(); got != "[1000] custom message" {
		t.Fatalf("Error() = %q", got)
	}
	if InvalidRequest.Message == "custom message" {
		t.Fatal("WithMsg mutated the original error value")
	}
}
