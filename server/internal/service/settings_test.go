package service

import (
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/consts"
	appruntime "github.com/mritd/kmtv/internal/runtime"
)

func TestSettingKeyVisibility(t *testing.T) {
	if !IsAllowedSettingKey("site_name") {
		t.Fatal("site_name should be an allowed admin setting")
	}
	if IsAllowedSettingKey("unknown_key") {
		t.Fatal("unknown_key should not be an allowed admin setting")
	}
	if !IsPublicSettingKey("version") {
		t.Fatal("version should be a public setting")
	}
	if IsPublicSettingKey("site_name") {
		t.Fatal("site_name should not be a public setting")
	}
}

func TestApplyRuntimeSetting(t *testing.T) {
	t.Cleanup(func() {
		appruntime.ResetDefaultForTest()
	})

	ApplyRuntimeSetting(consts.SettingAccessTokenTTL, "120")
	if got := appruntime.Default().AccessTokenTTL(); got != 120 {
		t.Fatalf("access token ttl = %d, want 120", got)
	}

	ApplyRuntimeSetting(consts.SettingMediaTokenTTL, "30")
	if got := appruntime.Default().MediaTokenTTL(); got != 30 {
		t.Fatalf("media token ttl = %d, want 30", got)
	}

	ApplyRuntimeSetting(consts.SettingPlaybackMode, consts.PlaybackModeDirect)
	if got := appruntime.Default().PlaybackMode(); got != consts.PlaybackModeDirect {
		t.Fatalf("playback mode = %q, want direct", got)
	}

	ApplyRuntimeSetting(consts.SettingSearchConcurrency, "3")
	if got := GetSearchConcurrency(); got != 3 {
		t.Fatalf("search concurrency = %d, want 3", got)
	}

	ApplyRuntimeSetting(consts.SettingProbeConcurrency, "4")
	if got := GetProbeConcurrency(); got != 4 {
		t.Fatalf("probe concurrency = %d, want 4", got)
	}

	ApplyRuntimeSetting(consts.SettingProbeTimeout, "5")
	if got := GetProbeTimeout(); got != 5*time.Second {
		t.Fatalf("probe timeout = %s, want 5s", got)
	}

	ApplyRuntimeSetting(consts.SettingSearchTimeout, "6")
	if got := GetSearchTimeout(); got != 6*time.Second {
		t.Fatalf("search timeout = %s, want 6s", got)
	}

}

func TestRuntimeSettingClamps(t *testing.T) {
	t.Cleanup(func() {
		appruntime.ResetDefaultForTest()
	})

	SetSearchConcurrency(0)
	if got := GetSearchConcurrency(); got != 1 {
		t.Fatalf("search concurrency lower clamp = %d, want 1", got)
	}
	SetSearchConcurrency(100)
	if got := GetSearchConcurrency(); got != 50 {
		t.Fatalf("search concurrency upper clamp = %d, want 50", got)
	}
	SetProbeConcurrency(0)
	if got := GetProbeConcurrency(); got != 1 {
		t.Fatalf("probe concurrency lower clamp = %d, want 1", got)
	}
	SetProbeConcurrency(100)
	if got := GetProbeConcurrency(); got != 50 {
		t.Fatalf("probe concurrency upper clamp = %d, want 50", got)
	}
	SetProbeTimeout(0)
	if got := GetProbeTimeout(); got != time.Second {
		t.Fatalf("probe timeout lower clamp = %s, want 1s", got)
	}
	SetProbeTimeout(100)
	if got := GetProbeTimeout(); got != 20*time.Second {
		t.Fatalf("probe timeout upper clamp = %s, want 20s", got)
	}
	SetSearchTimeout(0)
	if got := GetSearchTimeout(); got != time.Second {
		t.Fatalf("search timeout lower clamp = %s, want 1s", got)
	}
	SetSearchTimeout(100)
	if got := GetSearchTimeout(); got != 30*time.Second {
		t.Fatalf("search timeout upper clamp = %s, want 30s", got)
	}
}

