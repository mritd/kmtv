package handler

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	appruntime "github.com/mritd/kmtv/internal/runtime"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/utils"
)

// ProxyM3U8 fetches and rewrites an M3U8 manifest via the proxy service.
// ProxyM3U8 通过代理服务拉取并重写 M3U8 manifest.
func (h *Handler) ProxyM3U8(c *gin.Context) {
	targetURL := c.Query("url")
	if targetURL == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("query parameter 'url' is required"))
		return
	}
	if err := utils.ValidateExternalURL(targetURL); err != nil {
		c.JSON(http.StatusForbidden, errs.Blocked.WithMsg("blocked: "+err.Error()))
		return
	}
	mediaToken, ok := h.requireMediaToken(c, service.MediaKindM3U8, targetURL)
	if !ok {
		return
	}
	if !h.requireMediaTokenSourceAccess(c, mediaToken) {
		return
	}

	sourceKey := c.Query("source")

	proxyBase := h.publicBaseURL(c.Request)
	signer := func(kind, rawURL, sourceKey string) (string, error) {
		return h.mediaSvc.IssueMediaToken(mediaToken.AuthSessionID, kind, rawURL, sourceKey, time.Duration(appruntime.Default().MediaTokenTTL())*time.Second)
	}
	content, err := h.proxySvc.FetchM3U8(c.Request.Context(), targetURL, proxyBase, sourceKey, c.Request.Header, signer)
	if err != nil {
		logrus.WithError(err).WithField("url", targetURL).Error("failed to fetch M3U8")
		c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("upstream source unavailable"))
		return
	}

	c.Data(http.StatusOK, "application/vnd.apple.mpegurl", []byte(content))
}

// ProxySegment proxies a video segment request.
// ProxySegment 代理视频分片请求.
func (h *Handler) ProxySegment(c *gin.Context) {
	targetURL := c.Query("url")
	if targetURL == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("query parameter 'url' is required"))
		return
	}
	if err := utils.ValidateExternalURL(targetURL); err != nil {
		c.JSON(http.StatusForbidden, errs.Blocked.WithMsg("blocked: "+err.Error()))
		return
	}
	mediaToken, ok := h.requireMediaToken(c, service.MediaKindSegment, targetURL)
	if !ok {
		return
	}
	if !h.requireMediaTokenSourceAccess(c, mediaToken) {
		return
	}

	h.proxySvc.ProxySegment(c.Request.Context(), c.Writer, targetURL, c.Request.Header)
}

// ProxyKey proxies an encryption key request.
// ProxyKey 代理加密密钥请求.
func (h *Handler) ProxyKey(c *gin.Context) {
	targetURL := c.Query("url")
	if targetURL == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("query parameter 'url' is required"))
		return
	}
	if err := utils.ValidateExternalURL(targetURL); err != nil {
		c.JSON(http.StatusForbidden, errs.Blocked.WithMsg("blocked: "+err.Error()))
		return
	}
	mediaToken, ok := h.requireMediaToken(c, service.MediaKindKey, targetURL)
	if !ok {
		return
	}
	if !h.requireMediaTokenSourceAccess(c, mediaToken) {
		return
	}

	h.proxySvc.ProxySegment(c.Request.Context(), c.Writer, targetURL, c.Request.Header)
}

// requireMediaToken verifies a URL-bound media token before proxying media.
// requireMediaToken 在代理媒体前校验绑定 URL 的媒体 token.
func (h *Handler) requireMediaToken(c *gin.Context, kind, targetURL string) (*model.MediaToken, bool) {
	token := c.Query("mt")
	if token == "" {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn.WithMsg("missing media token"))
		return nil, false
	}
	mediaToken, ok, err := h.mediaSvc.VerifyMediaTokenDetail(token, kind, targetURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to verify media token"))
		return nil, false
	}
	if !ok {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn.WithMsg("invalid or expired media token"))
		return nil, false
	}
	return mediaToken, true
}

