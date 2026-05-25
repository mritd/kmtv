package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/middleware"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/version"
)

// GetSettings returns settings as a key-value map.
// GetSettings 以 key-value map 返回设置.
// Public access returns only public settings; admin access returns all allowed settings.
// 匿名访问只返回公开设置; 管理员访问返回所有允许管理的设置.
func (h *Handler) GetSettings(c *gin.Context) {
	role, _ := c.Get("role")
	isAdmin := role == "admin"

	settings, err := h.store.GetAllSettings()
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to get settings"))
		return
	}

	result := make(map[string]string, len(settings))
	if isAdmin {
		// Seed defaults so missing rows still surface a sane initial value on the admin form.
		// 用默认值预填, 让 DB 中尚未写入的项也能在管理端表单展示合理初始值.
		for key, value := range service.SettingDefaults() {
			result[key] = value
		}
	}
	for _, s := range settings {
		if isAdmin && service.IsAllowedSettingKey(s.Key) {
			result[s.Key] = s.Value
		} else if service.IsPublicSettingKey(s.Key) {
			result[s.Key] = s.Value
		}
	}

	// Always include server version.
	// 始终包含服务端版本.
	result["version"] = version.Version

	c.JSON(http.StatusOK, gin.H{"settings": result})
}

// UpdateSettings accepts a key-value map and updates each setting.
// UpdateSettings 接收 key-value map 并逐项更新设置.
func (h *Handler) UpdateSettings(c *gin.Context) {
	var settings map[string]string
	if err := c.ShouldBindJSON(&settings); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}

	for key := range settings {
		if !service.IsAllowedSettingKey(key) {
			c.JSON(http.StatusBadRequest, errs.UnknownSetting.WithMsg("unknown setting key: "+key))
			return
		}
	}
	if value, ok := settings[consts.SettingPublicBaseURL]; ok {
		if err := service.ValidatePublicBaseURL(value); err != nil {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg(err.Error()))
			return
		}
	}

	for key, value := range settings {
		if err := h.store.SetSetting(key, value); err != nil {
			c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to update setting: "+key))
			return
		}
		service.ApplyRuntimeSetting(key, value)
	}

	middleware.ResetAnonAccessCache()
	c.JSON(http.StatusOK, gin.H{"message": "settings updated"})
}
