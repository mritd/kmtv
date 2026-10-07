package avatar

import (
	"bytes"
	"strings"
	"testing"
)

func TestDefaultIsAGIF(t *testing.T) {
	if !bytes.HasPrefix(Default(), []byte("GIF89a")) {
		t.Fatal("default avatar is not a GIF89a image")
	}
}

func TestURLMarksTheDefault(t *testing.T) {
	got, isDefault := URL("alice", "")
	if !isDefault || got != "/api/v1/avatar/alice?v="+defaultVersion {
		t.Fatalf("URL(alice, empty) = %q, %v", got, isDefault)
	}
}

func TestURLVersionFollowsTheImage(t *testing.T) {
	a, isDefault := URL("alice", "data:image/png;base64,AAAA")
	if isDefault {
		t.Fatal("an uploaded avatar is not the default")
	}
	b, _ := URL("alice", "data:image/png;base64,BBBB")
	again, _ := URL("alice", "data:image/png;base64,AAAA")
	if a == b || a != again {
		t.Fatalf("versions: %q, %q, %q", a, b, again)
	}
	if !strings.HasPrefix(a, "/api/v1/avatar/alice?v=") {
		t.Fatalf("unexpected URL %q", a)
	}
}
