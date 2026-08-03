package service

import (
	"context"
	"crypto/tls"
	"errors"
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

// Vars rather than consts so tests can shrink them; production never reassigns
// these. Mirrors the existing lookupIPAddr injection seam at proxy.go:22.
// 使用 var 而非 const 以便测试调小; 生产代码不会重新赋值.
// 与 proxy.go:22 现有的 lookupIPAddr 注入方式一致.
var (
	// m3u8FetchTimeout bounds a manifest request end to end. The payload is
	// small and already capped at 10 MB, and a manifest failure fails playback
	// outright, so the value is deliberately generous.
	// m3u8FetchTimeout 限制 manifest 请求的端到端总时长. 该响应体积小且已限制在
	// 10 MB 以内, 而 manifest 拉取失败会直接导致播放失败, 故取值刻意放宽.
	m3u8FetchTimeout = 60 * time.Second

	// segmentIdleTimeout bounds how long a segment body may go silent. It is
	// not a total-duration cap: a slow link keeps delivering bytes and resets
	// the timer, while a stalled peer is released.
	// segmentIdleTimeout 限制分片响应体的最长静默时间. 它不是总时长上限:
	// 链路慢但仍在传输时会不断重置计时器, 只有卡死的对端才会被释放.
	segmentIdleTimeout = 30 * time.Second
)

// proxyDecisionKey carries the single resolution of "proxy or direct" for one
// request, so the transport and the dialer read the same answer.
// proxyDecisionKey 保存单个请求 "走代理还是直连" 的唯一决策结果,
// 使 transport 与 dialer 读到同一答案.
type proxyDecisionKey struct{}

// proxyDecision records the resolved proxy for a request; a nil url means direct.
// proxyDecision 记录该请求解析出的代理; url 为 nil 表示直连.
type proxyDecision struct {
	url *url.URL
}

// errUnstampedRequest reports a request that never passed through
// proxyDecisionTransport, and therefore carries no proxy decision.
// errUnstampedRequest 表示请求未经过 proxyDecisionTransport, 因而没有代理决策.
var errUnstampedRequest = errors.New("request was not routed through proxyDecisionTransport")

// proxyDecisionTransport resolves the proxy exactly once per request and stamps
// the result onto the context before delegating.
//
// The resolver is held here, not in Transport.Proxy, on purpose. net/http calls
// Transport.Proxy itself during connect; if that were the real resolver it would
// be evaluated a second time, and any resolver whose answer differed between the
// two calls would leave the dialer trusting a stale decision — skipping the SSRF
// check on a connection that actually went direct. Resolving once and replaying
// the stored value makes divergence impossible by construction.
//
// Wrapping the transport rather than asking each call site to stamp is likewise
// deliberate: an unstamped request fails closed, so a missed call site is a loud
// failure instead of a silently disabled SSRF guard.
//
// proxyDecisionTransport 每个请求只解析一次代理, 并在委托前将结果写入 context.
//
// resolver 有意放在这里而非 Transport.Proxy: net/http 在建立连接时会自行调用
// Transport.Proxy, 若那里放真实 resolver 就会被二次求值; 两次答案不一致时,
// dialer 会据过期决策跳过 SSRF 检查, 而该连接实际是直连.
// 只解析一次并回放存储值, 从结构上杜绝了不一致.
//
// 选择包装 transport 而非要求每个调用点自行标记同样是有意为之:
// 未标记的请求会直接失败, 因此遗漏调用点会明确报错, 而不是静默关闭 SSRF 防护.
type proxyDecisionTransport struct {
	base     *http.Transport
	resolver func(*http.Request) (*url.URL, error)
}

func (p *proxyDecisionTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	var decision proxyDecision
	if p.resolver != nil {
		proxyURL, err := p.resolver(req)
		if err != nil {
			return nil, fmt.Errorf("resolve proxy for %s: %w", req.URL.Redacted(), err)
		}
		decision.url = proxyURL
	}
	return p.base.RoundTrip(req.WithContext(context.WithValue(req.Context(), proxyDecisionKey{}, decision)))
}

// proxyDecisionFrom returns the decision stamped on ctx, or an error when absent.
// proxyDecisionFrom 返回 ctx 上标记的决策, 不存在时返回错误.
func proxyDecisionFrom(ctx context.Context) (proxyDecision, error) {
	decision, ok := ctx.Value(proxyDecisionKey{}).(proxyDecision)
	if !ok {
		return proxyDecision{}, errUnstampedRequest
	}
	return decision, nil
}

// ssrfSafeDialContext resolves DNS and blocks connections to private/loopback
// IP addresses to prevent SSRF.
//
// When the request is routed through the operator's forward proxy, the address
// being dialed is that proxy — routinely loopback or private — so the IP check
// is skipped. That decision must come from the context stamp, never from
// matching the address: Go bypasses the proxy for loopback targets, so an
// attacker targeting the proxy's own address produces an identical dial
// address with the opposite meaning.
//
// ssrfSafeDialContext 会先解析 DNS 并阻止连接私有或 loopback IP, 用于防止 SSRF.
//
// 当请求经由运维配置的正向代理时, 拨号目标就是该代理 (通常位于 loopback 或
// 私有网段), 因此跳过 IP 检查. 该判断必须来自 context 标记, 绝不能靠比对地址:
// Go 对 loopback 目标会绕过代理, 攻击者以代理自身地址为目标时会产生完全相同的
// 拨号地址, 含义却相反.
func ssrfSafeDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	decision, err := proxyDecisionFrom(ctx)
	if err != nil {
		return nil, fmt.Errorf("refusing to dial %s: %w", addr, err)
	}
	if decision.url != nil {
		// Reaching the operator's proxy; it owns egress access control.
		// 目标是运维配置的代理, 由代理自身负责出站访问控制.
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}

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

// newOutboundTransport builds the base transport shared by every outbound
// client: proxy support, the SSRF dialer, and connection pooling.
//
// MaxIdleConnsPerHost is raised from Go's default of 2 because hls.js fetches
// fragments concurrently; at the default, most requests cannot reuse a
// connection and pay a fresh TCP + TLS handshake.
//
// newOutboundTransport 构建所有出站 client 共用的基础 transport:
// 代理支持, SSRF dialer, 以及连接池.
//
// MaxIdleConnsPerHost 从 Go 默认的 2 上调, 因为 hls.js 会并发拉取分片;
// 保持默认时大部分请求无法复用连接, 每次都要重新完成 TCP + TLS 握手.
func newOutboundTransport() *http.Transport {
	return &http.Transport{
		// Replays the decision proxyDecisionTransport already made rather than
		// resolving again, so this hook and the dialer can never disagree.
		// 回放 proxyDecisionTransport 已做出的决策而非重新解析,
		// 使该钩子与 dialer 不可能产生分歧.
		Proxy: func(req *http.Request) (*url.URL, error) {
			decision, err := proxyDecisionFrom(req.Context())
			if err != nil {
				return nil, err
			}
			return decision.url, nil
		},
		DialContext:           ssrfSafeDialContext,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   32,
		IdleConnTimeout:       90 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
	}
}

// newOutboundClient assembles the wrapped client every outbound path uses.
// A zero timeout means no overall deadline.
// newOutboundClient 组装所有出站路径共用的包装后 client.
// timeout 为 0 表示不设总体超时.
func newOutboundClient(timeout time.Duration, tlsConfig *tls.Config) *http.Client {
	base := newOutboundTransport()
	if tlsConfig != nil {
		base.TLSClientConfig = tlsConfig
	}
	return &http.Client{
		Timeout: timeout,
		Transport: &proxyDecisionTransport{
			base:     base,
			resolver: http.ProxyFromEnvironment,
		},
	}
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

// NewSSRFSafeClient creates an HTTP client that blocks connections to
// private/loopback IPs and honours the http_proxy environment variables.
// NewSSRFSafeClient 创建一个会阻止连接私有或 loopback IP 的 HTTP client,
// 并支持 http_proxy 环境变量.
func NewSSRFSafeClient(timeout time.Duration) *http.Client {
	return newOutboundClient(timeout, nil)
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
	return NewProxyServiceWithClient(newProxyClient())
}

// NewProxyServiceWithClient creates a ProxyService with an injected HTTP client.
// NewProxyServiceWithClient 使用注入的 HTTP client 创建 ProxyService.
func NewProxyServiceWithClient(client *http.Client) *ProxyService {
	if client == nil {
		client = newProxyClient()
	}
	return &ProxyService{
		client: client,
	}
}

// newProxyClient creates the HTTP client used to fetch media.
// It skips TLS verification (upstream CDNs frequently have broken certs),
// blocks private IPs, and honours http_proxy.
//
// No Client.Timeout: that deadline covers reading the response body, which
// would cut off a large segment on a slow link. Per-path bounds replace it —
// FetchM3U8 applies its own context deadline, and ProxySegment wraps the body
// in an idle-timeout reader.
//
// newProxyClient 创建用于拉取媒体的 HTTP client.
// 它会跳过 TLS 校验 (上游 CDN 证书经常有问题), 阻止私有 IP, 并支持 http_proxy.
//
// 不设 Client.Timeout: 该超时涵盖读取 response body, 会在慢速链路上截断大分片.
// 改为按路径分别限制 — FetchM3U8 自带 context 超时,
// ProxySegment 则用空闲超时 reader 包装 body.
func newProxyClient() *http.Client {
	return newOutboundClient(0, &tls.Config{InsecureSkipVerify: true})
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
	// The shared client carries no Client.Timeout, so bound this request here.
	// Without it a trickling upstream could hold a goroutine indefinitely.
	// 共享 client 不设 Client.Timeout, 故在此限制本次请求.
	// 否则缓慢滴送数据的上游可能无限期占用一个 goroutine.
	ctx, cancel := context.WithTimeout(ctx, m3u8FetchTimeout)
	defer cancel()

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

	// Limit proxied segment/key bodies to 512MB to cap memory and bandwidth
	// abuse, and abort the transfer if upstream goes silent. The byte cap alone
	// bounds size but not time.
	// 将代理分片或密钥响应限制为 512MB, 限制内存和带宽滥用;
	// 同时在上游静默时中断传输. 仅限制字节数无法限制时间.
	body := newIdleTimeoutReader(resp.Body, segmentIdleTimeout)
	defer func() { _ = body.Close() }()
	if _, err := io.Copy(w, io.LimitReader(body, 512<<20)); err != nil {
		logrus.WithError(err).WithField("url", targetURL).Error("proxy segment copy failed")
	}
}
