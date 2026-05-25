package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/service"
)

// DoubanCategories returns the list of available Douban categories.
// DoubanCategories 返回可用的 Douban 分类列表.
func (h *Handler) DoubanCategories(c *gin.Context) {
	categories := h.doubanSvc.GetCategories()
	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

// DoubanList returns a paginated list of Douban items by category and type.
// DoubanList 按分类和类型返回分页 Douban 条目列表.
func (h *Handler) DoubanList(c *gin.Context) {
	category := c.Query("category")
	mediaType := c.Query("type")
	if mediaType != "movie" && mediaType != "tv" {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg("type must be 'movie' or 'tv'"))
		return
	}

	start := 0
	if s := c.Query("start"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v >= 0 {
			start = v
		}
	}

	count := 20
	if cnt := c.Query("count"); cnt != "" {
		if v, err := strconv.Atoi(cnt); err == nil && v > 0 {
			count = v
		}
	}
	if count > 50 {
		count = 50
	}

	items, err := h.doubanSvc.GetList(c.Request.Context(), category, mediaType, start, count)
	if err != nil {
		c.JSON(http.StatusBadGateway, errs.GatewayError.WithMsg("failed to fetch Douban list"))
		return
	}

	h.doubanSvc.RewriteCovers(items)
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// recentHotRegionType maps a Chinese region name to the Douban recent_hot "type" parameter.
// Movie uses Chinese names directly; TV and Show use Douban-specific type codes.
// recentHotRegionType 将中文地区名映射为 Douban recent_hot 的 "type" 参数.
// 电影直接使用中文名称, 剧集和综艺使用 Douban 特定 type code.
func recentHotRegionType(format, region string) string {
	switch format {
	case "电视剧":
		switch region {
		case "华语":
			return "tv_domestic"
		case "欧美":
			return "tv_american"
		case "日本":
			return "tv_japanese"
		case "韩国":
			return "tv_korean"
		default:
			return "tv"
		}
	case "综艺":
		switch region {
		case "华语":
			return "show_domestic"
		case "欧美", "韩国", "日本":
			return "show_foreign"
		default:
			return "show"
		}
	default:
		// Movie: Chinese region names work directly.
		// 电影: 中文地区名可以直接使用.
		if region != "" {
			return region
		}
		return "全部"
	}
}

// DoubanRecommend returns recommended movies from Douban.
// DoubanRecommend 返回 Douban 推荐电影.
func (h *Handler) DoubanRecommend(c *gin.Context) {
	items, err := h.doubanSvc.GetRecommend(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, errs.GatewayError.WithMsg("failed to fetch Douban recommendations"))
		return
	}

	h.doubanSvc.RewriteCovers(items)
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// DoubanHomeSections returns all home page sections with pre-fetched items.
// DoubanHomeSections 返回已预取条目的全部首页分区.
func (h *Handler) DoubanHomeSections(c *gin.Context) {
	sections := h.doubanSvc.GetHomeSections(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"sections": sections})
}

// DoubanRecommendByFilters returns Douban items filtered by kind, tag, format, and region.
// When tag is non-empty, uses the recent_hot API (for ranked lists like 热门/最新).
// When tag is empty, uses the recommend API (for general browsing with format/region filters).
// DoubanRecommendByFilters 按 kind, tag, format 和 region 返回 Douban 条目.
// tag 非空时使用 recent_hot API, 用于 热门/最新 等榜单.
// tag 为空时使用 recommend API, 用于按 format/region 做通用浏览.
func (h *Handler) DoubanRecommendByFilters(c *gin.Context) {
	kind := c.Query("kind")
	if kind == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("kind parameter is required"))
		return
	}

	tag := c.Query("tag")
	format := c.Query("format")
	region := c.Query("region")

	start := 0
	if s := c.Query("start"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v >= 0 {
			start = v
		}
	}

	count := 20
	if cnt := c.Query("count"); cnt != "" {
		if v, err := strconv.Atoi(cnt); err == nil && v > 0 {
			count = v
		}
	}
	if count > 50 {
		count = 50
	}

	var items []service.DoubanItem
	var err error

	// Ranking keywords work with the recent_hot API; everything else uses recommend.
	// 排行类关键字使用 recent_hot API, 其他场景使用 recommend API.
	recentHotTags := map[string]bool{
		"热门": true, "最新": true, "豆瓣高分": true, "冷门佳片": true,
	}

	if recentHotTags[tag] {
		// recent_hot uses "type" for region filtering.
		// Movie uses Chinese names directly; TV/Show use Douban type codes.
		// recent_hot 使用 "type" 做地区过滤.
		// 电影直接使用中文名称, 剧集和综艺使用 Douban type code.
		recentHotType := recentHotRegionType(format, region)
		items, err = h.doubanSvc.GetRecentHot(c.Request.Context(), kind, tag, recentHotType, start, count)
	} else {
		items, err = h.doubanSvc.GetRecommendByFilters(c.Request.Context(), kind, tag, format, region, start, count)
	}

	if err != nil {
		c.JSON(http.StatusBadGateway, errs.GatewayError.WithMsg("failed to fetch Douban recommendations"))
		return
	}

	h.doubanSvc.RewriteCovers(items)
	c.JSON(http.StatusOK, gin.H{"items": items})
}
