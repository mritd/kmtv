package utils

import "testing"

func TestStripHTML(t *testing.T) {
	got := StripHTML(" <p>Hello <b>World</b></p> ")
	if got != "Hello World" {
		t.Fatalf("StripHTML() = %q, want Hello World", got)
	}
}

func TestTruncate(t *testing.T) {
	if got := Truncate("hello", 10); got != "hello" {
		t.Fatalf("Truncate short = %q, want hello", got)
	}
	if got := Truncate("你好世界", 2); got != "你好..." {
		t.Fatalf("Truncate unicode = %q, want 你好...", got)
	}
}
