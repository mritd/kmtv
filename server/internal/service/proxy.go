package service

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/utils"
)

var lookupIPAddr = net.DefaultResolver.LookupIPAddr

// ssrfSafeDialContext is a DialContext function that resolves DNS and blocks
// connections to private/loopback IP addresses to prevent SSRF attacks.
// ssrfSafeDialContext 是 DialContext 函数, 会先解析 DNS 并阻止连接私有或 loopback IP, 用于防止 SSRF.
func ssrfSafeDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("invalid address: %w", err)
	}

	ips, err := lookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("DNS lookup failed: %w", err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("DNS lookup returned no addresses for %s", host)
	}

	for _, ip := range ips {
		if isBlockedProxyIP(ip.IP) {
			return nil, fmt.Errorf("connection to blocked address %s is not allowed", ip.IP)
		}
	}

	// Dial using the first resolved IP.
	// 使用解析出的第一个 IP 建立连接.
	dialer := &net.Dialer{}
	return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
}

// isBlockedProxyIP reports whether an IP is unsafe for outbound proxy dialing.
// isBlockedProxyIP 判断 IP 是否不适合用于出站代理拨号.
func isBlockedProxyIP(ip net.IP) bool {
	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() ||
		ip.IsMulticast()
}

// NewSSRFSafeClient creates an HTTP client that blocks connections to private/loopback IPs.
// NewSSRFSafeClient 创建一个会阻止连接私有或 loopback IP 的 HTTP client.
func NewSSRFSafeClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext: ssrfSafeDialContext,
		},
	}
}

// ProxyService handles M3U8 rewriting and segment proxying.
// ProxyService 负责 M3U8 重写和分片代理.
type ProxyService struct {
	client *http.Client
}

// passthrough headers are forwarded from the client request to upstream.
// Accept-Encoding is intentionally excluded: Go's http.Transport handles
// gzip automatically when Accept-Encoding is NOT set by the caller.
// If we forward the browser's "gzip, deflate, br", the upstream returns
// compressed data but Go won't auto-decompress it (because we set it explicitly),
// resulting in garbled M3U8 content.
// passthroughHeaders 会从客户端请求转发到上游.
// 这里故意排除 Accept-Encoding: 调用方不显式设置时, Go 的 http.Transport 会自动处理 gzip.
// 如果转发浏览器的 "gzip, deflate, br", 上游会返回压缩数据, 但 Go 不会自动解压, 最终导致 M3U8 内容乱码.
var passthroughHeaders = []string{
	"User-Agent",
	"Accept",
	"Accept-Language",
}

var proxiedMediaResponseHeaders = map[string]bool{
	"Accept-Ranges":          true,
	"Cache-Control":          true,
	"Content-Length":         true,
	"Content-Range":          true,
	"Content-Type":           true,
	"ETag":                   true,
	"Expires":                true,
	"Last-Modified":          true,
	"X-Content-Type-Options": true,
}

// setProxyHeaders copies passthrough headers from client to outgoing request,
// falling back to defaults when the client header is absent.
// Referer is intentionally NOT set: many CDNs use Referer-based anti-hotlink
// protection and reject requests with unexpected Referer values. Upstream
// media fetches intentionally avoid sending Referer.
// setProxyHeaders 将可转发 header 从客户端请求复制到出站请求, 缺失时使用默认值.
// Referer 故意不设置: 很多 CDN 使用 Referer 防盗链, 遇到非预期 Referer 会拒绝请求. 上游媒体拉取也应避免发送 Referer.
func setProxyHeaders(dst *http.Request, clientHeaders http.Header) {
	ua := clientHeaders.Get("User-Agent")
	if ua == "" {
		ua = consts.DefaultUserAgent
	}
	dst.Header.Set("User-Agent", ua)

	for _, h := range passthroughHeaders[1:] { // skip UA, already set
		if v := clientHeaders.Get(h); v != "" {
			dst.Header.Set(h, v)
		}
	}

	if dst.Header.Get("Accept") == "" {
		dst.Header.Set("Accept", "*/*")
	}
}

