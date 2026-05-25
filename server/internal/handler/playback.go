package handler

import (
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	appruntime "github.com/mritd/kmtv/internal/runtime"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/utils"
)

type playbackURLRequest struct {
	URL    string `json:"url" binding:"required"`
	Source string `json:"source"`
}

// PlaybackURL returns a playable URL for the current playback mode.
// PlaybackURL 按当前播放模式返回可播放 URL.
func (h *Handler) PlaybackURL(c *gin.Context) {
	var req playbackURLRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}
	if err := utils.ValidateExternalURL(req.URL); err != nil {
		c.JSON(http.StatusForbidden, errs.Blocked.WithMsg("blocked: "+err.Error()))
		return
	}
	if req.Source != "" {
		src, err := h.store.GetSourceByKey(req.Source)
		if err != nil {
			c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to look up source"))
			return
		}
		if src == nil {
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("source not found"))
			return
		}
		if !h.requireSourceAccess(c, src) {
			return
		}
	}

	mode := appruntime.Default().PlaybackMode()
	if mode == consts.PlaybackModeDirect {
		c.JSON(http.StatusOK, gin.H{"mode": consts.PlaybackModeDirect, "url": req.URL})
		return
	}

	sessionID := int64(0)
	if v, ok := c.Get("auth_session"); ok {
		if session, ok := v.(*model.AuthSession); ok && session != nil {
			sessionID = session.ID
		}
	}
	token, err := h.mediaSvc.IssueMediaToken(
		sessionID,
		service.MediaKindM3U8,
		req.URL,
		req.Source,
		time.Duration(appruntime.Default().MediaTokenTTL())*time.Second,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to issue media token"))
		return
	}

	playURL := h.publicBaseURL(c.Request) +
		"/api/v1/proxy/m3u8?url=" + url.QueryEscape(req.URL) +
		"&source=" + url.QueryEscape(req.Source) +
		"&mt=" + url.QueryEscape(token)
	c.JSON(http.StatusOK, gin.H{"mode": consts.PlaybackModeProxy, "url": playURL})
}
