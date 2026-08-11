package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/model"
)

func TestRewriteM3U8(t *testing.T) {
	content := `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-KEY:METHOD=AES-128,URI="key.php?id=123"
#EXTINF:10.0,
segment001.ts
#EXTINF:10.0,
https://cdn.example.com/segment002.ts
#EXTINF:10.0,
/path/to/segment003.ts
`

	baseURL := "https://stream.example.com/live/"
	proxyBase := "http://localhost:8080"
	sourceKey := "test-source"
	signer := func(kind, rawURL, sourceKey string) (string, error) {
		return "token-" + kind, nil
	}

	result, err := RewriteM3U8(content, baseURL, proxyBase, sourceKey, signer)
	if err != nil {
		t.Fatalf("RewriteM3U8 error: %v", err)
	}

	// Verify key URI is rewritten
	if !strings.Contains(result, `URI="http://localhost:8080/api/v1/proxy/key?url=`) {
		t.Error("expected key URI to be rewritten to proxy")
	}

	// Verify the key URL is resolved against base URL
	if !strings.Contains(result, "stream.example.com") {
		t.Error("expected relative key URL to be resolved against base URL")
	}

	// Verify relative segment URL is resolved and rewritten
	if !strings.Contains(result, "http://localhost:8080/api/v1/proxy/segment?url=") {
		t.Error("expected segment URLs to be rewritten to proxy")
	}

	// Verify absolute segment URL is preserved in the encoded form
	if !strings.Contains(result, "cdn.example.com") {
		t.Error("expected absolute segment URL to be preserved")
	}

	// Verify comments are preserved
	if !strings.Contains(result, "#EXTM3U") {
		t.Error("expected #EXTM3U header to be preserved")
	}
	if !strings.Contains(result, "#EXT-X-VERSION:3") {
		t.Error("expected version tag to be preserved")
	}
	if !strings.Contains(result, "#EXTINF:10.0,") {
		t.Error("expected EXTINF tags to be preserved")
	}

	// Verify source key is included in rewritten URLs
	if !strings.Contains(result, "source=test-source") {
		t.Error("expected source key in rewritten URLs")
	}
	if !strings.Contains(result, "&mt=token-key") || !strings.Contains(result, "&mt=token-segment") {
		t.Fatalf("expected media tokens in rewritten URLs: %s", result)
	}
}

func TestRewriteM3U8_MasterPlaylist(t *testing.T) {
	content := `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2560000
high/index.m3u8
`
	signer := func(kind, rawURL, sourceKey string) (string, error) {
		return "token-" + kind, nil
	}
	got, err := RewriteM3U8(content, "https://stream.example.com/master.m3u8", "https://proxy.example", "src", signer)
	if err != nil {
		t.Fatalf("RewriteM3U8 error: %v", err)
	}
	if !strings.Contains(got, "/api/v1/proxy/m3u8?url=") {
		t.Fatalf("expected sub-playlist URLs to use m3u8 proxy: %s", got)
	}
	if !strings.Contains(got, "low%2Findex.m3u8") || !strings.Contains(got, "high%2Findex.m3u8") {
		t.Fatalf("expected relative sub-playlists to be encoded: %s", got)
	}
	if !strings.Contains(got, "&mt=token-m3u8") {
		t.Fatalf("expected media token in sub-playlists: %s", got)
	}
}

func TestRewriteM3U8SignerErrors(t *testing.T) {
	content := `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:10,
segment001.ts
`
	if _, err := RewriteM3U8(content, "https://stream.example.com/live/index.m3u8", "https://proxy.example", "src", nil); err == nil {
		t.Fatal("expected nil signer error")
	}
	signer := func(kind, rawURL, sourceKey string) (string, error) {
		return "", errors.New("sign failed")
	}
	if _, err := RewriteM3U8(content, "https://stream.example.com/live/index.m3u8", "https://proxy.example", "src", signer); err == nil {
		t.Fatal("expected signer error")
	}
}

