package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
)

const (
	maxSyncPushBodyBytes = 256 << 10
	maxSyncPushChanges   = 200
	defaultSyncPullLimit = 500
	maxSyncPullLimit     = 1000
)

// syncPushRequest keeps changes raw so each one is decoded on its own.
//
// syncPushRequest 保留原始变更, 以便逐条解码.
type syncPushRequest struct {
	Epoch   string            `json:"epoch"`
	Cursor  int64             `json:"cursor"`
	Changes []json.RawMessage `json:"changes"`
}

type syncPushResponse struct {
	Epoch        string             `json:"epoch"`
	Rev          int64              `json:"rev"`
	ServerTimeMS int64              `json:"server_time_ms"`
	Results      []model.SyncResult `json:"results"`
}

type syncPullResponse struct {
	Epoch        string             `json:"epoch"`
	ServerTimeMS int64              `json:"server_time_ms"`
	Rev          int64              `json:"rev"`
	Reset        bool               `json:"reset"`
	HasMore      bool               `json:"has_more"`
	Clears       []model.SyncClear  `json:"clears"`
	Records      []model.SyncRecord `json:"records"`
}

// SyncPush applies a batch of client changes for the current user.
//
// SyncPush 为当前用户应用一批客户端变更.
func (h *Handler) SyncPush(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSyncPushBodyBytes)
	var req syncPushRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}
	if len(req.Changes) > maxSyncPushChanges {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg("at most 200 changes per push"))
		return
	}
	epoch, err := h.store.SyncEpoch()
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to read sync epoch"))
		return
	}
	if req.Epoch != "" && req.Epoch != epoch {
		c.JSON(http.StatusConflict, gin.H{
			"code":  errs.EpochMismatch.Code,
			"error": errs.EpochMismatch.Message,
			"epoch": epoch,
		})
		return
	}
	if req.Epoch != "" && req.Cursor > 0 {
		// A cursor beyond the server's rev means the database was restored from an older copy.
		// Reject before applying anything, so this push cannot raise the rev past the cursor.
		//
		// 游标超过服务端 rev 说明数据库从旧副本恢复. 在应用任何变更前拒绝, 避免本次推送把 rev 抬过游标.
		current, err := h.store.SyncRev(user.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to read sync rev"))
			return
		}
		if req.Cursor > current {
			c.JSON(http.StatusConflict, gin.H{
				"code":  errs.SyncCursorAhead.Code,
				"error": errs.SyncCursorAhead.Message,
				"epoch": epoch,
			})
			return
		}
	}

	results := make([]model.SyncResult, len(req.Changes))
	changes := make([]model.SyncChange, 0, len(req.Changes))
	positions := make([]int, 0, len(req.Changes))
	for i, raw := range req.Changes {
		var change model.SyncChange
		if err := json.Unmarshal(raw, &change); err != nil {
			results[i] = model.SyncResult{Index: i, Status: model.SyncStatusInvalid, Reason: "malformed change"}
			continue
		}
		changes = append(changes, change)
		positions = append(positions, i)
	}
	rev, applied, err := h.store.PushSyncChanges(user.ID, changes, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to push sync changes"))
		return
	}
	for j, result := range applied {
		result.Index = positions[j]
		results[positions[j]] = result
	}
	c.JSON(http.StatusOK, syncPushResponse{
		Epoch:        epoch,
		Rev:          rev,
		ServerTimeMS: time.Now().UnixMilli(),
		Results:      results,
	})
}

// SyncPull returns the current user's changes after a revision cursor.
//
// SyncPull 返回当前用户在某个版本游标之后的变更.
func (h *Handler) SyncPull(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}
	var since int64
	if raw := c.Query("since"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg("since must be a non-negative integer"))
			return
		}
		since = parsed
	}
	limit := defaultSyncPullLimit
	if raw := c.Query("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg("limit must be a positive integer"))
			return
		}
		limit = min(parsed, maxSyncPullLimit)
	}
	epoch, err := h.store.SyncEpoch()
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to read sync epoch"))
		return
	}
	if requested := c.Query("epoch"); requested != "" && requested != epoch {
		rev, err := h.store.SyncRev(user.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to read sync rev"))
			return
		}
		c.JSON(http.StatusOK, syncPullResponse{
			Epoch:        epoch,
			ServerTimeMS: time.Now().UnixMilli(),
			Rev:          rev,
			Reset:        true,
			Clears:       []model.SyncClear{},
			Records:      []model.SyncRecord{},
		})
		return
	}
	page, err := h.store.PullSyncChanges(user.ID, since, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to pull sync changes"))
		return
	}
	c.JSON(http.StatusOK, syncPullResponse{
		Epoch:        epoch,
		ServerTimeMS: time.Now().UnixMilli(),
		Rev:          page.Rev,
		Reset:        page.Reset,
		HasMore:      page.HasMore,
		Clears:       page.Clears,
		Records:      page.Records,
	})
}
