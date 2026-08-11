package service

import (
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"time"
)

// errIdleTimeout reports that an upstream body produced no bytes within the
// allowed idle window.
//
// errIdleTimeout 表示上游 body 在允许的空闲窗口内未产生任何字节.
var errIdleTimeout = errors.New("upstream stalled: no data within idle timeout")

// idleTimeoutReader aborts a body that goes silent, without capping how long a
// slow-but-progressing transfer may take.
//
// A total-duration cap cannot be used here: proxied segments are megabytes and
// a genuinely slow link legitimately needs minutes. Bounding silence instead
// releases goroutines held by dead or hung peers while leaving slow viewers
// unaffected — the timer resets on every byte received.
//
// idleTimeoutReader 会中断陷入静默的 body, 但不限制缓慢却仍在推进的传输总时长.
//
// 此处不能用总时长上限: 代理分片有数 MB, 网络较慢时合理耗时可达数分钟.
// 改为限制静默时长, 既能释放被对端卡死占用的 goroutine, 又不影响慢速用户 —
// 计时器在每次收到字节时重置.
//
// Reads run synchronously on the caller's goroutine, so the caller's buffer is
// never shared. A watchdog goroutine only observes an atomic progress counter,
// and breaks a stalled read by closing the body underneath it.
//
// 读取在调用方 goroutine 上同步执行, 因此调用方的 buffer 不会被共享.
// watchdog goroutine 只观察一个原子进度计数器,
// 并通过关闭底层 body 来打断卡死的读取.
type idleTimeoutReader struct {
	body io.ReadCloser

	// progress increments on every read that returns bytes; the watchdog trips
	// when it stops moving.
	//
	// progress 在每次读到字节时自增; 该值停止变化时 watchdog 触发.
	progress atomic.Int64
	tripped  atomic.Bool

	done     chan struct{}
	closeOne sync.Once
}

// newIdleTimeoutReader wraps body so reads fail once idle elapses without data.
// A non-positive idle disables the guard and returns body unchanged.
//
// newIdleTimeoutReader 包装 body, 使其在空闲超过 idle 且无数据时读取失败.
// idle 非正数时禁用该保护, 直接返回原 body.
func newIdleTimeoutReader(body io.ReadCloser, idle time.Duration) io.ReadCloser {
	if idle <= 0 {
		return body
	}
	r := &idleTimeoutReader{body: body, done: make(chan struct{})}
	go r.watch(idle)
	return r
}

// watch trips the guard when no read has made progress for a full interval.
// Polling at half the window keeps the effective timeout within [idle, 1.5*idle].
//
// watch 在一个完整周期内没有任何读取推进时触发保护.
// 以半个窗口轮询, 可将实际超时控制在 [idle, 1.5*idle] 区间内.
func (r *idleTimeoutReader) watch(idle time.Duration) {
	ticker := time.NewTicker(idle / 2)
	defer ticker.Stop()

	last := r.progress.Load()
	stalled := 0
	for {
		select {
		case <-r.done:
			return
		case <-ticker.C:
			current := r.progress.Load()
			if current != last {
				last = current
				stalled = 0
				continue
			}
			stalled++
			if stalled >= 2 {
				r.tripped.Store(true)
				// Closing the body unblocks a Read parked in the network stack.
				//
				// 关闭 body 可解除阻塞在网络栈中的 Read.
				_ = r.body.Close()
				return
			}
		}
	}
}

func (r *idleTimeoutReader) Read(p []byte) (int, error) {
	if r.tripped.Load() {
		return 0, errIdleTimeout
	}
	n, err := r.body.Read(p)
	if n > 0 {
		r.progress.Add(1)
	}
	// A read torn down by the watchdog surfaces as a generic closed-body error;
	// report the real cause instead.
	//
	// 被 watchdog 中断的读取只会返回泛化的 body 关闭错误, 这里改为报告真实原因.
	if err != nil && r.tripped.Load() {
		return n, errIdleTimeout
	}
	return n, err
}

func (r *idleTimeoutReader) Close() error {
	r.closeOne.Do(func() { close(r.done) })
	return r.body.Close()
}