// directDialContext stamps a context as an already-resolved "direct" request,
// i.e. what proxyDecisionTransport would produce for a non-proxied call. The
// tests below call ssrfSafeDialContext directly to exercise its DNS/IP-block
// logic, and must pass a stamped context so they hit that logic instead of
// the (separately tested) fail-closed path for unstamped requests.
//
// directDialContext 将 context 标记为已解析的 "直连" 请求, 即
// proxyDecisionTransport 对非代理请求会产出的结果. 下面这些测试直接调用
// ssrfSafeDialContext 以验证其 DNS/IP 拦截逻辑, 因此必须传入已标记的 context,
// 否则会命中 (另有测试覆盖的) 未标记请求快速失败路径, 而非该逻辑本身.
func directDialContext() context.Context {
	return context.WithValue(context.Background(), proxyDecisionKey{}, proxyDecision{})
}

func TestSSRFSafeDialContextBlocksPrivateAddress(t *testing.T) {
	_, err := ssrfSafeDialContext(directDialContext(), "tcp", net.JoinHostPort("127.0.0.1", "80"))
	if err == nil {
		t.Fatal("expected private address to be blocked")
	}
}

func TestSSRFSafeDialContextRejectsInvalidAddressAndLookupFailure(t *testing.T) {
	if _, err := ssrfSafeDialContext(directDialContext(), "tcp", "not-a-host-port"); err == nil {
		t.Fatal("expected invalid address error")
	}

	oldLookup := lookupIPAddr
	lookupIPAddr = func(ctx context.Context, host string) ([]net.IPAddr, error) {
		return nil, fmt.Errorf("lookup failed")
	}
	t.Cleanup(func() { lookupIPAddr = oldLookup })

	if _, err := ssrfSafeDialContext(directDialContext(), "tcp", net.JoinHostPort("example.com", "80")); err == nil {
		t.Fatal("expected lookup failure")
	}
}

func TestSSRFSafeDialContextBlocksSpecialAddresses(t *testing.T) {
	tests := []struct {
		name string
		ip   string
	}{
		{name: "unspecified", ip: "0.0.0.0"},
		{name: "multicast", ip: "224.0.0.1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			oldLookup := lookupIPAddr
			lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
				return []net.IPAddr{{IP: net.ParseIP(tt.ip)}}, nil
			}
			t.Cleanup(func() { lookupIPAddr = oldLookup })

			_, err := ssrfSafeDialContext(directDialContext(), "tcp", net.JoinHostPort("blocked.example", "80"))
			if err == nil {
				t.Fatalf("expected %s to be blocked", tt.ip)
			}
		})
	}
}

func TestSSRFSafeDialContextRejectsEmptyDNSResult(t *testing.T) {
	oldLookup := lookupIPAddr
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return nil, nil
	}
	t.Cleanup(func() { lookupIPAddr = oldLookup })

	_, err := ssrfSafeDialContext(directDialContext(), "tcp", net.JoinHostPort("empty.example", "80"))
	if err == nil {
		t.Fatal("expected empty DNS result to be rejected")
	}
}

func TestProxyServiceConstructorsWithNilClient(t *testing.T) {
	if NewProxyServiceWithClient(nil).client == nil {
		t.Fatal("expected fallback proxy client")
	}
	if NewProxyService().client == nil {
		t.Fatal("expected default proxy client")
	}
}

func TestProbeLines_StopsWhenContextCanceled(t *testing.T) {
	ps := NewProxyService()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	groups := [][]model.Episode{{
		{Name: "ep1", URL: "https://example.com/video.m3u8"},
	}}

	start := time.Now()
	got := ps.ProbeLines(ctx, groups)

	if got != nil {
		t.Fatalf("ProbeLines() = %#v, want nil when context is canceled", got)
	}
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("ProbeLines() took %s after context cancellation, want under 100ms", elapsed)
	}
}

func TestProbeLines_FiltersUnavailableLines(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			w.WriteHeader(http.StatusPartialContent)
		case "/html.m3u8":
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()

	ps := NewProxyService()
	ps.client = upstream.Client()
	groups := [][]model.Episode{
		{{Name: "ok", URL: upstream.URL + "/ok.m3u8"}},
		{{Name: "html", URL: upstream.URL + "/html.m3u8"}},
		{{Name: "missing", URL: upstream.URL + "/missing.m3u8"}},
	}

	got := ps.ProbeLines(context.Background(), groups)
	if len(got) != 1 {
		t.Fatalf("len(ProbeLines()) = %d, want 1", len(got))
	}
	if got[0][0].Name != "ok" {
		t.Fatalf("unexpected surviving line: %+v", got)
	}
}