func TestApplyRuntimeSettingsFromReader(t *testing.T) {
	t.Cleanup(func() {
		appruntime.ResetDefaultForTest()
	})

	settings := stubSettingsReader{
		values: map[string]string{
			consts.SettingAccessTokenTTL:    "300",
			consts.SettingMediaTokenTTL:     "60",
			consts.SettingPlaybackMode:      consts.PlaybackModeDirect,
			consts.SettingSearchConcurrency: "2",
			consts.SettingProbeConcurrency:  "6",
			consts.SettingProbeTimeout:      "7",
			consts.SettingSearchTimeout:     "8",
		},
	}

	ApplyRuntimeSettingsFromReader(settings)

	if got := appruntime.Default().AccessTokenTTL(); got != 300 {
		t.Fatalf("access token ttl = %d, want 300", got)
	}
	if got := appruntime.Default().MediaTokenTTL(); got != 60 {
		t.Fatalf("media token ttl = %d, want 60", got)
	}
	if got := appruntime.Default().PlaybackMode(); got != consts.PlaybackModeDirect {
		t.Fatalf("playback mode = %q, want direct", got)
	}
	if got := GetSearchConcurrency(); got != 2 {
		t.Fatalf("search concurrency = %d, want 2", got)
	}
	if got := GetProbeConcurrency(); got != 6 {
		t.Fatalf("probe concurrency = %d, want 6", got)
	}
	if got := GetProbeTimeout(); got != 7*time.Second {
		t.Fatalf("probe timeout = %s, want 7s", got)
	}
	if got := GetSearchTimeout(); got != 8*time.Second {
		t.Fatalf("search timeout = %s, want 8s", got)
	}
}

func TestValidatePublicBaseURL(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "empty", value: "", wantErr: false},
		{name: "https", value: "https://kmtv.example/base", wantErr: false},
		{name: "http", value: "http://kmtv.example:8080", wantErr: false},
		{name: "bad scheme", value: "javascript:alert(1)", wantErr: true},
		{name: "missing host", value: "https:///path", wantErr: true},
		{name: "query", value: "https://kmtv.example?x=1", wantErr: true},
		{name: "fragment", value: "https://kmtv.example#x", wantErr: true},
		{name: "parse error", value: "http://[::1", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePublicBaseURL(tt.value)
			if tt.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestRuntimeResetDefaultForTest(t *testing.T) {
	appruntime.Default().SetAccessTokenTTL(99)
	appruntime.Default().SetMediaTokenTTL(88)
	appruntime.Default().SetPlaybackMode(consts.PlaybackModeDirect)
	SetSearchConcurrency(3)
	SetProbeConcurrency(4)
	SetProbeTimeout(5)
	SetSearchTimeout(6)

	appruntime.ResetDefaultForTest()

	if got := appruntime.Default().AccessTokenTTL(); got != consts.DefaultAccessTokenTTL {
		t.Fatalf("access token ttl = %d, want default %d", got, consts.DefaultAccessTokenTTL)
	}
	if got := appruntime.Default().MediaTokenTTL(); got != consts.DefaultMediaTokenTTL {
		t.Fatalf("media token ttl = %d, want default %d", got, consts.DefaultMediaTokenTTL)
	}
	if got := appruntime.Default().PlaybackMode(); got != consts.PlaybackModeProxy {
		t.Fatalf("playback mode = %q, want proxy", got)
	}
	if got := GetSearchConcurrency(); got != consts.DefaultSearchConcurrency {
		t.Fatalf("search concurrency = %d, want %d", got, consts.DefaultSearchConcurrency)
	}
	if got := GetProbeConcurrency(); got != consts.DefaultProbeConcurrency {
		t.Fatalf("probe concurrency = %d, want %d", got, consts.DefaultProbeConcurrency)
	}
	if got := GetProbeTimeout(); got != consts.DefaultProbeTimeout*time.Second {
		t.Fatalf("probe timeout = %s, want %ds", got, consts.DefaultProbeTimeout)
	}
	if got := GetSearchTimeout(); got != consts.DefaultSearchTimeout*time.Second {
		t.Fatalf("search timeout = %s, want %ds", got, consts.DefaultSearchTimeout)
	}
}

type stubSettingsReader struct {
	values map[string]string
}

func (s stubSettingsReader) GetSetting(key string) (string, error) {
	return s.values[key], nil
}