// NewProxyService creates a new ProxyService.
// The proxy client skips TLS verification because upstream video CDNs
// frequently have expired or misconfigured certificates.
// NewProxyService 创建一个新的 ProxyService.
// 代理 client 会跳过 TLS 校验, 因为上游视频 CDN 经常存在证书过期或配置错误.
func NewProxyService() *ProxyService {
	return NewProxyServiceWithClient(newProxyClient(30 * time.Second))
}

// NewProxyServiceWithClient creates a ProxyService with an injected HTTP client.
// NewProxyServiceWithClient 使用注入的 HTTP client 创建 ProxyService.
func NewProxyServiceWithClient(client *http.Client) *ProxyService {
	if client == nil {
		client = newProxyClient(30 * time.Second)
	}
	return &ProxyService{
		client: client,
	}
}

// newProxyClient creates an HTTP client for proxying video content.
// It skips TLS verification and blocks private IPs.
// newProxyClient 创建用于代理视频内容的 HTTP client.
// 它会跳过 TLS 校验并阻止私有 IP 连接.
func newProxyClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			DialContext:     ssrfSafeDialContext,
		},
	}
}

// ProbeLines tests each CDN line by sending a GET request to the first episode URL.
// ProbeLines 使用每条 CDN 线路的第一个分集 URL 发送 GET 请求做可用性检测.
// Uses GET (not HEAD) because many CDNs respond differently to HEAD vs GET.
// 这里使用 GET 而不是 HEAD, 因为很多 CDN 对两者的响应并不一致.
// Returns only working lines; if all are dead or the context is cancelled, returns nil.
// 只返回可用线路; 如果全部不可用或 context 已取消, 返回 nil.
func (ps *ProxyService) ProbeLines(ctx context.Context, groups [][]model.Episode) [][]model.Episode {
	if len(groups) == 0 {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return nil
	}

	type result struct {
		index int
		ok    bool
	}
	type probeJob struct {
		index   int
		testURL string
	}

	results := make([]result, len(groups))
	jobs := make([]probeJob, 0, len(groups))
	timeout := GetProbeTimeout()
	cached := 0

	for i, group := range groups {
		if len(group) == 0 {
			results[i] = result{index: i, ok: false}
			continue
		}
		testURL := group[0].URL

		// Cache hit: use cached result, whether alive or dead.
		// 命中缓存时直接使用缓存结果, 无论该线路可用还是不可用.
		if alive, hit := probeCacheGet(testURL); hit {
			results[i] = result{index: i, ok: alive}
			cached++
			continue
		}

		jobs = append(jobs, probeJob{index: i, testURL: testURL})
	}

	// Probe uncached lines through the shared concurrency helper.
	// 通过共享并发 helper 探测未命中的线路.
	probed, _ := utils.GoProcess(ctx, jobs, GetProbeConcurrency(), false, func(ctx context.Context, job probeJob) (result, error) {
		reqCtx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, job.testURL, nil)
		if err != nil {
			probeCacheSet(job.testURL, false)
			return result{index: job.index, ok: false}, nil
		}
		// No Referer: CDNs use Referer-based anti-hotlink and reject unexpected values.
		// 不设置 Referer: CDN 常用 Referer 防盗链, 遇到非预期值会拒绝请求.
		req.Header.Set("User-Agent", consts.DefaultUserAgent)
		req.Header.Set("Accept", "*/*")
		req.Header.Set("Range", "bytes=0-1023")
		resp, err := ps.client.Do(req)
		if err != nil {
			probeCacheSet(job.testURL, false)
			return result{index: job.index, ok: false}, nil
		}
		_ = resp.Body.Close()
		ok := resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusPartialContent
		// Reject HTML responses because some sources store page URLs instead of M3U8 links.
		// 拒绝 HTML 响应, 因为部分视频源会把网页 URL 而不是 M3U8 链接写进播放地址.
		if ok {
			ct := resp.Header.Get("Content-Type")
			if strings.Contains(ct, "text/html") {
				ok = false
			}
		}
		if !ok {
			logrus.WithFields(logrus.Fields{"url": job.testURL, "status": resp.StatusCode}).Warn("CDN probe failed")
		}
		probeCacheSet(job.testURL, ok)
		return result{index: job.index, ok: ok}, nil
	})
	for _, r := range probed {
		results[r.index] = r
	}

	var alive [][]model.Episode
	for _, r := range results {
		if r.ok {
			alive = append(alive, groups[r.index])
		}
	}

	logrus.WithFields(logrus.Fields{"total": len(groups), "alive": len(alive), "cached": cached}).Info("probed CDN lines")
	return alive
}