func TestProbeLines_CacheIsScopedToConcreteURL(t *testing.T) {
	probeCache.Lock()
	probeCache.m = make(map[string]probeCacheEntry)
	probeCache.Unlock()
	t.Cleanup(func() {
		probeCache.Lock()
		probeCache.m = make(map[string]probeCacheEntry)
		probeCache.Unlock()
	})

	var okRequests atomic.Int32
	var missingRequests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok.m3u8":
			okRequests.Add(1)
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			w.WriteHeader(http.StatusPartialContent)
		case "/missing.m3u8":
			missingRequests.Add(1)
			w.WriteHeader(http.StatusNotFound)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()

	ps := NewProxyService()
	ps.client = upstream.Client()

	alive := ps.ProbeLines(context.Background(), [][]model.Episode{{
		{Name: "ok", URL: upstream.URL + "/ok.m3u8"},
	}})
	if len(alive) != 1 {
		t.Fatalf("len(ProbeLines(ok)) = %d, want 1", len(alive))
	}

	dead := ps.ProbeLines(context.Background(), [][]model.Episode{{
		{Name: "missing", URL: upstream.URL + "/missing.m3u8"},
	}})
	if len(dead) != 0 {
		t.Fatalf("len(ProbeLines(missing)) = %d, want 0", len(dead))
	}
	if okRequests.Load() != 1 {
		t.Fatalf("ok requests = %d, want 1", okRequests.Load())
	}
	if missingRequests.Load() != 1 {
		t.Fatalf("missing requests = %d, want 1", missingRequests.Load())
	}
}

func TestProbeLinesHandlesEmptyGroupsInvalidURLsAndClientErrors(t *testing.T) {
	ps := NewProxyServiceWithClient(&http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("network down")
	})})

	groups := [][]model.Episode{
		{},
		{{Name: "invalid", URL: "://bad"}},
		{{Name: "client-error", URL: "https://cdn.example/video.m3u8"}},
	}
	if got := ps.ProbeLines(context.Background(), groups); got != nil {
		t.Fatalf("ProbeLines() = %#v, want nil for empty group, invalid URL, and client error", got)
	}
}

func TestFetchM3U8_RewritesManifest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("User-Agent"); got != "Browser UA" {
			t.Fatalf("User-Agent = %q, want Browser UA", got)
		}
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		_, _ = w.Write([]byte(`#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:10,
segment001.ts
`))
	}))
	defer upstream.Close()

	ps := NewProxyService()
	ps.client = upstream.Client()
	headers := http.Header{"User-Agent": []string{"Browser UA"}}
	signer := func(kind, rawURL, sourceKey string) (string, error) {
		return "token-" + kind, nil
	}
	got, err := ps.FetchM3U8(context.Background(), upstream.URL+"/live/index.m3u8", "https://proxy.example", "src-a", headers, signer)
	if err != nil {
		t.Fatalf("FetchM3U8 error: %v", err)
	}
	if !strings.Contains(got, "https://proxy.example/api/v1/proxy/key?url=") {
		t.Fatalf("expected key proxy URL in manifest:\n%s", got)
	}
	if !strings.Contains(got, "https://proxy.example/api/v1/proxy/segment?url=") {
		t.Fatalf("expected segment proxy URL in manifest:\n%s", got)
	}
	if !strings.Contains(got, "source=src-a") {
		t.Fatalf("expected source key in manifest:\n%s", got)
	}
	if !strings.Contains(got, "&mt=token-key") || !strings.Contains(got, "&mt=token-segment") {
		t.Fatalf("expected media tokens in manifest:\n%s", got)
	}
}