func (h *Handler) requireMediaTokenSourceAccess(c *gin.Context, mediaToken *model.MediaToken) bool {
	if mediaToken == nil || mediaToken.SourceKey == "" {
		return true
	}
	src, err := h.store.GetSourceByKey(mediaToken.SourceKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to look up source"))
		return false
	}
	if src == nil || !src.IsAdult {
		return true
	}
	enabled, err := h.nsfwFilterEnabled()
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to read adult content setting"))
		return false
	}
	if enabled || mediaToken.AuthSessionID == 0 {
		c.JSON(http.StatusForbidden, errs.Blocked.WithMsg("adult content access denied"))
		return false
	}
	_, user, err := h.store.GetValidAuthSessionByID(mediaToken.AuthSessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to verify media session"))
		return false
	}
	if user == nil || !user.AllowAdultContent {
		c.JSON(http.StatusForbidden, errs.Blocked.WithMsg("adult content access denied"))
		return false
	}
	return true
}

// ProxyImage proxies a Douban image request with domain whitelist enforcement.
// ProxyImage 代理 Douban 图片请求, 并强制执行域名白名单.
func (h *Handler) ProxyImage(c *gin.Context) {
	rawURL := c.Query("url")
	if rawURL == "" {
		c.JSON(http.StatusBadRequest, errs.MissingParam.WithMsg("url parameter required"))
		return
	}

	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		c.JSON(http.StatusBadRequest, errs.InvalidURL.WithMsg("invalid url"))
		return
	}

	// Domain whitelist: only allow *.doubanio.com.
	// 域名白名单: 只允许 *.doubanio.com.
	host := parsed.Hostname()
	if !strings.HasSuffix(host, ".doubanio.com") && host != "doubanio.com" {
		c.JSON(http.StatusForbidden, errs.Blocked.WithMsg("domain not allowed"))
		return
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), "GET", rawURL, nil)
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidURL.WithMsg("invalid url"))
		return
	}
	// Forward real browser UA, falling back to default.
	// 转发真实浏览器 UA, 缺失时使用默认值.
	ua := c.Request.Header.Get("User-Agent")
	if ua == "" {
		ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Referer", "https://movie.douban.com/")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	if al := c.Request.Header.Get("Accept-Language"); al != "" {
		req.Header.Set("Accept-Language", al)
	} else {
		req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	}
	req.Header.Set("Sec-Fetch-Dest", "image")
	req.Header.Set("Sec-Fetch-Mode", "no-cors")
	req.Header.Set("Sec-Fetch-Site", "cross-site")

	resp, err := h.imageClient.Do(req)
	if err != nil {
		c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("image unavailable"))
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, errs.ServerError.WithMsg("upstream image request failed"))
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType != "" {
		c.Header("Content-Type", contentType)
	}
	c.Header("Cache-Control", "public, max-age=15720000")

	// Limit proxied image bodies to 10MB.
	// 将代理图片响应限制为 10MB.
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, io.LimitReader(resp.Body, 10<<20))
}

// publicBaseURL returns the configured public URL used in generated proxy links.
// Priority: env, DB setting, then current forwarded-header fallback.
// publicBaseURL 返回生成代理链接时使用的外部访问根地址.
// 优先级: 环境变量, 数据库设置, 最后回退当前 forwarded header 逻辑.
func (h *Handler) publicBaseURL(r *http.Request) string {
	if value := normalizePublicBaseURL(os.Getenv(consts.EnvPublicBaseURL)); value != "" {
		return value
	}
	if h != nil && h.store != nil {
		if value, err := h.store.GetSetting(consts.SettingPublicBaseURL); err == nil {
			if normalized := normalizePublicBaseURL(value); normalized != "" {
				return normalized
			}
		}
	}
	return scheme(r) + "://" + host(r)
}

func normalizePublicBaseURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || service.ValidatePublicBaseURL(value) != nil {
		return ""
	}
	return strings.TrimRight(value, "/")
}

// scheme returns the request scheme (http or https).
// Trusts X-Forwarded-Proto from reverse proxy; falls back to r.TLS.
// scheme 返回请求 scheme, 即 http 或 https.
// 信任反向代理传入的 X-Forwarded-Proto, 缺失时回退到 r.TLS.
func scheme(r *http.Request) string {
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		return proto
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

// host returns the public-facing host (with port if present).
// Trusts X-Forwarded-Host from reverse proxy; falls back to r.Host.
// host 返回对外可见的 host, 包括可能存在的端口.
// 信任反向代理传入的 X-Forwarded-Host, 缺失时回退到 r.Host.
func host(r *http.Request) string {
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		return h
	}
	return r.Host
}
