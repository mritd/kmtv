package vodsource

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mritd/kmtv/internal/errs"
)

func TestBuildSearchURL(t *testing.T) {
	tests := []struct {
		name   string
		apiURL string
		query  string
		page   int
		want   string
	}{
		{
			name:   "basic URL",
			apiURL: "https://api.example.com/api.php/provide/vod",
			query:  "test",
			page:   1,
			want:   "https://api.example.com/api.php/provide/vod?ac=videolist&wd=test&pg=1",
		},
		{
			name:   "URL with existing query params",
			apiURL: "https://api.example.com/api.php?key=val",
			query:  "test",
			page:   2,
			want:   "https://api.example.com/api.php?key=val&ac=videolist&wd=test&pg=2",
		},
		{
			name:   "query with spaces",
			apiURL: "https://api.example.com/api",
			query:  "hello world",
			page:   1,
			want:   "https://api.example.com/api?ac=videolist&wd=hello+world&pg=1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := BuildSearchURL(tt.apiURL, tt.query, tt.page); got != tt.want {
				t.Fatalf("BuildSearchURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBuildDetailURL(t *testing.T) {
	tests := []struct {
		name    string
		apiURL  string
		videoID string
		want    string
	}{
		{
			name:    "basic URL",
			apiURL:  "https://api.example.com/api.php/provide/vod",
			videoID: "123",
			want:    "https://api.example.com/api.php/provide/vod?ac=videolist&ids=123",
		},
		{
			name:    "URL with existing query params",
			apiURL:  "https://api.example.com/api.php?key=val",
			videoID: "hello world",
			want:    "https://api.example.com/api.php?key=val&ac=videolist&ids=hello+world",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := BuildDetailURL(tt.apiURL, tt.videoID); got != tt.want {
				t.Fatalf("BuildDetailURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBestDescription(t *testing.T) {
	tests := []struct {
		name    string
		blurb   string
		content string
		want    string
	}{
		{name: "blurb first", blurb: "short", content: "<p>long</p>", want: "short"},
		{name: "fallback strips HTML", blurb: "", content: "<p>long</p>", want: "long"},
		{name: "empty", blurb: "  ", content: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := BestDescription(tt.blurb, tt.content); got != tt.want {
				t.Fatalf("BestDescription() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFullDescription(t *testing.T) {
	tests := []struct {
		name    string
		blurb   string
		content string
		want    string
	}{
		{name: "joins blurb and cleaned content", blurb: "short", content: "<p>long</p>", want: "short\nlong"},
		{name: "content only", blurb: "", content: "<p>long</p>", want: "long"},
		{name: "blurb only", blurb: "short", content: "", want: "short"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FullDescription(tt.blurb, tt.content); got != tt.want {
				t.Fatalf("FullDescription() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestClientFetchList(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("ac") != "videolist" {
			t.Fatalf("unexpected ac query: %q", r.URL.Query().Get("ac"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":1,"msg":"ok","list":[{"vod_id":123,"vod_name":"Movie"}]}`))
	}))
	t.Cleanup(srv.Close)

	client := NewClient(srv.Client())
	resp, body, err := client.FetchList(context.Background(), srv.URL+"?ac=videolist")
	if err != nil {
		t.Fatalf("FetchList() error = %v", err)
	}
	if len(body) == 0 {
		t.Fatal("FetchList() returned empty raw body")
	}
	if resp == nil || len(resp.List) != 1 {
		t.Fatalf("FetchList() returned %#v, want one item", resp)
	}
	if got := resp.List[0].VodName; got != "Movie" {
		t.Fatalf("VodName = %q, want Movie", got)
	}
}

func TestClientFetchList_StatusErrorIncludesRawBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream blocked", http.StatusForbidden)
	}))
	t.Cleanup(srv.Close)

	client := NewClient(srv.Client())
	resp, body, err := client.FetchList(context.Background(), srv.URL)
	if err == nil {
		t.Fatal("FetchList() error = nil, want status error")
	}
	if resp != nil {
		t.Fatalf("FetchList() response = %#v, want nil", resp)
	}
	if !errors.Is(err, errs.ErrVideoSourceBadStatus) {
		t.Fatalf("FetchList() error = %v, want ErrVideoSourceBadStatus", err)
	}
	var statusErr StatusError
	if !errors.As(err, &statusErr) || statusErr.StatusCode != http.StatusForbidden {
		t.Fatalf("FetchList() status error = %#v, want 403", err)
	}
	if len(body) == 0 {
		t.Fatal("FetchList() returned empty raw body for status error")
	}
}

func TestStatusErrorAndDefaultClient(t *testing.T) {
	statusErr := StatusError{StatusCode: http.StatusTeapot}
	if got := statusErr.Error(); got != "video source returned bad status 418" {
		t.Fatalf("StatusError() = %q, want teapot status", got)
	}
	if !errors.Is(statusErr, errs.ErrVideoSourceBadStatus) {
		t.Fatalf("StatusError should unwrap to ErrVideoSourceBadStatus")
	}
	if got := NewClient(nil).httpClient; got != http.DefaultClient {
		t.Fatalf("nil NewClient should use http.DefaultClient")
	}
}

func TestClientFetchList_DecodeErrorIncludesRawBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("暂不支持搜索"))
	}))
	t.Cleanup(srv.Close)

	client := NewClient(srv.Client())
	resp, body, err := client.FetchList(context.Background(), srv.URL)
	if err == nil {
		t.Fatal("FetchList() error = nil, want decode error")
	}
	if resp != nil {
		t.Fatalf("FetchList() response = %#v, want nil", resp)
	}
	if !errors.Is(err, errs.ErrVideoSourceDecode) {
		t.Fatalf("FetchList() error = %v, want ErrVideoSourceDecode", err)
	}
	if string(body) != "暂不支持搜索" {
		t.Fatalf("FetchList() body = %q, want unsupported-search text", string(body))
	}
}