func TestFetchM3U8_RejectsHTML(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html>not media</html>`))
	}))
	defer upstream.Close()

	ps := NewProxyService()
	ps.client = upstream.Client()
	if _, err := ps.FetchM3U8(context.Background(), upstream.URL+"/watch", "https://proxy.example", "src-a", nil, nil); err == nil {
		t.Fatal("expected invalid M3U8 error")
	}
}

func TestFetchM3U8_ReturnsStatusError(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("forbidden"))
	}))
	defer upstream.Close()

	ps := NewProxyServiceWithClient(upstream.Client())
	if _, err := ps.FetchM3U8(context.Background(), upstream.URL+"/index.m3u8", "https://proxy.example", "src-a", nil, nil); err == nil {
		t.Fatal("expected non-200 status error")
	}
}

func TestFetchM3U8ReportsRequestFetchAndReadErrors(t *testing.T) {
	ps := NewProxyServiceWithClient(http.DefaultClient)
	if _, err := ps.FetchM3U8(context.Background(), "://bad", "https://proxy.example", "src-a", nil, nil); err == nil {
		t.Fatal("expected invalid request URL error")
	}

	ps = NewProxyServiceWithClient(&http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("dial failed")
	})})
	if _, err := ps.FetchM3U8(context.Background(), "https://cdn.example/index.m3u8", "https://proxy.example", "src-a", nil, nil); err == nil {
		t.Fatal("expected fetch error")
	}

	ps = NewProxyServiceWithClient(&http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       errReadCloser{},
		}, nil
	})})
	if _, err := ps.FetchM3U8(context.Background(), "https://cdn.example/index.m3u8", "https://proxy.example", "src-a", nil, nil); err == nil {
		t.Fatal("expected read body error")
	}
}

func TestProxySegment_ForwardsStatusHeadersAndBody(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); got != "video/mp2t" {
			t.Fatalf("Accept = %q, want video/mp2t", got)
		}
		w.Header().Set("Content-Type", "video/mp2t")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("test-segment"))
	}))
	defer upstream.Close()

	ps := NewProxyService()
	ps.client = upstream.Client()
	rec := httptest.NewRecorder()
	headers := http.Header{"Accept": []string{"video/mp2t"}}

	ps.ProxySegment(context.Background(), rec, upstream.URL+"/seg.ts", headers)

	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "video/mp2t" {
		t.Fatalf("Content-Type = %q, want video/mp2t", rec.Header().Get("Content-Type"))
	}
	if rec.Body.String() != "test-segment" {
		t.Fatalf("body = %q, want test-segment", rec.Body.String())
	}
}

func TestProxySegment_FiltersUnsafeUpstreamHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp2t")
		w.Header().Set("Content-Range", "bytes 0-3/4")
		w.Header().Set("Content-Disposition", `attachment; filename="seg.ts"`)
		w.Header().Set("Set-Cookie", "session=attacker")
		w.Header().Set("Connection", "upgrade")
		w.Header().Set("Upgrade", "websocket")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("test"))
	}))
	defer upstream.Close()

	ps := NewProxyServiceWithClient(upstream.Client())
	rec := httptest.NewRecorder()

	ps.ProxySegment(context.Background(), rec, upstream.URL+"/seg.ts", nil)

	if got := rec.Header().Get("Content-Type"); got != "video/mp2t" {
		t.Fatalf("Content-Type = %q, want video/mp2t", got)
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 0-3/4" {
		t.Fatalf("Content-Range = %q, want upstream range", got)
	}
	if got := rec.Header().Get("Set-Cookie"); got != "" {
		t.Fatalf("Set-Cookie was forwarded: %q", got)
	}
	if got := rec.Header().Get("Content-Disposition"); got != "" {
		t.Fatalf("Content-Disposition was forwarded: %q", got)
	}
	if got := rec.Header().Get("Connection"); got != "" {
		t.Fatalf("Connection was forwarded: %q", got)
	}
	if got := rec.Header().Get("Upgrade"); got != "" {
		t.Fatalf("Upgrade was forwarded: %q", got)
	}
}

func TestProxySegment_InvalidRequest(t *testing.T) {
	ps := NewProxyService()
	rec := httptest.NewRecorder()
	ps.ProxySegment(context.Background(), rec, "://bad", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestProxySegmentReportsUpstreamError(t *testing.T) {
	ps := NewProxyServiceWithClient(&http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("upstream unavailable")
	})})
	rec := httptest.NewRecorder()

	ps.ProxySegment(context.Background(), rec, "https://cdn.example/seg.ts", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

type errReadCloser struct{}

func (errReadCloser) Read([]byte) (int, error) {
	return 0, errors.New("read failed")
}

func (errReadCloser) Close() error {
	return nil
}

// Helper: build a wrapped client whose proxy answer is fully controlled.
//
// 测试 helper: 构造一个包装后的 client, 使测试可以完全控制代理解析结果.
func testOutboundClient(resolver func(*http.Request) (*url.URL, error)) *http.Client {
	return &http.Client{Transport: &proxyDecisionTransport{
		base:     newOutboundTransport(),
		resolver: resolver,
	}}
}

// A request that legitimately traverses the proxy must be dialable even though
// forward proxies normally sit on loopback or private addresses.
//
// 合法的代理请求必须允许拨号到 loopback 或私有地址上的正向代理. 该例确保 SSRF
// 防护只放行运维配置的代理连接, 不会误伤代理部署.
func TestProxyDecisionAllowsDialingTheProxy(t *testing.T) {
	var proxied int64
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&proxied, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer proxy.Close()

	proxyURL, err := url.Parse(proxy.URL)
	if err != nil {
		t.Fatalf("parse proxy URL: %v", err)
	}

	client := testOutboundClient(func(*http.Request) (*url.URL, error) { return proxyURL, nil })
	resp, err := client.Get("http://media.invalid/index.m3u8")
	if err != nil {
		t.Fatalf("proxied request failed: %v", err)
	}
	_ = resp.Body.Close()
	if atomic.LoadInt64(&proxied) != 1 {
		t.Fatalf("proxy hit count = %d, want 1", atomic.LoadInt64(&proxied))
	}
}

// The resolver must run exactly once per request. net/http calls
// Transport.Proxy during connect, so a second evaluation there would be a
// separate decision the dialer could not see.
//
// 每个请求只能执行一次 resolver. net/http 会在建连时调用 Transport.Proxy,
// 如果此处再次解析, dialer 将无法得知第二次产生的独立决策.
func TestProxyResolverCalledExactlyOnce(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer proxy.Close()
	proxyURL, err := url.Parse(proxy.URL)
	if err != nil {
		t.Fatalf("parse proxy URL: %v", err)
	}

	var calls int64
	client := testOutboundClient(func(*http.Request) (*url.URL, error) {
		atomic.AddInt64(&calls, 1)
		return proxyURL, nil
	})
	resp, err := client.Get("http://media.invalid/index.m3u8")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	_ = resp.Body.Close()

	if n := atomic.LoadInt64(&calls); n != 1 {
		t.Errorf("resolver called %d times, want exactly 1 (a second call is a separate decision)", n)
	}
}

// Regression for the loopback-bypass hole: when the attacker's TARGET equals
// the proxy address, Go bypasses the proxy and connects directly. The dial
// address is then byte-identical to the proxy's, so an address allowlist would
// wave it through. The context stamp must still classify it as direct.
//
// 这是 loopback 绕过漏洞的回归测试: 当攻击目标等于代理地址时, Go 会绕过代理并直连.
// 此时拨号地址与代理地址完全相同, 基于地址的 allowlist 会错误放行. context stamp
// 必须仍把该连接识别为直连并执行 SSRF 检查.
func TestProxyDecisionBlocksTargetEqualToProxyAddress(t *testing.T) {
	victim := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer victim.Close()

	victimURL, err := url.Parse(victim.URL)
	if err != nil {
		t.Fatalf("parse victim URL: %v", err)
	}

	// Mirrors ProxyFromEnvironment: nil (direct) for a loopback target.
	//
	// 模拟 ProxyFromEnvironment 对 loopback 目标返回 nil, 即选择直连.
	client := testOutboundClient(func(req *http.Request) (*url.URL, error) {
		if host, _, splitErr := net.SplitHostPort(req.URL.Host); splitErr == nil {
			if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
				return nil, nil
			}
		}
		return victimURL, nil
	})

	_, err = client.Get(victim.URL + "/internal-admin")
	if err == nil {
		t.Fatal("direct dial to a loopback target succeeded; SSRF guard was bypassed")
	}
	if !strings.Contains(err.Error(), "blocked") {
		t.Fatalf("error = %v, want a blocked-address error", err)
	}
}

// A resolver whose answer changes between calls must not be able to leave the
// dialer trusting a stale "via proxy" decision. Two loopback servers let us
// see whether the origin was reached directly with the guard skipped.
//
// resolver 在多次调用间改变答案时, dialer 不能继续信任已经过期的 "走代理" 决策.
// 两个 loopback server 用于检测 origin 是否在跳过 SSRF 防护后被直接访问.
func TestProxyStampCannotDrift(t *testing.T) {
	var reachedDirectly int64
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A proxied request arrives with an absolute URI; origin-form means
		// the transport connected to us directly.
		//
		// 代理请求使用 absolute URI; 收到 origin-form 表示 transport 实际进行了直连.
		if !r.URL.IsAbs() {
			atomic.AddInt64(&reachedDirectly, 1)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer proxy.Close()

	proxyURL, err := url.Parse(proxy.URL)
	if err != nil {
		t.Fatalf("parse proxy URL: %v", err)
	}

	var calls int64
	client := testOutboundClient(func(*http.Request) (*url.URL, error) {
		if atomic.AddInt64(&calls, 1) == 1 {
			return proxyURL, nil // the stamp says proxy
		}
		return nil, nil // a second evaluation would say direct
	})

	resp, err := client.Get(origin.URL + "/internal-admin")
	if err != nil {
		t.Fatalf("proxied request failed: %v", err)
	}
	_ = resp.Body.Close()

	if n := atomic.LoadInt64(&reachedDirectly); n != 0 {
		t.Fatalf("origin was reached directly %d time(s) — the dialer acted on a stale stamp and skipped the SSRF check", n)
	}
}

// Without the stamp there is no way to know whether an address is the proxy or
// an origin, so the dialer must refuse rather than guess.
//
// 缺少 stamp 时无法判断地址代表代理还是 origin, 因此 dialer 必须拒绝请求,
// 不能猜测后继续拨号.
func TestSSRFDialerFailsClosedWithoutProxyDecision(t *testing.T) {
	_, err := ssrfSafeDialContext(context.Background(), "tcp", "93.184.216.34:80")
	if !errors.Is(err, errUnstampedRequest) {
		t.Fatalf("error = %v, want errUnstampedRequest", err)
	}
}

// A transport used without the wrapper must fail at the Proxy hook rather than
// quietly proceeding with the guard disabled.
//
// 未经 wrapper 使用 transport 时必须在 Proxy hook 失败, 不能静默关闭 SSRF 防护后继续请求.
func TestBareOutboundTransportFailsClosed(t *testing.T) {
	client := &http.Client{Transport: newOutboundTransport()}
	if _, err := client.Get("http://media.invalid/index.m3u8"); err == nil {
		t.Fatal("bare transport succeeded; it must fail closed")
	}
}

// Covers the Proxy-hook half of fail-closed directly; the dialer's own check
// would otherwise mask a regression here.
//
// 该测试直接覆盖 fail-closed 的 Proxy hook 路径, 避免 dialer 自身的检查掩盖这里的回归.
func TestOutboundTransportProxyHookFailsClosed(t *testing.T) {
	tr := newOutboundTransport()
	req := httptest.NewRequest(http.MethodGet, "http://media.invalid/x.m3u8", nil)
	if _, err := tr.Proxy(req); !errors.Is(err, errUnstampedRequest) {
		t.Fatalf("Proxy hook error = %v, want errUnstampedRequest", err)
	}
}

// A direct (non-proxied) request keeps the full SSRF check.
//
// 直连请求必须保留完整 SSRF 检查, 不能继承代理连接的私有地址放行条件.
func TestProxyDecisionKeepsSSRFCheckOnDirectRequests(t *testing.T) {
	client := testOutboundClient(func(*http.Request) (*url.URL, error) { return nil, nil })
	if _, err := client.Get("http://127.0.0.1:9/nothing"); err == nil {
		t.Fatal("direct request to loopback succeeded; SSRF guard did not apply")
	}
}

func TestOutboundTransportPoolSettings(t *testing.T) {
	tr := newOutboundTransport()
	if tr.MaxIdleConnsPerHost != 32 {
		t.Errorf("MaxIdleConnsPerHost = %d, want 32", tr.MaxIdleConnsPerHost)
	}
	if tr.MaxIdleConns != 100 {
		t.Errorf("MaxIdleConns = %d, want 100", tr.MaxIdleConns)
	}
	if tr.ResponseHeaderTimeout != 15*time.Second {
		t.Errorf("ResponseHeaderTimeout = %v, want 15s", tr.ResponseHeaderTimeout)
	}
	if tr.IdleConnTimeout != 90*time.Second {
		t.Errorf("IdleConnTimeout = %v, want 90s", tr.IdleConnTimeout)
	}
	if tr.TLSHandshakeTimeout != 10*time.Second {
		t.Errorf("TLSHandshakeTimeout = %v, want 10s", tr.TLSHandshakeTimeout)
	}
}

// Asserts http_proxy is actually honoured. This checks the resolver field
// rather than setting environment variables, because http.ProxyFromEnvironment
// caches the environment process-wide behind a sync.Once
// (net/http/transport.go:965) — t.Setenv would silently do nothing after any
// earlier test triggered that cache. The check compares function identity,
// not mere non-nilness, so swapping in any other non-nil resolver stub is
// still caught.
//
// 该测试确保 http_proxy 确实生效. 测试检查 resolver 字段而不修改环境变量, 因为
// http.ProxyFromEnvironment 会通过 sync.Once 在进程级缓存环境
// (net/http/transport.go:965). 如果更早的测试已触发缓存, t.Setenv 将不会改变结果.
// 这里比较函数 identity 而非只检查非 nil, 因此替换成其他 resolver stub 也会被发现.
func TestOutboundClientUsesEnvironmentResolver(t *testing.T) {
	want := reflect.ValueOf(http.ProxyFromEnvironment).Pointer()
	for name, client := range map[string]*http.Client{
		"NewSSRFSafeClient": NewSSRFSafeClient(10 * time.Second),
		"newProxyClient":    newProxyClient(),
	} {
		pdt, ok := client.Transport.(*proxyDecisionTransport)
		if !ok {
			t.Errorf("%s: Transport is %T, want *proxyDecisionTransport", name, client.Transport)
			continue
		}
		if pdt.resolver == nil || reflect.ValueOf(pdt.resolver).Pointer() != want {
			t.Errorf("%s: resolver is not http.ProxyFromEnvironment; http_proxy would be ignored", name)
		}
	}
}

func TestNewProxyClientHasNoOverallTimeout(t *testing.T) {
	if c := newProxyClient(); c.Timeout != 0 {
		t.Errorf("Client.Timeout = %v, want 0 (it would truncate slow segment bodies)", c.Timeout)
	}
}

func TestTimeoutConstants(t *testing.T) {
	// 60s bounds a manifest request's TOTAL lifetime; the payload is capped at
	// 10 MB so this is generous. Failing to fetch the manifest fails playback
	// outright, hence the conservative value.
	//
	// 60s 限制 manifest 请求的总时长. 响应体已限制为 10 MB, 因此该值留有充足余量;
	// manifest 拉取失败会直接导致播放失败, 所以不能使用更激进的超时值.
	if m3u8FetchTimeout != 60*time.Second {
		t.Errorf("m3u8FetchTimeout = %v, want 60s", m3u8FetchTimeout)
	}
	// 30s bounds SILENCE on the segment path, not total duration: a slow link
	// keeps resetting the timer, only a stalled peer trips it.
	//
	// 30s 限制分片路径的静默时长, 而非总传输时长. 慢速链路只要持续收到字节就会重置
	// timer, 只有停止传输的对端才会触发超时.
	if segmentIdleTimeout != 30*time.Second {
		t.Errorf("segmentIdleTimeout = %v, want 30s", segmentIdleTimeout)
	}
}

// The case the old 30s Client.Timeout used to break: a body that streams
// slowly but continuously must complete.
//
// Both numbers are load-bearing. Total transfer (~600ms) must exceed the idle
// window (200ms), or an implementation that wrongly capped TOTAL duration
// would pass too. Meanwhile the 40ms chunk interval stays well under the
// watchdog's 100ms tick, so a healthy body cannot trip it.
//
// 该用例覆盖旧 30s Client.Timeout 会中断的场景: body 虽慢但持续传输时必须完成.
//
// 两组时间都直接决定测试有效性. 总传输约 600ms, 必须超过 200ms idle window,
// 否则错误限制总时长的实现也会通过. 40ms chunk 间隔则明显短于 watchdog 的
// 100ms tick, 保证健康传输不会误触发 idle timeout.
func TestProxySegmentCompletesSlowContinuousBody(t *testing.T) {
	original := segmentIdleTimeout
	segmentIdleTimeout = 200 * time.Millisecond
	defer func() { segmentIdleTimeout = original }()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("ResponseWriter is not a Flusher")
			return
		}
		for i := 0; i < 15; i++ {
			_, _ = w.Write([]byte("chunk"))
			flusher.Flush()
			time.Sleep(40 * time.Millisecond)
		}
	}))
	defer upstream.Close()

	ps := NewProxyServiceWithClient(upstream.Client())
	rec := httptest.NewRecorder()
	ps.ProxySegment(context.Background(), rec, upstream.URL+"/seg.ts", http.Header{})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != strings.Repeat("chunk", 15) {
		t.Fatalf("body = %q, want 15 chunks — a total-duration cap would truncate it", body)
	}
}

// The deadline must be observed on the CLIENT side. A server handler cannot see
// it: an incoming request's context does not inherit the caller's deadline, so
// asserting r.Context().Deadline() would silently always be false.
//
// deadline 必须从 client 侧观察. server handler 收到的 request context 不会继承
// 调用方 deadline, 因此在 handler 中断言 r.Context().Deadline() 会始终得到 false,
// 无法证明 FetchM3U8 设置了 deadline.
func TestFetchM3U8AppliesItsOwnDeadline(t *testing.T) {
	original := m3u8FetchTimeout
	m3u8FetchTimeout = 50 * time.Millisecond
	defer func() { m3u8FetchTimeout = original }()

	// Blocked on a channel rather than time.Sleep: httptest.Server.Close waits
	// for handlers to return, so a sleeping handler would add its full duration
	// to the test even though FetchM3U8 gave up long before.
	//
	// 使用 channel 阻塞而非 time.Sleep: httptest.Server.Close 会等待 handler 返回.
	// 如果 handler 直接 sleep, 即使 FetchM3U8 已提前放弃, 测试仍会额外等待完整 sleep 时长.
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		_, _ = w.Write([]byte("#EXTM3U\n"))
	}))
	// Ordering matters: release the handler before closing the server.
	//
	// defer 按后进先出执行, 因此先注册 server.Close, 再注册 close(release),
	// 保证实际清理时先解除 handler 阻塞, 再等待 server 关闭.
	defer upstream.Close()
	defer close(release)

	ps := NewProxyServiceWithClient(upstream.Client())
	signer := func(kind, rawURL, sourceKey string) (string, error) { return "tok", nil }

	// Caller passes a context with no deadline of its own.
	//
	// 调用方传入不含 deadline 的 context, 以证明 deadline 由 FetchM3U8 自己添加.
	start := time.Now()
	_, err := ps.FetchM3U8(context.Background(), upstream.URL+"/i.m3u8", "http://localhost:8080", "src", http.Header{}, signer)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected a deadline error, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want context.DeadlineExceeded", err)
	}
	if elapsed > time.Second {
		t.Errorf("returned after %v; FetchM3U8 did not apply its own deadline", elapsed)
	}
}

// The stalled-body case on the real segment path, not just on the reader.
//
// 该测试在真实分片代理路径验证 body 停滞, 而不只测试 idleTimeoutReader 单元.
func TestProxySegmentAbortsSilentUpstream(t *testing.T) {
	original := segmentIdleTimeout
	segmentIdleTimeout = 100 * time.Millisecond
	defer func() { segmentIdleTimeout = original }()

	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("ResponseWriter is not a Flusher")
			return
		}
		_, _ = w.Write([]byte("head"))
		flusher.Flush()
		<-release // then go silent
	}))
	// Ordering matters: release the handler before closing the server.
	//
	// defer 按后进先出执行, 因此先注册 server.Close, 再注册 close(release),
	// 保证实际清理时先解除 handler 阻塞, 再等待 server 关闭.
	defer upstream.Close()
	defer close(release)

	ps := NewProxyServiceWithClient(upstream.Client())
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		ps.ProxySegment(context.Background(), rec, upstream.URL+"/seg.ts", http.Header{})
		close(done)
	}()

	select {
	case <-done:
		if body := rec.Body.String(); body != "head" {
			t.Errorf("body = %q, want the partial %q written before the stall", body, "head")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ProxySegment never returned; the idle timeout did not fire")
	}
}
