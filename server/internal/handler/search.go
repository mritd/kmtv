package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/utils"
	"github.com/mritd/kmtv/internal/vodsource"
)

// Search performs multi-source aggregated search.
// Search 执行多视频源聚合搜索.
func (h *Handler) Search(c *gin.Context) {
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

	results, err := h.searchSvc.Search(c.Request.Context(), query, page, h.shouldFilterAdult(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("search failed"))
		return
	}

	// Enrich results missing desc by fetching detail from the fastest source, up to 5 results in parallel.
	// 对缺少简介的结果补充详情, 从最快视频源拉取, 最多并行处理 5 个结果.
	h.enrichDescriptions(c, results)

	// Never emit "results": null (the service returns nil for zero sources / no matches);
	// clients call array methods on this field and a null crashes them.
	// 不能返回 "results": null (服务在零源/无匹配时返回 nil); 客户端会对该字段调用数组方法, null 会导致崩溃.
	if results == nil {
		results = []model.SearchResult{}
	}

	c.JSON(http.StatusOK, gin.H{"results": results})
}

// enrichDescriptions fetches detail from the fastest source per result to get descriptions.
// Limited to the first 5 results to avoid excessive concurrent HTTP requests.
// enrichDescriptions 从每个结果最快的视频源拉取详情来补充简介.
// 仅处理前 5 个结果, 避免产生过多并发 HTTP 请求.
func (h *Handler) enrichDescriptions(c *gin.Context, results []model.SearchResult) {
	limit := min(len(results), 5)
	type descJob struct {
		index   int
		source  string
		videoID string
	}
	type descResult struct {
		index int
		desc  string
	}

	jobs := make([]descJob, 0, limit)
	for i := range results[:limit] {
		if len(results[i].Sources) == 0 {
			continue
		}
		fastest := results[i].Sources[0]
		jobs = append(jobs, descJob{index: i, source: fastest.SourceKey, videoID: fastest.VideoID})
	}

	enriched, _ := utils.GoProcess(c.Request.Context(), jobs, 5, false, func(ctx context.Context, job descJob) (descResult, error) {
		return descResult{index: job.index, desc: h.fetchDescFromDetail(ctx, job.source, job.videoID)}, nil
	})
	for _, item := range enriched {
		if item.desc != "" {
			results[item.index].Desc = item.desc
		}
	}
}

// fetchDescFromDetail fetches the detail API for a single source+videoID and returns the description.
// fetchDescFromDetail 拉取单个 source+videoID 的详情 API 并返回简介.
func (h *Handler) fetchDescFromDetail(ctx context.Context, sourceKey, videoID string) string {
	src, err := h.store.GetSourceByKey(sourceKey)
	if err != nil || src == nil {
		return ""
	}

	detailURL := vodsource.BuildDetailURL(src.API, videoID)
	sourceResp, _, err := h.sourceClient.FetchList(ctx, detailURL)
	if err != nil || len(sourceResp.List) == 0 {
		return ""
	}

	item := sourceResp.List[0]
	return vodsource.FullDescription(item.VodBlurb, item.VodContent)
}

// SearchSuggestions returns an empty suggestions array.
// SearchSuggestions 返回空 suggestions 数组.
func (h *Handler) SearchSuggestions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"suggestions": []string{}})
}
