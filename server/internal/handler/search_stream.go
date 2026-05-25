package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/service"
)

// sseProgressEvent is sent through the channel from progress callbacks.
// sseProgressEvent 由进度回调通过 channel 发送.
type sseProgressEvent struct {
	Phase     string `json:"phase"`
	Completed int    `json:"completed"`
	Total     int    `json:"total"`
}

// SearchStream handles SSE-based search with real-time progress.
// SearchStream 处理基于 SSE 的搜索, 并实时返回进度.
func (h *Handler) SearchStream(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("query parameter 'q' is required"))
		return
	}

	page := 1
	if p := c.Query("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = v
		}
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("streaming not supported"))
		return
	}

	// SSE headers.
	// SSE 响应 header.
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.WriteHeaderNow()

	// Buffered channel bridges concurrent progress callbacks to serial SSE writes.
	// 带缓冲 channel 将并发进度回调转换为串行 SSE 写入.
	progressCh := make(chan sseProgressEvent, 64)

	onProgress := service.ProgressFunc(func(phase string, completed, total int) {
		select {
		case progressCh <- sseProgressEvent{Phase: phase, Completed: completed, Total: total}:
		default:
			// Channel full, drop event to avoid blocking search goroutines.
			// channel 已满时丢弃事件, 避免阻塞搜索 goroutine.
		}
	})

	// Run search in background goroutine.
	// 在后台 goroutine 中执行搜索.
	type searchResult struct {
		results []model.SearchResult
		err     error
	}
	done := make(chan searchResult, 1)

	go func() {
		defer close(progressCh)
		results, err := h.searchSvc.SearchWithProgress(c.Request.Context(), query, page, h.shouldFilterAdult(c), onProgress)
		done <- searchResult{results: results, err: err}
	}()

	// Drain progress channel and write SSE events.
	// 消费进度 channel 并写入 SSE 事件.
	for evt := range progressCh {
		data, _ := json.Marshal(evt)
		_, _ = fmt.Fprintf(c.Writer, "event: progress\ndata: %s\n\n", data)
		flusher.Flush()
	}

	// Search complete, write result or error.
	// 搜索完成后写入结果或错误.
	res := <-done
	if res.err != nil {
		errData, _ := json.Marshal(gin.H{"message": res.err.Error()})
		_, _ = fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", errData)
		flusher.Flush()
		return
	}

	// Enrich descriptions using the same flow as the sync handler.
	// 使用和同步 handler 相同的流程补充简介.
	h.enrichDescriptions(c, res.results)

	resultData, _ := json.Marshal(gin.H{"results": res.results})
	_, _ = fmt.Fprintf(c.Writer, "event: result\ndata: %s\n\n", resultData)
	flusher.Flush()
}
