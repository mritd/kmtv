package utils

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestGoProcessPreservesInputOrderAndLimitsConcurrency(t *testing.T) {
	items := []int{1, 2, 3, 4, 5}
	var running atomic.Int32
	var maxRunning atomic.Int32

	got, err := GoProcess(context.Background(), items, 2, false, func(ctx context.Context, n int) (int, error) {
		current := running.Add(1)
		for {
			seen := maxRunning.Load()
			if current <= seen || maxRunning.CompareAndSwap(seen, current) {
				break
			}
		}
		defer running.Add(-1)

		time.Sleep(5 * time.Millisecond)
		return n * 10, nil
	})
	if err != nil {
		t.Fatalf("GoProcess returned error: %v", err)
	}
	if maxRunning.Load() > 2 {
		t.Fatalf("max concurrency = %d, want <= 2", maxRunning.Load())
	}
	want := []int{10, 20, 30, 40, 50}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("result[%d] = %d, want %d", i, got[i], want[i])
		}
	}
}

func TestGoProcessFailFastReturnsFirstErrorAndCancelsWork(t *testing.T) {
	wantErr := errors.New("stop")
	var sawCancel atomic.Bool
	var started atomic.Int32

	_, err := GoProcess(context.Background(), []int{1, 2, 3}, 3, true, func(ctx context.Context, n int) (int, error) {
		started.Add(1)
		if n == 1 {
			for started.Load() < 3 {
				time.Sleep(time.Millisecond)
			}
			return 0, wantErr
		}
		<-ctx.Done()
		sawCancel.Store(true)
		return 0, ctx.Err()
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
	if !sawCancel.Load() {
		t.Fatal("expected sibling workers to observe cancellation")
	}
}

func TestGoProcessBestEffortProcessesAllItemsAndJoinsErrors(t *testing.T) {
	errEven := errors.New("even")
	var processed atomic.Int32

	got, err := GoProcess(context.Background(), []int{1, 2, 3, 4}, 2, false, func(ctx context.Context, n int) (int, error) {
		processed.Add(1)
		if n%2 == 0 {
			return 0, errEven
		}
		return n * 10, nil
	})
	if !errors.Is(err, errEven) {
		t.Fatalf("error = %v, want joined error containing %v", err, errEven)
	}
	if processed.Load() != 4 {
		t.Fatalf("processed = %d, want 4", processed.Load())
	}
	if got[0] != 10 || got[1] != 0 || got[2] != 30 || got[3] != 0 {
		t.Fatalf("results = %#v, want partial ordered results", got)
	}
}

func TestGoProcessHandlesEmptyInputNilContextAndInvalidProcessor(t *testing.T) {
	var ctx context.Context
	got, err := GoProcess[int, int](ctx, nil, 0, false, func(ctx context.Context, n int) (int, error) {
		return n, nil
	})
	if err != nil {
		t.Fatalf("GoProcess returned error for empty input: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("len(results) = %d, want 0", len(got))
	}

	_, err = GoProcess[int, int](context.Background(), []int{1}, 1, false, nil)
	if err == nil {
		t.Fatal("expected error for nil processor")
	}
}

func TestGoProcessConvertsWorkerPanicToError(t *testing.T) {
	_, err := GoProcess(context.Background(), []int{1}, 1, true, func(ctx context.Context, n int) (int, error) {
		panic("boom")
	})
	if err == nil {
		t.Fatal("expected panic to be returned as error")
	}
}

func TestGoProcessMapProcessesMapValues(t *testing.T) {
	got, err := GoProcessMap(context.Background(), map[string]int{"a": 1, "b": 2}, 2, false, func(ctx context.Context, key string, value int) (string, int, error) {
		return key + key, value * 10, nil
	})
	if err != nil {
		t.Fatalf("GoProcessMap returned error: %v", err)
	}
	if got["aa"] != 10 || got["bb"] != 20 {
		t.Fatalf("result = %#v, want aa=10 and bb=20", got)
	}
}

func TestGoProcessMapBestEffortProcessesAllEntriesAndJoinsErrors(t *testing.T) {
	wantErr := errors.New("bad value")
	var processed atomic.Int32

	got, err := GoProcessMap(context.Background(), map[string]int{"a": 1, "b": 2}, 2, false, func(ctx context.Context, key string, value int) (string, int, error) {
		processed.Add(1)
		if key == "b" {
			return "", 0, wantErr
		}
		return key, value, nil
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want joined error containing %v", err, wantErr)
	}
	if processed.Load() != 2 {
		t.Fatalf("processed = %d, want 2", processed.Load())
	}
	if got["a"] != 1 {
		t.Fatalf("result = %#v, want a=1", got)
	}
	if _, ok := got["b"]; ok {
		t.Fatalf("result = %#v, want failed key omitted", got)
	}
}

func TestGoProcessMapHandlesEmptyInputNilContextAndInvalidProcessor(t *testing.T) {
	var ctx context.Context
	got, err := GoProcessMap[string, int, string, int](ctx, nil, 0, false, func(ctx context.Context, key string, value int) (string, int, error) {
		return key, value, nil
	})
	if err != nil {
		t.Fatalf("GoProcessMap returned error for empty input: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("len(results) = %d, want 0", len(got))
	}

	_, err = GoProcessMap[string, int, string, int](context.Background(), map[string]int{"a": 1}, 1, false, nil)
	if err == nil {
		t.Fatal("expected error for nil map processor")
	}
}

func TestGoProcessMapFailFastReturnsFirstErrorAndCancelsWork(t *testing.T) {
	wantErr := errors.New("map stop")
	var sawCancel atomic.Bool
	var started atomic.Int32

	_, err := GoProcessMap(context.Background(), map[string]int{"a": 1, "b": 2, "c": 3}, 3, true, func(ctx context.Context, key string, value int) (string, int, error) {
		started.Add(1)
		if key == "a" {
			for started.Load() < 3 {
				time.Sleep(time.Millisecond)
			}
			return "", 0, wantErr
		}
		<-ctx.Done()
		sawCancel.Store(true)
		return "", 0, ctx.Err()
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
	if !sawCancel.Load() {
		t.Fatal("expected sibling map workers to observe cancellation")
	}
}

func TestGoProcessMapConvertsWorkerPanicToError(t *testing.T) {
	_, err := GoProcessMap(context.Background(), map[string]int{"a": 1}, 1, true, func(ctx context.Context, key string, value int) (string, int, error) {
		panic("boom")
	})
	if err == nil {
		t.Fatal("expected panic to be returned as error")
	}
}

func TestGoProcessReturnsCanceledContextBeforeSchedulingAllWork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := GoProcess(ctx, []int{1, 2}, 1, false, func(ctx context.Context, n int) (int, error) {
		t.Fatal("processor should not run after pre-cancelled context")
		return n, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
}
