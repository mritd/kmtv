// Package runtime owns mutable process-wide runtime settings.
// Package runtime 管理进程级可变运行时设置.
package runtime

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/mritd/kmtv/internal/consts"
)

// State contains process-wide mutable settings that are adjusted from DB settings.
// State 保存会由数据库设置调整的进程级可变设置.
type State struct {
	accessTokenTTL atomic.Int64
	mediaTokenTTL  atomic.Int64
	search         atomic.Int32
	probe          atomic.Int32
	probeTimeout   atomic.Int32
	searchTimeout  atomic.Int32

	playbackMu sync.RWMutex
	playback   string
}

var defaultState = NewState()

// NewState creates a runtime state initialized with default settings.
// NewState 创建使用默认设置初始化的运行时状态.
func NewState() *State {
	s := &State{}
	s.accessTokenTTL.Store(consts.DefaultAccessTokenTTL)
	s.mediaTokenTTL.Store(consts.DefaultMediaTokenTTL)
	s.search.Store(consts.DefaultSearchConcurrency)
	s.probe.Store(consts.DefaultProbeConcurrency)
	s.probeTimeout.Store(consts.DefaultProbeTimeout)
	s.searchTimeout.Store(consts.DefaultSearchTimeout)
	s.playback = consts.PlaybackModeProxy
	return s
}

// Default returns the process-wide runtime state.
// Default 返回进程级运行时状态.
func Default() *State {
	return defaultState
}

// ResetDefaultForTest resets process-wide runtime settings to defaults.
// ResetDefaultForTest 将进程级运行时设置重置为默认值.
func ResetDefaultForTest() {
	defaultState = NewState()
}

// SetAccessTokenTTL updates the API access token TTL in seconds.
// SetAccessTokenTTL 更新 API access token 有效期, 单位秒.
func (s *State) SetAccessTokenTTL(ttl int64) {
	if ttl > 0 {
		s.accessTokenTTL.Store(ttl)
	}
}

// AccessTokenTTL returns the API access token TTL in seconds.
// AccessTokenTTL 返回 API access token 有效期, 单位秒.
func (s *State) AccessTokenTTL() int64 {
	return s.accessTokenTTL.Load()
}

// SetMediaTokenTTL updates the media token TTL in seconds.
// SetMediaTokenTTL 更新 media token 有效期, 单位秒.
func (s *State) SetMediaTokenTTL(ttl int64) {
	if ttl > 0 {
		s.mediaTokenTTL.Store(ttl)
	}
}

// MediaTokenTTL returns the media token TTL in seconds.
// MediaTokenTTL 返回 media token 有效期, 单位秒.
func (s *State) MediaTokenTTL() int64 {
	return s.mediaTokenTTL.Load()
}

// SetPlaybackMode updates the playback mode.
// SetPlaybackMode 更新播放模式.
func (s *State) SetPlaybackMode(mode string) {
	if mode != consts.PlaybackModeProxy && mode != consts.PlaybackModeDirect {
		return
	}
	s.playbackMu.Lock()
	s.playback = mode
	s.playbackMu.Unlock()
}

// PlaybackMode returns the current playback mode.
// PlaybackMode 返回当前播放模式.
func (s *State) PlaybackMode() string {
	s.playbackMu.RLock()
	defer s.playbackMu.RUnlock()
	return s.playback
}

func (s *State) SetSearchConcurrency(n int) {
	s.search.Store(int32(clamp(n, 1, 50)))
}

// SearchConcurrency returns the source-search concurrency limit.
// SearchConcurrency 返回视频源搜索并发限制.
func (s *State) SearchConcurrency() int {
	return int(s.search.Load())
}

// SetProbeConcurrency updates the CDN probe concurrency limit.
// SetProbeConcurrency 更新 CDN 探测并发限制.
func (s *State) SetProbeConcurrency(n int) {
	s.probe.Store(int32(clamp(n, 1, 50)))
}

// ProbeConcurrency returns the CDN probe concurrency limit.
// ProbeConcurrency 返回 CDN 探测并发限制.
func (s *State) ProbeConcurrency() int {
	return int(s.probe.Load())
}

// SetProbeTimeout updates the CDN probe timeout in seconds.
// SetProbeTimeout 更新 CDN 探测超时时间, 单位秒.
func (s *State) SetProbeTimeout(n int) {
	s.probeTimeout.Store(int32(clamp(n, 1, 20)))
}

// ProbeTimeout returns the CDN probe timeout.
// ProbeTimeout 返回 CDN 探测超时时间.
func (s *State) ProbeTimeout() time.Duration {
	return time.Duration(s.probeTimeout.Load()) * time.Second
}

// SetSearchTimeout updates the per-source search timeout in seconds.
// SetSearchTimeout 更新单视频源搜索超时时间, 单位秒.
func (s *State) SetSearchTimeout(n int) {
	s.searchTimeout.Store(int32(clamp(n, 1, 30)))
}

// SearchTimeout returns the per-source search timeout.
// SearchTimeout 返回单视频源搜索超时时间.
func (s *State) SearchTimeout() time.Duration {
	return time.Duration(s.searchTimeout.Load()) * time.Second
}

func clamp(n, minValue, maxValue int) int {
	if n < minValue {
		return minValue
	}
	if n > maxValue {
		return maxValue
	}
	return n
}
