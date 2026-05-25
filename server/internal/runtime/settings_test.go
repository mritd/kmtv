package runtime

import (
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/consts"
)

func TestStateTokenTTLAndPlaybackMode(t *testing.T) {
	state := NewState()
	if got := state.AccessTokenTTL(); got != consts.DefaultAccessTokenTTL {
		t.Fatalf("access token ttl = %d, want %d", got, consts.DefaultAccessTokenTTL)
	}
	if got := state.MediaTokenTTL(); got != consts.DefaultMediaTokenTTL {
		t.Fatalf("media token ttl = %d, want %d", got, consts.DefaultMediaTokenTTL)
	}
	if got := state.PlaybackMode(); got != consts.PlaybackModeProxy {
		t.Fatalf("playback mode = %q, want proxy", got)
	}

	state.SetAccessTokenTTL(120)
	state.SetMediaTokenTTL(30)
	state.SetPlaybackMode(consts.PlaybackModeDirect)

	if got := state.AccessTokenTTL(); got != 120 {
		t.Fatalf("access token ttl = %d, want 120", got)
	}
	if got := state.MediaTokenTTL(); got != 30 {
		t.Fatalf("media token ttl = %d, want 30", got)
	}
	if got := state.PlaybackMode(); got != consts.PlaybackModeDirect {
		t.Fatalf("playback mode = %q, want direct", got)
	}

	state.SetAccessTokenTTL(0)
	state.SetMediaTokenTTL(0)
	state.SetPlaybackMode("bad")
	if got := state.AccessTokenTTL(); got != 120 {
		t.Fatalf("non-positive access token ttl should be ignored, got %d", got)
	}
	if got := state.MediaTokenTTL(); got != 30 {
		t.Fatalf("non-positive media token ttl should be ignored, got %d", got)
	}
	if got := state.PlaybackMode(); got != consts.PlaybackModeDirect {
		t.Fatalf("invalid playback mode should be ignored, got %q", got)
	}
}

func TestStateConcurrencyAndTimeoutClamps(t *testing.T) {
	state := NewState()

	state.SetSearchConcurrency(0)
	if got := state.SearchConcurrency(); got != 1 {
		t.Fatalf("search lower clamp = %d, want 1", got)
	}
	state.SetSearchConcurrency(100)
	if got := state.SearchConcurrency(); got != 50 {
		t.Fatalf("search upper clamp = %d, want 50", got)
	}

	state.SetProbeConcurrency(0)
	if got := state.ProbeConcurrency(); got != 1 {
		t.Fatalf("probe lower clamp = %d, want 1", got)
	}
	state.SetProbeConcurrency(100)
	if got := state.ProbeConcurrency(); got != 50 {
		t.Fatalf("probe upper clamp = %d, want 50", got)
	}

	state.SetProbeTimeout(0)
	if got := state.ProbeTimeout(); got != time.Second {
		t.Fatalf("probe timeout lower clamp = %s, want 1s", got)
	}
	state.SetProbeTimeout(100)
	if got := state.ProbeTimeout(); got != 20*time.Second {
		t.Fatalf("probe timeout upper clamp = %s, want 20s", got)
	}

	state.SetSearchTimeout(0)
	if got := state.SearchTimeout(); got != time.Second {
		t.Fatalf("search timeout lower clamp = %s, want 1s", got)
	}
	state.SetSearchTimeout(100)
	if got := state.SearchTimeout(); got != 30*time.Second {
		t.Fatalf("search timeout upper clamp = %s, want 30s", got)
	}

}

func TestResetDefaultForTest(t *testing.T) {
	Default().SetSearchConcurrency(3)
	Default().SetAccessTokenTTL(99)
	Default().SetMediaTokenTTL(88)
	Default().SetPlaybackMode(consts.PlaybackModeDirect)

	ResetDefaultForTest()

	if got := Default().SearchConcurrency(); got != consts.DefaultSearchConcurrency {
		t.Fatalf("default search concurrency = %d, want %d", got, consts.DefaultSearchConcurrency)
	}
	if got := Default().AccessTokenTTL(); got != consts.DefaultAccessTokenTTL {
		t.Fatalf("default access token ttl = %d, want %d", got, consts.DefaultAccessTokenTTL)
	}
	if got := Default().MediaTokenTTL(); got != consts.DefaultMediaTokenTTL {
		t.Fatalf("default media token ttl = %d, want %d", got, consts.DefaultMediaTokenTTL)
	}
	if got := Default().PlaybackMode(); got != consts.PlaybackModeProxy {
		t.Fatalf("default playback mode = %q, want proxy", got)
	}
}