var keyURIPattern = regexp.MustCompile(`URI="([^"]+)"`)

// MediaURLSigner issues a media token for one rewritten URL.
// MediaURLSigner 为单个重写后的 URL 签发媒体 token.
type MediaURLSigner func(kind, rawURL, sourceKey string) (string, error)

func signedProxyURL(proxyBase, endpoint, absURL, sourceKey string, signer MediaURLSigner) (string, error) {
	if signer == nil {
		return "", fmt.Errorf("media URL signer is required")
	}
	token, err := signer(endpoint, absURL, sourceKey)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/api/v1/proxy/%s?url=%s&source=%s&mt=%s",
		proxyBase,
		endpoint,
		url.QueryEscape(absURL),
		url.QueryEscape(sourceKey),
		url.QueryEscape(token),
	), nil
}

// RewriteM3U8 rewrites URLs in M3U8 content to point to the proxy.
// - Rewrite EXT-X-KEY URI to /api/proxy/key?url=<encoded>&source=<key>&mt=<token>
// - Rewrite segment URLs to /api/proxy/segment?url=<encoded>&source=<key>&mt=<token>
// - Resolve relative URLs against baseURL
// RewriteM3U8 将 M3U8 内容里的 URL 重写到代理端点.
// - 将 EXT-X-KEY URI 重写到 /api/proxy/key?url=<encoded>&source=<key>&mt=<token>
// - 将分片 URL 重写到 /api/proxy/segment?url=<encoded>&source=<key>&mt=<token>
// - 基于 baseURL 解析相对 URL
func RewriteM3U8(content, baseURL, proxyBase, sourceKey string, signer MediaURLSigner) (string, error) {
	lines := strings.Split(content, "\n")
	var result []string
	isMasterPlaylist := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Rewrite EXT-X-KEY URI.
		// 重写 EXT-X-KEY URI.
		if strings.HasPrefix(trimmed, "#EXT-X-KEY") {
			var rewriteErr error
			line = keyURIPattern.ReplaceAllStringFunc(line, func(match string) string {
				if rewriteErr != nil {
					return match
				}
				sub := keyURIPattern.FindStringSubmatch(match)
				if len(sub) < 2 {
					return match
				}
				absURL := utils.ResolveURL(baseURL, sub[1])
				rewritten, err := signedProxyURL(proxyBase, MediaKindKey, absURL, sourceKey, signer)
				if err != nil {
					rewriteErr = err
					return match
				}
				return fmt.Sprintf(`URI="%s"`, rewritten)
			})
			if rewriteErr != nil {
				return "", rewriteErr
			}
			result = append(result, line)
			continue
		}

		// Detect master playlist and rewrite sub-playlist URLs to the M3U8 proxy.
		// 检测 master playlist, 并将子 playlist URL 重写到 M3U8 代理.
		if strings.HasPrefix(trimmed, "#EXT-X-STREAM-INF") {
			result = append(result, line)
			isMasterPlaylist = true
			continue
		}

		// Skip other comments and empty lines.
		// 跳过其他注释行和空行.
		if strings.HasPrefix(trimmed, "#") || trimmed == "" {
			result = append(result, line)
			continue
		}

		absURL := utils.ResolveURL(baseURL, trimmed)
		if isMasterPlaylist {
			// Sub-playlist URL: proxy through M3U8 endpoint.
			// 子 playlist URL 通过 M3U8 端点代理.
			rewritten, err := signedProxyURL(proxyBase, MediaKindM3U8, absURL, sourceKey, signer)
			if err != nil {
				return "", err
			}
			result = append(result, rewritten)
			isMasterPlaylist = false
		} else {
			// Segment URL.
			// 分片 URL.
			rewritten, err := signedProxyURL(proxyBase, MediaKindSegment, absURL, sourceKey, signer)
			if err != nil {
				return "", err
			}
			result = append(result, rewritten)
		}
	}

	return strings.Join(result, "\n"), nil
}

