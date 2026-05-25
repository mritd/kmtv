package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/mritd/kmtv/internal/config"
	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	appruntime "github.com/mritd/kmtv/internal/runtime"
	"github.com/mritd/kmtv/internal/utils"
	"github.com/mritd/kmtv/internal/vodsource"
)

// Detail fetches video detail from a specific source.
// Detail 从指定视频源拉取视频详情.
func (h *Handler) Detail(c *gin.Context) {
	sourceKey := c.Query("source")
	if sourceKey == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("query parameter 'source' is required"))
		return
	}

	videoID := c.Query("id")
	if videoID == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("query parameter 'id' is required"))
		return
	}

	src, err := h.store.GetSourceByKey(sourceKey)
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

	detailURL := vodsource.BuildDetailURL(src.API, videoID)
	sourceResp, body, err := h.sourceClient.FetchList(c.Request.Context(), detailURL)
	if err != nil {
		logrus.WithError(err).WithFields(logrus.Fields{
			"source": sourceKey,
			"url":    detailURL,
			"body":   utils.Truncate(string(body), 200),
		}).Warn("failed to fetch detail from source")

		switch {
		case errors.Is(err, errs.ErrVideoSourceBadStatus):
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("source returned error"))
		case errors.Is(err, errs.ErrVideoSourceDecode):
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("source returned invalid data"))
		default:
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("source unavailable"))
		}
		return
	}

	if len(sourceResp.List) == 0 {
		c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("video not found"))
		return
	}

	item := sourceResp.List[0]
	desc := vodsource.FullDescription(item.VodBlurb, item.VodContent)

	allGroups := config.ParseAllEpisodeGroups(item.VodPlayURL)
	episodes := allGroups

	if appruntime.Default().PlaybackMode() != consts.PlaybackModeDirect {
		// Probe each CDN line's first episode URL in parallel to filter dead lines.
		// 并行探测每条 CDN 线路第一个分集 URL, 过滤不可用线路.
		// Use request context so background probing stops when the client cancels.
		// 使用请求 context 执行 CDN 探测, 让客户端取消请求时后台探测也能停止.
		episodes = h.proxySvc.ProbeLines(c.Request.Context(), allGroups)
	}

	detail := model.VideoDetail{
		ID:       model.FormatID(item.VodID),
		Title:    item.VodName,
		Type:     item.TypeName,
		Year:     item.VodYear,
		Cover:    item.VodPic,
		Desc:     desc,
		Director: item.VodDirector,
		Actor:    item.VodActor,
		Area:     item.VodArea,
		Episodes: episodes,
	}

	c.JSON(http.StatusOK, detail)
}
