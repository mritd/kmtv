package utils

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

var errNilProcessor = errors.New("nil concurrent processor")

// GoProcess applies processor to each slice item with a concurrency limit and preserves result order.
// When failFast is true, it returns on the first processor error and cancels remaining work.
// When failFast is false, it processes all scheduled work and returns joined errors.
// GoProcess 按并发限制处理每个 slice item, 并保持返回结果顺序与输入一致.
// failFast 为 true 时, 它在首个 processor 错误后返回并取消剩余任务.
// failFast 为 false 时, 它会处理所有已调度任务并返回合并后的错误.
func GoProcess[T any, R any](
	ctx context.Context,
	items []T,
	concurrency int,
	failFast bool,
	processor func(context.Context, T) (R, error),
) ([]R, error) {
	results := make([]R, len(items))
	if len(items) == 0 {
		return results, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if processor == nil {
		return nil, errNilProcessor
	}
	if concurrency <= 0 {
		concurrency = 1
	}
	if concurrency > len(items) {
		concurrency = len(items)
	}

	type task struct {
		index int
		item  T
	}

	tasks := make([]task, 0, len(items))
	for i, item := range items {
		tasks = append(tasks, task{index: i, item: item})
	}

	err := goProcessTasks(ctx, tasks, concurrency, failFast, func(ctx context.Context, task task) error {
		result, err := runSliceProcessor(ctx, processor, task.item)
		if err != nil {
			return err
		}
		results[task.index] = result
		return nil
	})
	return results, err
}

// GoProcessMap applies processor to each map entry with a concurrency limit.
// When failFast is true, it returns on the first processor error and cancels remaining work.
// When failFast is false, it processes all scheduled work and returns joined errors.
// GoProcessMap 按并发限制处理每个 map entry.
// failFast 为 true 时, 它在首个 processor 错误后返回并取消剩余任务.
// failFast 为 false 时, 它会处理所有已调度任务并返回合并后的错误.
func GoProcessMap[K comparable, T any, X comparable, R any](
	ctx context.Context,
	input map[K]T,
	concurrency int,
	failFast bool,
	processor func(context.Context, K, T) (X, R, error),
) (map[X]R, error) {
	results := make(map[X]R, len(input))
	if len(input) == 0 {
		return results, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if processor == nil {
		return nil, errNilProcessor
	}
	if concurrency <= 0 {
		concurrency = 1
	}
	if concurrency > len(input) {
		concurrency = len(input)
	}

	type task struct {
		key   K
		value T
	}

	tasks := make([]task, 0, len(input))
	for key, value := range input {
		tasks = append(tasks, task{key: key, value: value})
	}

	var mu sync.Mutex
	err := goProcessTasks(ctx, tasks, concurrency, failFast, func(ctx context.Context, task task) error {
		key, result, err := runMapProcessor(ctx, processor, task.key, task.value)
		if err != nil {
			return err
		}
		mu.Lock()
		results[key] = result
		mu.Unlock()
		return nil
	})
	return results, err
}

// goProcessTasks runs prepared tasks with a fixed worker pool.
// goProcessTasks 使用固定 worker pool 执行已准备好的任务.
func goProcessTasks[T any](
	ctx context.Context,
	items []T,
	concurrency int,
	failFast bool,
	processor func(context.Context, T) error,
) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	tasks := make(chan T)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var allErrors []error
	var errOnce sync.Once
	var firstErr error

	addError := func(err error) {
		if err == nil {
			return
		}
		if failFast {
			errOnce.Do(func() {
				firstErr = err
				cancel()
			})
			return
		}
		mu.Lock()
		allErrors = append(allErrors, err)
		mu.Unlock()
	}

	// Keep WaitGroup and channel lifecycle handling in this shared worker loop.
	// 将 WaitGroup 和 channel 生命周期控制集中在这个共享 worker 循环里.
	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()

			for task := range tasks {
				if ctx.Err() != nil {
					return
				}
				addError(processor(ctx, task))
			}
		}()
	}

	for _, item := range items {
		// Stop scheduling new tasks once cancellation is observed.
		// 发现取消后停止继续投递新任务.
		select {
		case <-ctx.Done():
			close(tasks)
			wg.Wait()
			if firstErr != nil {
				return firstErr
			}
			return errors.Join(append(allErrors, ctx.Err())...)
		case tasks <- item:
		}
	}
	close(tasks)

	wg.Wait()
	if firstErr != nil {
		return firstErr
	}
	if err := ctx.Err(); err != nil {
		allErrors = append(allErrors, err)
	}
	return errors.Join(allErrors...)
}

func runSliceProcessor[T any, R any](
	ctx context.Context,
	processor func(context.Context, T) (R, error),
	item T,
) (result R, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("concurrent processor panic: %v", r)
		}
	}()
	return processor(ctx, item)
}

func runMapProcessor[K comparable, T any, X comparable, R any](
	ctx context.Context,
	processor func(context.Context, K, T) (X, R, error),
	key K,
	value T,
) (resultKey X, result R, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("concurrent map processor panic: %v", r)
		}
	}()
	return processor(ctx, key, value)
}
