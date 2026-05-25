package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/utils"
)

// ListSources returns all video sources.
// ListSources 返回所有视频源.
func (h *Handler) ListSources(c *gin.Context) {
	sources, err := h.store.ListSources()
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to list sources"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"sources": sources})
}

// CreateSource creates a new video source.
// CreateSource 创建一个新视频源.
func (h *Handler) CreateSource(c *gin.Context) {
	var src model.Source
	if err := c.ShouldBindJSON(&src); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}

	if src.Key == "" || src.Name == "" || src.API == "" {
		c.JSON(http.StatusBadRequest, errs.MissingFields.WithMsg("key, name, and api are required"))
		return
	}

	if err := utils.ValidateExternalURL(src.API); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidURL.WithMsg("invalid API URL: "+err.Error()))
		return
	}

	id, err := h.store.CreateSource(&src)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to create source"))
		return
	}

	src.ID = id
	c.JSON(http.StatusCreated, src)
}

// UpdateSource updates an existing video source.
// UpdateSource 更新已有视频源.
func (h *Handler) UpdateSource(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidID.WithMsg("invalid source id"))
		return
	}

	var src model.Source
	if err := c.ShouldBindJSON(&src); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}

	if src.API != "" {
		if err := utils.ValidateExternalURL(src.API); err != nil {
			c.JSON(http.StatusBadRequest, errs.InvalidURL.WithMsg("invalid API URL: "+err.Error()))
			return
		}
	}

	if err := h.store.UpdateSource(id, src.Name, src.API, src.Detail, src.Comment, src.Enabled); err != nil {
		if errors.Is(err, errs.ErrNotFound) {
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("source not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to update source"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "source updated"})
}

// BulkSetSourcesEnabledRequest is the request body for BulkSetSourcesEnabled.
// BulkSetSourcesEnabledRequest 是批量启用/禁用视频源接口的请求体.
type BulkSetSourcesEnabledRequest struct {
	IDs     []int64 `json:"ids"`
	Enabled bool    `json:"enabled"`
}

// BulkSetSourcesEnabled atomically toggles the enabled flag for many sources at once.
// BulkSetSourcesEnabled 在单次请求中原子地批量启用或禁用多个视频源.
// Designed to replace fan-out PUTs from admin UIs (e.g. "Enable all NSFW sources"),
// which previously raced against the SQLite writer lock and failed with SQLITE_BUSY.
// 设计目的是替代管理端的散列 PUT 请求 (例如 "启用 🔞 源"),
// 这些散列请求过去会撞到 SQLite 写锁并返回 SQLITE_BUSY.
func (h *Handler) BulkSetSourcesEnabled(c *gin.Context) {
	var req BulkSetSourcesEnabledRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}
	if len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, errs.MissingFields.WithMsg("ids must be non-empty"))
		return
	}

	if err := h.store.BulkSetSourcesEnabled(req.IDs, req.Enabled); err != nil {
		if errors.Is(err, errs.ErrNotFound) {
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("one or more sources not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to bulk update sources"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "sources updated", "count": len(req.IDs)})
}

// DeleteSource deletes a video source.
// DeleteSource 删除一个视频源.
func (h *Handler) DeleteSource(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidID.WithMsg("invalid source id"))
		return
	}

	if err := h.store.DeleteSource(id); err != nil {
		if errors.Is(err, errs.ErrNotFound) {
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("source not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to delete source"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "source deleted"})
}

// CheckSource triggers a health check for a single source.
// CheckSource 触发单个视频源的健康检查.
func (h *Handler) CheckSource(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidID.WithMsg("invalid source id"))
		return
	}

	health, err := h.sourceSvc.CheckSingleSource(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg(err.Error()))
		return
	}

	c.JSON(http.StatusOK, gin.H{"health": health})
}

// CheckAllSources triggers a health check for all enabled sources.
// CheckAllSources 触发所有已启用视频源的健康检查.
func (h *Handler) CheckAllSources(c *gin.Context) {
	go h.sourceSvc.RunHealthCheck()
	c.JSON(http.StatusOK, gin.H{"message": "health check started"})
}

// ImportSources imports sources from a source config JSON body.
// ImportSources 从 source config JSON 请求体导入视频源.
func (h *Handler) ImportSources(c *gin.Context) {
	// Limit the import body to 10MB to avoid unbounded memory use.
	// 将导入请求体限制为 10MB, 避免无限制占用内存.
	data, err := io.ReadAll(io.LimitReader(c.Request.Body, 10<<20))
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg("failed to read request body"))
		return
	}

	count, err := h.sourceSvc.ImportConfig(data)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to import sources"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"imported": count})
}
