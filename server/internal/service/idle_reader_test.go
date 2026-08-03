package service

import (
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

// slowReader emits one chunk per interval — a slow but healthy link.
type slowReader struct {
	chunks   []string
	interval time.Duration
	idx      int
}

func (s *slowReader) Read(p []byte) (int, error) {
	if s.idx >= len(s.chunks) {
		return 0, io.EOF
	}
	time.Sleep(s.interval)
	n := copy(p, s.chunks[s.idx])
	s.idx++
	return n, nil
}

func (s *slowReader) Close() error { return nil }

// blockingReader parks until Close, standing in for a peer that accepted the
// connection and then went silent. Close is what the watchdog uses to break it,
// so it must be safe to call from both the watchdog and the deferred cleanup.
type blockingReader struct {
	released chan struct{}
	once     sync.Once
}

func newBlockingReader() *blockingReader {
	return &blockingReader{released: make(chan struct{})}
}

func (b *blockingReader) Read(p []byte) (int, error) {
	<-b.released
	return 0, errors.New("read on closed body")
}

func (b *blockingReader) Close() error {
	b.once.Do(func() { close(b.released) })
	return nil
}

// A body that keeps producing bytes must survive well past the idle window:
// this is the slow-but-alive link the whole timeout change exists to support.
func TestIdleTimeoutReaderAllowsSlowButContinuousBody(t *testing.T) {
	src := &slowReader{
		chunks:   []string{"aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg", "hhh", "iii", "jjj"},
		interval: 30 * time.Millisecond,
	}
	// Total read time (~300ms) deliberately exceeds the idle window; progress
	// keeps resetting the watchdog, which is the property under test.
	r := newIdleTimeoutReader(src, 200*time.Millisecond)
	defer func() { _ = r.Close() }()

	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("slow but continuous body should succeed, got %v", err)
	}
	if string(got) != "aaabbbcccdddeeefffggghhhiiijjj" {
		t.Fatalf("body = %q, want %q", string(got), "aaabbbcccdddeeefffggghhhiiijjj")
	}
}

func TestIdleTimeoutReaderAbortsStalledBody(t *testing.T) {
	src := newBlockingReader()
	r := newIdleTimeoutReader(src, 100*time.Millisecond)
	defer func() { _ = r.Close() }()

	done := make(chan error, 1)
	go func() {
		_, err := io.ReadAll(r)
		done <- err
	}()

	select {
	case err := <-done:
		if !errors.Is(err, errIdleTimeout) {
			t.Fatalf("error = %v, want errIdleTimeout", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("stalled body was never aborted; the watchdog did not fire")
	}
}

func TestIdleTimeoutReaderPassesThroughNormalBody(t *testing.T) {
	r := newIdleTimeoutReader(io.NopCloser(strings.NewReader("payload")), time.Second)
	defer func() { _ = r.Close() }()

	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(got) != "payload" {
		t.Fatalf("body = %q, want %q", string(got), "payload")
	}
}

// A non-positive timeout disables the guard rather than failing every read.
func TestIdleTimeoutReaderDisabledWhenNonPositive(t *testing.T) {
	src := io.NopCloser(strings.NewReader("payload"))
	r := newIdleTimeoutReader(src, 0)
	if r != src {
		t.Fatal("non-positive idle should return the body unwrapped")
	}

	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(got) != "payload" {
		t.Fatalf("body = %q, want %q", string(got), "payload")
	}
}
