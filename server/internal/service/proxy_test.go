package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestSSRFSafeDialContextBlocksPrivateAddress(t *testing.T) {
	_, err := ssrfSafeDialContext(context.Background(), "tcp", net.JoinHostPort("127.0.0.1", "80"))
	if err == nil {
		t.Fatal("expected private address to be blocked")
	}
}

func TestSSRFSafeDialContextRejectsInvalidAddressAndLookupFailure(t *testing.T) {
	if _, err := ssrfSafeDialContext(context.Background(), "tcp", "not-a-host-port"); err == nil {
		t.Fatal("expected invalid address error")
	}

	oldLookup := lookupIPAddr
	lookupIPAddr = func(ctx context.Context, host string) ([]net.IPAddr, error) {
		return nil, fmt.Errorf("lookup failed")
	}
	t.Cleanup(func() { lookupIPAddr = oldLookup })

	if _, err := ssrfSafeDialContext(context.Background(), "tcp", net.JoinHostPort("example.com", "80")); err == nil {
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

			_, err := ssrfSafeDialContext(context.Background(), "tcp", net.JoinHostPort("blocked.example", "80"))
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

	_, err := ssrfSafeDialContext(context.Background(), "tcp", net.JoinHostPort("empty.example", "80"))
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
