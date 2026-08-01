package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
)

type watchHistoryRequest struct {
	SourceKey    string  `json:"source_key"`
	VideoID      string  `json:"video_id"`
	Title        string  `json:"title" binding:"required"`
	Cover        string  `json:"cover"`
	Episode      string  `json:"episode"`
	GroupIndex   int     `json:"group_index"`
	EpisodeIndex int     `json:"episode_index"`
	ProgressSec  float64 `json:"progress_sec"`
	DurationSec  float64 `json:"duration_sec"`
	Completed    bool    `json:"completed"`
	EventTimeMS  int64   `json:"event_time_ms" binding:"required"`
}

const maxWatchHistoryBodyBytes = 64 << 10

// ListWatchHistory returns the current user's recent watch history.
// ListWatchHistory 返回当前用户最近的观看历史.
func (h *Handler) ListWatchHistory(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}

	limit := 10
	if raw := c.Query("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg("limit must be a positive integer"))
			return
		}
		limit = parsed
	}
	if limit > store.MaxWatchHistoryItems {
		limit = store.MaxWatchHistoryItems
	}
	var completed *bool
	if raw := c.Query("completed"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg("completed must be true or false"))
			return
		}
		completed = &parsed
	}

	items, err := h.store.ListWatchHistory(user.ID, limit, completed)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to list watch history"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// UpsertWatchHistory records the current user's latest playback state for a title.
// UpsertWatchHistory 记录当前用户某个标题的最新播放状态.
func (h *Handler) UpsertWatchHistory(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}

	var req watchHistoryRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxWatchHistoryBodyBytes)
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}

	item, err := h.store.UpsertWatchHistory(user.ID, &model.WatchHistoryItem{
		SourceKey:    req.SourceKey,
		VideoID:      req.VideoID,
		Title:        req.Title,
		Cover:        req.Cover,
		Episode:      req.Episode,
		GroupIndex:   req.GroupIndex,
		EpisodeIndex: req.EpisodeIndex,
		ProgressSec:  req.ProgressSec,
		DurationSec:  req.DurationSec,
		Completed:    req.Completed,
		EventTimeMS:  req.EventTimeMS,
	})
	if err != nil {
		if errors.Is(err, errs.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest)
			return
		}
		if errors.Is(err, errs.ErrStaleWrite) {
			c.JSON(http.StatusConflict, errs.StaleWrite)
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to save watch history"))
		return
	}
	c.JSON(http.StatusOK, item)
}

// GetWatchHistory returns one watch history item selected by title.
// GetWatchHistory 根据标题返回一条观看历史.
func (h *Handler) GetWatchHistory(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}
	title := c.Query("title")
	if title == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("query parameter 'title' is required"))
		return
	}

	item, err := h.store.GetWatchHistoryByTitle(user.ID, title)
	if err != nil {
		if errors.Is(err, errs.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest)
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to read watch history"))
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("watch history not found"))
		return
	}
	c.JSON(http.StatusOK, item)
}

// DeleteWatchHistory removes one title from the current user's history.
// DeleteWatchHistory 从当前用户历史中删除一个标题.
func (h *Handler) DeleteWatchHistory(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}
	title := c.Query("title")
	if title == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("query parameter 'title' is required"))
		return
	}

	if err := h.store.DeleteWatchHistoryByTitle(user.ID, title); err != nil {
		if errors.Is(err, errs.ErrNotFound) {
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("watch history not found"))
			return
		}
		if errors.Is(err, errs.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest)
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to delete watch history"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "watch history deleted"})
}

// ClearWatchHistory removes all history for the current user.
// ClearWatchHistory 删除当前用户的全部观看历史.
func (h *Handler) ClearWatchHistory(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}
	clearedAtMS := time.Now().UnixMilli()
	if raw := c.Query("event_time_ms"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg("event_time_ms must be a positive integer"))
			return
		}
		clearedAtMS = parsed
	}
	if err := h.store.ClearWatchHistory(user.ID, clearedAtMS); err != nil {
		if errors.Is(err, errs.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest)
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to clear watch history"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "watch history cleared"})
}
