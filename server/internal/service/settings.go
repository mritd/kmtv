package service

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/mritd/kmtv/internal/consts"
	appruntime "github.com/mritd/kmtv/internal/runtime"
)

var allowedSettingKeys = map[string]bool{
	consts.SettingSiteName:            true,
	consts.SettingAnonymousAccess:     true,
	consts.SettingHealthCheckInterval: true,
	consts.SettingNSFWFilterEnabled:   true,
	consts.SettingDoubanImageProxy:    true,
	consts.SettingSearchConcurrency:   true,
	consts.SettingProbeConcurrency:    true,
	consts.SettingProbeTimeout:        true,
	consts.SettingSearchTimeout:       true,
	consts.SettingPublicBaseURL:       true,
	consts.SettingAccessTokenTTL:      true,
	consts.SettingMediaTokenTTL:       true,
	consts.SettingPlaybackMode:        true,
}

// SettingDefaults returns the default value for each settable key so admin clients can show sane fallbacks.
// SettingDefaults 返回每个可设置项的默认值, 让管理端表单在 DB 缺失时也能展示合理初始值.
func SettingDefaults() map[string]string {
	return map[string]string{
		consts.SettingSiteName:            "KMTV",
		consts.SettingAnonymousAccess:     "true",
		consts.SettingHealthCheckInterval: "3600",
		consts.SettingNSFWFilterEnabled:   "true",
		consts.SettingDoubanImageProxy:    "tencent",
		consts.SettingPublicBaseURL:       "",
		consts.SettingSearchConcurrency:   strconv.Itoa(consts.DefaultSearchConcurrency),
		consts.SettingProbeConcurrency:    strconv.Itoa(consts.DefaultProbeConcurrency),
		consts.SettingProbeTimeout:        strconv.Itoa(consts.DefaultProbeTimeout),
		consts.SettingSearchTimeout:       strconv.Itoa(consts.DefaultSearchTimeout),
		consts.SettingAccessTokenTTL:      strconv.FormatInt(consts.DefaultAccessTokenTTL, 10),
		consts.SettingMediaTokenTTL:       strconv.FormatInt(consts.DefaultMediaTokenTTL, 10),
		consts.SettingPlaybackMode:        consts.PlaybackModeProxy,
	}
}

var publicSettingKeys = map[string]bool{
	"version": true,
}

var runtimeSettingKeys = []string{
	consts.SettingAccessTokenTTL,
	consts.SettingMediaTokenTTL,
	consts.SettingPlaybackMode,
	consts.SettingSearchConcurrency,
	consts.SettingProbeConcurrency,
	consts.SettingProbeTimeout,
	consts.SettingSearchTimeout,
}

type settingsReader interface {
	GetSetting(key string) (string, error)
}

// IsAllowedSettingKey reports whether admins may update the setting key.
// IsAllowedSettingKey 判断管理员是否允许更新指定设置项.
func IsAllowedSettingKey(key string) bool {
	return allowedSettingKeys[key]
}

// IsPublicSettingKey reports whether anonymous users may read the setting key.
// IsPublicSettingKey 判断匿名用户是否允许读取指定设置项.
func IsPublicSettingKey(key string) bool {
	return publicSettingKeys[key]
}

// ApplyRuntimeSetting applies settings that take effect without restarting.
// ApplyRuntimeSetting 应用无需重启即可生效的运行时设置.
func ApplyRuntimeSetting(key, value string) {
	switch key {
	case consts.SettingAccessTokenTTL:
		if ttl, err := strconv.ParseInt(value, 10, 64); err == nil {
			appruntime.Default().SetAccessTokenTTL(ttl)
		}
	case consts.SettingMediaTokenTTL:
		if ttl, err := strconv.ParseInt(value, 10, 64); err == nil {
			appruntime.Default().SetMediaTokenTTL(ttl)
		}
	case consts.SettingPlaybackMode:
		appruntime.Default().SetPlaybackMode(value)
	case consts.SettingSearchConcurrency:
		if n, err := strconv.Atoi(value); err == nil {
			SetSearchConcurrency(n)
		}
	case consts.SettingProbeConcurrency:
		if n, err := strconv.Atoi(value); err == nil {
			SetProbeConcurrency(n)
		}
	case consts.SettingProbeTimeout:
		if n, err := strconv.Atoi(value); err == nil {
			SetProbeTimeout(n)
		}
	case consts.SettingSearchTimeout:
		if n, err := strconv.Atoi(value); err == nil {
			SetSearchTimeout(n)
		}
	}
}

// ApplyRuntimeSettingsFromReader loads all runtime settings from persistent storage.
// ApplyRuntimeSettingsFromReader 从持久化存储加载所有运行时设置.
func ApplyRuntimeSettingsFromReader(reader settingsReader) {
	for _, key := range runtimeSettingKeys {
		value, err := reader.GetSetting(key)
		if err != nil || value == "" {
			continue
		}
		ApplyRuntimeSetting(key, value)
	}
}

// ValidatePublicBaseURL validates the optional external base URL for generated links.
// ValidatePublicBaseURL 校验用于生成链接的可选外部访问根地址.
func ValidatePublicBaseURL(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	u, err := url.Parse(value)
	if err != nil {
		return fmt.Errorf("parse public base URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("public base URL scheme must be http or https")
	}
	if u.Host == "" {
		return fmt.Errorf("public base URL host is required")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("public base URL must not include query or fragment")
	}
	return nil
}