// FetchM3U8 fetches and rewrites an M3U8 manifest.
// clientHeaders are forwarded from the browser request for authenticity.
// FetchM3U8 拉取并重写 M3U8 manifest.
// clientHeaders 会从浏览器请求转发到上游, 让请求更接近真实客户端.
func (ps *ProxyService) FetchM3U8(ctx context.Context, targetURL, proxyBase, sourceKey string, clientHeaders http.Header, signer MediaURLSigner) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return "", fmt.Errorf("build M3U8 request: %w", err)
	}
	setProxyHeaders(req, clientHeaders)

	resp, err := ps.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch M3U8: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("M3U8 returned status %d", resp.StatusCode)
	}

	// Limit M3U8 manifests to 10MB to avoid unbounded memory use.
	// 将 M3U8 manifest 限制为 10MB, 避免无限制占用内存.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return "", fmt.Errorf("read M3U8 body: %w", err)
	}

	// Validate that the response is actually an M3U8 manifest, not an HTML page
	// or other non-video content. Some sources store HTML page URLs (for example, ordinary watch-page URLs)
	// in vod_play_url instead of actual M3U8 links.
	// 校验响应确实是 M3U8 manifest, 而不是 HTML 页面或其他非视频内容.
	// 部分视频源会在 vod_play_url 中保存网页 URL, 例如 普通播放页面, 而不是实际 M3U8 链接.
	content := strings.TrimSpace(string(body))
	if !strings.HasPrefix(content, "#EXTM3U") {
		return "", fmt.Errorf("response is not a valid M3U8 manifest (missing #EXTM3U header)")
	}

	base := utils.ExtractBaseURL(targetURL)
	return RewriteM3U8(content, base, proxyBase, sourceKey, signer)
}

// ProxySegment proxies a video segment or key request.
// clientHeaders are forwarded from the browser request for authenticity.
// ProxySegment 代理视频分片或密钥请求.
// clientHeaders 会从浏览器请求转发到上游, 让请求更接近真实客户端.
func (ps *ProxyService) ProxySegment(ctx context.Context, w http.ResponseWriter, targetURL string, clientHeaders http.Header) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		logrus.WithError(err).WithField("url", targetURL).Error("build segment request failed")
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	setProxyHeaders(req, clientHeaders)

	resp, err := ps.client.Do(req)
	if err != nil {
		logrus.WithError(err).WithField("url", targetURL).Error("proxy segment request failed")
		http.Error(w, "upstream source unavailable", http.StatusNotFound)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// Copy only media-safe response headers from upstream.
	// 仅复制上游响应中对媒体播放安全且必要的 header.
	for k, vs := range resp.Header {
		if !proxiedMediaResponseHeaders[http.CanonicalHeaderKey(k)] {
			continue
		}
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)

	// Limit proxied segment/key bodies to 512MB to cap memory and bandwidth abuse.
	// 将代理分片或密钥响应限制为 512MB, 限制内存和带宽滥用.
	if _, err := io.Copy(w, io.LimitReader(resp.Body, 512<<20)); err != nil {
		logrus.WithError(err).WithField("url", targetURL).Error("proxy segment copy failed")
	}
}
