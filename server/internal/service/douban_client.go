package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/mritd/kmtv/internal/consts"
)

// GetList fetches a list of items from Douban by category and media type.
// GetList 按分类和媒体类型从 Douban 获取条目列表.
func (ds *DoubanService) GetList(ctx context.Context, category, mediaType string, start, count int) ([]DoubanItem, error) {
	apiURL := "https://movie.douban.com/j/search_subjects?" + url.Values{
		"type":       {mediaType},
		"tag":        {category},
		"page_limit": {strconv.Itoa(count)},
		"page_start": {strconv.Itoa(start)},
	}.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build douban request: %w", err)
	}

	req.Header.Set("User-Agent", consts.DefaultUserAgent)
	req.Header.Set("Referer", "https://movie.douban.com/")

	resp, err := ds.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch douban list: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20)) // 2MB limit
	if err != nil {
		return nil, fmt.Errorf("read douban response: %w", err)
	}

	var apiResp struct {
		Subjects []doubanAPIItem `json:"subjects"`
	}
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("decode douban response: %w", err)
	}

	items := make([]DoubanItem, 0, len(apiResp.Subjects))
	for _, s := range apiResp.Subjects {
		items = append(items, DoubanItem{
			ID:    s.ID,
			Title: s.Title,
			Cover: s.Cover,
			Rate:  s.Rate,
		})
	}

	return items, nil
}

// GetRecentHot fetches items from the Douban mobile recent_hot API.
// GetRecentHot 从 Douban 移动端 recent_hot API 获取条目.
func (ds *DoubanService) GetRecentHot(ctx context.Context, kind, category, mediaType string, start, count int) ([]DoubanItem, error) {
	apiURL := "https://m.douban.com/rexxar/api/v2/subject/recent_hot/" + url.PathEscape(kind) + "?" + url.Values{
		"start":    {strconv.Itoa(start)},
		"limit":    {strconv.Itoa(count)},
		"category": {category},
		"type":     {mediaType},
	}.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build douban recent_hot request: %w", err)
	}

	req.Header.Set("User-Agent", consts.DefaultUserAgent)
	req.Header.Set("Referer", "https://movie.douban.com/")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Origin", "https://movie.douban.com")

	resp, err := ds.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch douban recent_hot: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("read douban recent_hot response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("douban recent_hot returned status %d", resp.StatusCode)
	}

	var apiResp recentHotResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("decode douban recent_hot response: %w", err)
	}

	items := make([]DoubanItem, 0, len(apiResp.Items))
	for _, item := range apiResp.Items {
		cover := item.Pic.Normal
		if cover == "" {
			cover = item.Pic.Large
		}
		rate := ""
		if item.Rating.Value > 0 {
			rate = strconv.FormatFloat(item.Rating.Value, 'f', 1, 64)
		}
		items = append(items, DoubanItem{
			ID:    item.ID,
			Title: item.Title,
			Cover: cover,
			Rate:  rate,
			Year:  extractYearFromSubtitle(item.CardSubtitle),
			Kind:  kind,
		})
	}

	return items, nil
}

func extractYearFromSubtitle(subtitle string) string {
	if len(subtitle) < 4 {
		return ""
	}
	for i := 0; i <= len(subtitle)-4; i++ {
		c := subtitle[i]
		if c >= '1' && c <= '2' &&
			subtitle[i+1] >= '0' && subtitle[i+1] <= '9' &&
			subtitle[i+2] >= '0' && subtitle[i+2] <= '9' &&
			subtitle[i+3] >= '0' && subtitle[i+3] <= '9' {
			return subtitle[i : i+4]
		}
	}
	return ""
}

// GetRecommend returns recommended movies using the recent_hot API.
// GetRecommend 使用 recent_hot API 返回推荐电影.
func (ds *DoubanService) GetRecommend(ctx context.Context) ([]DoubanItem, error) {
	return ds.GetRecentHot(ctx, "movie", "热门", "全部", 0, 20)
}

// GetRecommendByFilters fetches items from the Douban mobile recommend API filtered by kind, tag, format, and region.
// GetRecommendByFilters 按 kind, tag, format 和 region 从 Douban 移动端 recommend API 获取条目.
func (ds *DoubanService) GetRecommendByFilters(ctx context.Context, kind, tag, format, region string, start, count int) ([]DoubanItem, error) {
	selectedCategories := map[string]string{}
	if tag != "" {
		selectedCategories["类型"] = tag
	}
	if format != "" {
		selectedCategories["形式"] = format
	}
	if region != "" {
		selectedCategories["地区"] = region
	}

	selectedJSON, err := json.Marshal(selectedCategories)
	if err != nil {
		return nil, fmt.Errorf("marshal selected_categories: %w", err)
	}

	var tagParts []string
	if tag != "" {
		tagParts = append(tagParts, tag)
	}
	if !slices.Contains(tagParts, format) && format != "" {
		tagParts = append(tagParts, format)
	}
	if region != "" {
		tagParts = append(tagParts, region)
	}

	apiURL := "https://m.douban.com/rexxar/api/v2/" + url.PathEscape(kind) + "/recommend?" + url.Values{
		"start":               {strconv.Itoa(start)},
		"count":               {strconv.Itoa(count)},
		"selected_categories": {string(selectedJSON)},
		"tags":                {strings.Join(tagParts, ",")},
	}.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build douban recommend request: %w", err)
	}

	req.Header.Set("User-Agent", consts.DefaultUserAgent)
	req.Header.Set("Referer", "https://movie.douban.com/")

	resp, err := ds.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch douban recommend: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("read douban recommend response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("douban recommend returned status %d", resp.StatusCode)
	}

	var apiResp recommendResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("decode douban recommend response: %w", err)
	}

	items := make([]DoubanItem, 0, len(apiResp.Items))
	for _, item := range apiResp.Items {
		if item.ID == "" || item.Title == "" || (item.Type != "movie" && item.Type != "tv") {
			continue
		}
		cover := item.Pic.Normal
		if cover == "" {
			cover = item.Pic.Large
		}
		rate := ""
		if item.Rating.Value > 0 {
			rate = strconv.FormatFloat(item.Rating.Value, 'f', 1, 64)
		}
		items = append(items, DoubanItem{
			ID:    item.ID,
			Title: item.Title,
			Cover: cover,
			Rate:  rate,
			Year:  item.Year,
			Kind:  kind,
		})
	}

	return items, nil
}

func (ds *DoubanService) GetSubjectDescription(ctx context.Context, kind, id string) (string, error) {
	kind = strings.TrimSpace(kind)
	id = strings.TrimSpace(id)
	if kind != "movie" && kind != "tv" {
		return "", fmt.Errorf("unsupported douban subject kind %q", kind)
	}
	if id == "" {
		return "", fmt.Errorf("empty douban subject id")
	}

	apiURL := "https://m.douban.com/rexxar/api/v2/" + url.PathEscape(kind) + "/" + url.PathEscape(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("build douban subject request: %w", err)
	}
	req.Header.Set("User-Agent", consts.DefaultUserAgent)
	req.Header.Set("Referer", "https://movie.douban.com/")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Origin", "https://movie.douban.com")

	resp, err := ds.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch douban subject: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return "", fmt.Errorf("read douban subject response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("douban subject returned status %d", resp.StatusCode)
	}

	var apiResp doubanSubjectDetailResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return "", fmt.Errorf("decode douban subject response: %w", err)
	}
	return apiResp.bestDescription(), nil
}
