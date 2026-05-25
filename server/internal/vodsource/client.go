package vodsource

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/utils"
)

// StatusError reports a non-200 upstream response status.
// StatusError 表示上游视频源返回了非 200 状态码.
type StatusError struct {
	StatusCode int
}

func (e StatusError) Error() string {
	return fmt.Sprintf("%s %d", errs.ErrVideoSourceBadStatus, e.StatusCode)
}

func (e StatusError) Unwrap() error {
	return errs.ErrVideoSourceBadStatus
}

// Client fetches and decodes video-source list responses.
// Client 用于拉取并解析视频源列表响应.
type Client struct {
	httpClient *http.Client
	bodyLimit  int64
}

// NewClient creates a video-source client using the provided HTTP client.
// NewClient 使用传入的 HTTP client 创建视频源客户端.
func NewClient(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		httpClient: httpClient,
		bodyLimit:  consts.VideoSourceBodyLimit,
	}
}

// BuildSearchURL builds a compatible video-source search URL.
// BuildSearchURL 构造兼容视频源搜索 URL.
func BuildSearchURL(apiURL, query string, page int) string {
	sep := "?"
	if strings.Contains(apiURL, "?") {
		sep = "&"
	}
	return apiURL + sep + "ac=videolist&wd=" + url.QueryEscape(query) + "&pg=" + strconv.Itoa(page)
}

// BuildDetailURL builds a compatible video-source detail URL.
// BuildDetailURL 构造兼容视频源详情 URL.
func BuildDetailURL(apiURL, videoID string) string {
	sep := "?"
	if strings.Contains(apiURL, "?") {
		sep = "&"
	}
	return apiURL + sep + "ac=videolist&ids=" + url.QueryEscape(videoID)
}

// BestDescription picks the display description from video-source fields.
// BestDescription 从视频源字段中选择用于展示的简介.
func BestDescription(blurb, content string) string {
	if b := strings.TrimSpace(blurb); b != "" {
		return b
	}
	if c := utils.StripHTML(content); c != "" {
		return c
	}
	return ""
}

// FullDescription combines blurb and cleaned content for detail responses.
// FullDescription 合并简介和清洗后的正文, 用于详情响应.
func FullDescription(blurb, content string) string {
	desc := strings.TrimSpace(blurb)
	cleaned := utils.StripHTML(content)
	if cleaned == "" {
		return desc
	}
	if desc != "" {
		return desc + "\n" + cleaned
	}
	return cleaned
}

// FetchList fetches a compatible video-source list response and returns both decoded data and raw body.
// FetchList 拉取兼容视频源列表响应, 同时返回解析后的数据和原始响应体.
func (c *Client) FetchList(ctx context.Context, targetURL string) (*model.VideoSourceResponse, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("build video-source request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("fetch video-source list: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, c.bodyLimit))
	if err != nil {
		return nil, nil, fmt.Errorf("read video-source response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, body, StatusError{StatusCode: resp.StatusCode}
	}

	var sourceResp model.VideoSourceResponse
	if err := json.Unmarshal(body, &sourceResp); err != nil {
		return nil, body, fmt.Errorf("%w: %v", errs.ErrVideoSourceDecode, err)
	}

	return &sourceResp, body, nil
}
