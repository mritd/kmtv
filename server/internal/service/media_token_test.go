package service

import (
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/store"
)

func TestMediaTokenServiceSignAndVerify(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = s.Close() }()
	svc := NewMediaTokenService(s)

	token, err := svc.IssueMediaToken(0, MediaKindSegment, "https://media.example/a.ts", "src", 30*time.Minute)
	if err != nil {
		t.Fatalf("IssueMediaToken: %v", err)
	}
	if token == "" {
		t.Fatal("expected token")
	}
	ok, err := svc.VerifyMediaToken(token, MediaKindSegment, "https://media.example/a.ts")
	if err != nil {
		t.Fatalf("VerifyMediaToken: %v", err)
	}
	if !ok {
		t.Fatal("expected token to verify")
	}
	ok, err = svc.VerifyMediaToken(token, MediaKindSegment, "https://media.example/b.ts")
	if err != nil {
		t.Fatalf("VerifyMediaToken wrong url: %v", err)
	}
	if ok {
		t.Fatal("token must be bound to exact URL")
	}
	ok, err = svc.VerifyMediaToken(token, MediaKindKey, "https://media.example/a.ts")
	if err != nil {
		t.Fatalf("VerifyMediaToken wrong kind: %v", err)
	}
	if ok {
		t.Fatal("token must be bound to kind")
	}
}

func TestMediaTokenServiceRejectsInvalidInputs(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = s.Close() }()
	svc := NewMediaTokenService(s)

	if _, err := svc.IssueMediaToken(0, MediaKindSegment, "file:///tmp/a.ts", "src", time.Minute); err == nil {
		t.Fatal("expected invalid URL error")
	}
	if _, err := svc.IssueMediaToken(0, MediaKindSegment, "https://media.example/a.ts", "src", 0); err == nil {
		t.Fatal("expected ttl error")
	}
	ok, err := svc.VerifyMediaToken("bad-token", MediaKindSegment, "https://media.example/a.ts")
	if err != nil {
		t.Fatalf("VerifyMediaToken invalid token: %v", err)
	}
	if ok {
		t.Fatal("invalid token should not verify")
	}
}

func TestMediaTokenServiceStoreFailures(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	svc := NewMediaTokenService(s)
	token, err := svc.IssueMediaToken(0, MediaKindSegment, "https://media.example/a.ts", "src", time.Minute)
	if err != nil {
		t.Fatalf("IssueMediaToken before close: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	if _, err := svc.IssueMediaToken(0, MediaKindSegment, "https://media.example/b.ts", "src", time.Minute); err == nil {
		t.Fatal("expected IssueMediaToken to fail after store close")
	}
	if _, err := svc.VerifyMediaToken(token, MediaKindSegment, "https://media.example/a.ts"); err == nil {
		t.Fatal("expected VerifyMediaToken to fail after store close")
	}
}
