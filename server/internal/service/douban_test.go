package service

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/mritd/kmtv/internal/store"
)

func newServiceTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("create test store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestDoubanRewriteCoverURL(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))

	tests := []struct {
		name   string
		rawURL string
		mode   string
		want   string
	}{
		{
			name:   "server mode normalizes host and routes through image proxy",
			rawURL: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg",
			mode:   "server",
			want:   "/api/v1/proxy/image?url=https%3A%2F%2Fimg2.doubanio.com%2Fview%2Fphoto%2Fs_ratio_poster%2Fpublic%2Fp1.jpg",
		},
		{
			name:   "direct mode only normalizes host",
			rawURL: "https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2.jpg",
			mode:   "direct",
			want:   "https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2.jpg",
		},
		{
			name:   "tencent mode uses configured mirror",
			rawURL: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p3.jpg",
			mode:   "tencent",
			want:   "https://img.doubanio.cmliussss.net/view/photo/s_ratio_poster/public/p3.jpg",
		},
		{
			name:   "ali mode uses configured mirror",
			rawURL: "https://img4.doubanio.com/view/photo/s_ratio_poster/public/p4.jpg",
			mode:   "ali",
			want:   "https://img.doubanio.cmliussss.com/view/photo/s_ratio_poster/public/p4.jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ds.rewriteCoverURL(tt.rawURL, tt.mode); got != tt.want {
				t.Fatalf("rewriteCoverURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestExtractYearFromSubtitle(t *testing.T) {
	tests := []struct {
		subtitle string
		want     string
	}{
		{subtitle: "2024 / 中国大陆 / 剧情", want: "2024"},
		{subtitle: "美国 / 1999 / 科幻", want: "1999"},
		{subtitle: "no year here", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.subtitle, func(t *testing.T) {
			if got := extractYearFromSubtitle(tt.subtitle); got != tt.want {
				t.Fatalf("extractYearFromSubtitle() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDoubanCategoriesContainStableKeys(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	categories := ds.GetCategories()

	wantKeys := map[string]bool{"movie": false, "tv": false, "anime": false, "show": false}
	for _, category := range categories {
		if _, ok := wantKeys[category.Key]; ok {
			wantKeys[category.Key] = true
		}
	}

	for key, found := range wantKeys {
		if !found {
			t.Fatalf("GetCategories() missing key %q", key)
		}
	}
}

func TestDoubanGetList(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "movie.douban.com" || req.URL.Path != "/j/search_subjects" {
			t.Fatalf("unexpected request URL: %s", req.URL.String())
		}
		if req.URL.Query().Get("type") != "movie" || req.URL.Query().Get("tag") != "热门" {
			t.Fatalf("unexpected query: %s", req.URL.RawQuery)
		}
		return stringResponse(http.StatusOK, `{
			"subjects": [
				{"id": "1", "title": "Movie One", "cover": "https://img.example/1.jpg", "rate": "8.8"}
			]
		}`), nil
	})}

	items, err := ds.GetList(context.Background(), "热门", "movie", 0, 20)
	if err != nil {
		t.Fatalf("GetList error: %v", err)
	}
	if len(items) != 1 || items[0].Title != "Movie One" || items[0].Rate != "8.8" {
		t.Fatalf("unexpected items: %+v", items)
	}
}

func TestDoubanGetRecentHot(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "m.douban.com" || req.URL.Path != "/rexxar/api/v2/subject/recent_hot/movie" {
			t.Fatalf("unexpected request URL: %s", req.URL.String())
		}
		if req.Header.Get("Origin") != "https://movie.douban.com" {
			t.Fatalf("Origin header = %q", req.Header.Get("Origin"))
		}
		return stringResponse(http.StatusOK, `{
			"items": [{
				"id": "2",
				"title": "Hot Movie",
				"card_subtitle": "2026 / 中国大陆 / 剧情",
				"pic": {"normal": "", "large": "https://img.example/hot.jpg"},
				"rating": {"value": 7.6}
			}]
		}`), nil
	})}

	items, err := ds.GetRecentHot(context.Background(), "movie", "热门", "全部", 0, 12)
	if err != nil {
		t.Fatalf("GetRecentHot error: %v", err)
	}
	if len(items) != 1 || items[0].Title != "Hot Movie" || items[0].Rate != "7.6" || items[0].Year != "2026" {
		t.Fatalf("unexpected items: %+v", items)
	}
}

func TestDoubanGetRecommendByFilters(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "m.douban.com" || req.URL.Path != "/rexxar/api/v2/movie/recommend" {
			t.Fatalf("unexpected request URL: %s", req.URL.String())
		}
		if req.URL.Query().Get("tags") != "悬疑,中国大陆" {
			t.Fatalf("tags = %q", req.URL.Query().Get("tags"))
		}
		return stringResponse(http.StatusOK, `{
			"items": [
				{
					"id": "3",
					"title": "Recommend Movie",
					"type": "movie",
					"year": "2025",
					"pic": {"normal": "https://img.example/recommend.jpg"},
					"rating": {"value": 9.1}
				},
				{"id": "", "title": "Broken", "type": "movie"}
			]
		}`), nil
	})}

	items, err := ds.GetRecommendByFilters(context.Background(), "movie", "悬疑", "", "中国大陆", 0, 12)
	if err != nil {
		t.Fatalf("GetRecommendByFilters error: %v", err)
	}
	if len(items) != 1 || items[0].Title != "Recommend Movie" || items[0].Year != "2025" || items[0].Rate != "9.1" {
		t.Fatalf("unexpected items: %+v", items)
	}
}

func TestDoubanGetSubjectDescription(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "m.douban.com" || req.URL.Path != "/rexxar/api/v2/movie/1291561" {
			t.Fatalf("unexpected request URL: %s", req.URL.String())
		}
		if req.Header.Get("Referer") != "https://movie.douban.com/" {
			t.Fatalf("Referer header = %q", req.Header.Get("Referer"))
		}
		return stringResponse(http.StatusOK, `{"intro":" A spirited girl enters a strange bathhouse. "}`), nil
	})}

	desc, err := ds.GetSubjectDescription(context.Background(), "movie", "1291561")
	if err != nil {
		t.Fatalf("GetSubjectDescription error: %v", err)
	}
	if desc != "A spirited girl enters a strange bathhouse." {
		t.Fatalf("desc = %q", desc)
	}
}

func TestDoubanGetSubjectDescriptionRejectsInvalidInput(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))

	for _, tt := range []struct {
		kind string
		id   string
	}{
		{kind: "", id: "1291561"},
		{kind: "book", id: "1291561"},
		{kind: "movie", id: ""},
	} {
		if _, err := ds.GetSubjectDescription(context.Background(), tt.kind, tt.id); err == nil {
			t.Fatalf("GetSubjectDescription(%q, %q) expected error", tt.kind, tt.id)
		}
	}
}

func TestDoubanClientErrors(t *testing.T) {
	tests := []struct {
		name string
		call func(*DoubanService) error
	}{
		{
			name: "list fetch error",
			call: func(ds *DoubanService) error {
				ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return nil, io.ErrUnexpectedEOF
				})}
				_, err := ds.GetList(context.Background(), "热门", "movie", 0, 12)
				return err
			},
		},
		{
			name: "list read error",
			call: func(ds *DoubanService) error {
				ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: errReadCloser{}}, nil
				})}
				_, err := ds.GetList(context.Background(), "热门", "movie", 0, 12)
				return err
			},
		},
		{
			name: "list decode error",
			call: func(ds *DoubanService) error {
				ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return stringResponse(http.StatusOK, `{"subjects":`), nil
				})}
				_, err := ds.GetList(context.Background(), "热门", "movie", 0, 12)
				return err
			},
		},
		{
			name: "recent hot bad status",
			call: func(ds *DoubanService) error {
				_, err := ds.GetRecentHot(context.Background(), "movie", "热门", "全部", 0, 12)
				return err
			},
		},
		{
			name: "recent hot read error",
			call: func(ds *DoubanService) error {
				ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: errReadCloser{}}, nil
				})}
				_, err := ds.GetRecentHot(context.Background(), "movie", "热门", "全部", 0, 12)
				return err
			},
		},
		{
			name: "recent hot decode error",
			call: func(ds *DoubanService) error {
				ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return stringResponse(http.StatusOK, `{"items":`), nil
				})}
				_, err := ds.GetRecentHot(context.Background(), "movie", "热门", "全部", 0, 12)
				return err
			},
		},
		{
			name: "recommend bad status",
			call: func(ds *DoubanService) error {
				_, err := ds.GetRecommendByFilters(context.Background(), "movie", "", "", "", 0, 12)
				return err
			},
		},
		{
			name: "recommend read error",
			call: func(ds *DoubanService) error {
				ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: errReadCloser{}}, nil
				})}
				_, err := ds.GetRecommendByFilters(context.Background(), "movie", "", "", "", 0, 12)
				return err
			},
		},
		{
			name: "recommend decode error",
			call: func(ds *DoubanService) error {
				ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return stringResponse(http.StatusOK, `{"items":`), nil
				})}
				_, err := ds.GetRecommendByFilters(context.Background(), "movie", "", "", "", 0, 12)
				return err
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ds := NewDoubanServiceWithClient(newServiceTestStore(t), &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				return stringResponse(http.StatusForbidden, "blocked"), nil
			})})
			if err := tt.call(ds); err == nil {
				t.Fatal("expected douban client error")
			}
		})
	}
}

func TestDoubanServiceConstructorWithNilClient(t *testing.T) {
	ds := NewDoubanServiceWithClient(newServiceTestStore(t), nil)
	if ds.client == nil {
		t.Fatal("expected fallback Douban client")
	}
}

func TestDoubanGetRecommend(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/rexxar/api/v2/subject/recent_hot/movie" {
			t.Fatalf("unexpected request URL: %s", req.URL.String())
		}
		return stringResponse(http.StatusOK, `{
			"items": [{
				"id": "4",
				"title": "Recommended",
				"pic": {"normal": "https://img.example/recommended.jpg"},
				"rating": {"value": 8.4}
			}]
		}`), nil
	})}

	items, err := ds.GetRecommend(context.Background())
	if err != nil {
		t.Fatalf("GetRecommend error: %v", err)
	}
	if len(items) != 1 || items[0].Title != "Recommended" || items[0].Rate != "8.4" {
		t.Fatalf("unexpected items: %+v", items)
	}
}

func TestDoubanGetHomeSections(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/rexxar/api/v2/subject/recent_hot/movie":
			if req.URL.Query().Get("limit") != "24" {
				t.Fatalf("home section request limit = %q, want 24", req.URL.Query().Get("limit"))
			}
			return stringResponse(http.StatusOK, recentHotBody("movie-home", "Movie Home", "8.8")), nil
		case "/rexxar/api/v2/subject/recent_hot/tv":
			if req.URL.Query().Get("limit") != "24" {
				t.Fatalf("home section request limit = %q, want 24", req.URL.Query().Get("limit"))
			}
			return stringResponse(http.StatusOK, recentHotBody("tv-home", "TV Home", "8.1")), nil
		case "/rexxar/api/v2/tv/recommend":
			if req.URL.Query().Get("count") != "24" {
				t.Fatalf("home section request count = %q, want 24", req.URL.Query().Get("count"))
			}
			return stringResponse(http.StatusOK, recommendBody("anime-tv", "Anime TV", "tv", "8.7")), nil
		case "/rexxar/api/v2/movie/recommend":
			if req.URL.Query().Get("count") != "24" {
				t.Fatalf("home section request count = %q, want 24", req.URL.Query().Get("count"))
			}
			return stringResponse(http.StatusOK, recommendBody("anime-movie", "Anime Movie", "movie", "9.0")), nil
		default:
			if strings.HasPrefix(req.URL.Path, "/rexxar/api/v2/movie/") || strings.HasPrefix(req.URL.Path, "/rexxar/api/v2/tv/") {
				return stringResponse(http.StatusOK, `{"intro":"Home hero description"}`), nil
			}
			t.Fatalf("unexpected request URL: %s", req.URL.String())
			return nil, nil
		}
	})}

	sections := ds.GetHomeSections(context.Background())
	if len(sections) != 4 {
		t.Fatalf("len(sections) = %d, want 4: %+v", len(sections), sections)
	}
	if sections[2].Tag != "anime" {
		t.Fatalf("anime section index tag = %q, want anime", sections[2].Tag)
	}
	if len(sections[2].Items) != 2 || sections[2].Items[0].Rate != "9.0" {
		t.Fatalf("anime section was not merged and sorted: %+v", sections[2])
	}
}

func TestDoubanGetHomeSectionsKeepsPartialSuccess(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/rexxar/api/v2/subject/recent_hot/movie":
			return stringResponse(http.StatusOK, recentHotBody("movie-only", "Movie Only", "8.8")), nil
		case "/rexxar/api/v2/subject/recent_hot/tv":
			return stringResponse(http.StatusForbidden, "blocked"), nil
		case "/rexxar/api/v2/tv/recommend":
			return nil, io.ErrUnexpectedEOF
		case "/rexxar/api/v2/movie/recommend":
			return stringResponse(http.StatusOK, recommendBody("anime-movie-only", "Anime Movie Only", "movie", "8.5")), nil
		default:
			if strings.HasPrefix(req.URL.Path, "/rexxar/api/v2/movie/") || strings.HasPrefix(req.URL.Path, "/rexxar/api/v2/tv/") {
				return stringResponse(http.StatusOK, `{"intro":"Home hero description"}`), nil
			}
			t.Fatalf("unexpected request URL: %s", req.URL.String())
			return nil, nil
		}
	})}

	sections := ds.GetHomeSections(context.Background())
	if len(sections) != 2 {
		t.Fatalf("len(sections) = %d, want partial movie and anime sections: %+v", len(sections), sections)
	}
	if sections[0].Tag != "热门" || sections[1].Tag != "anime" {
		t.Fatalf("unexpected partial sections: %+v", sections)
	}
}

func TestDoubanGetHomeSectionsEnrichesOnlyBoundedHeroCandidates(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	detailRequests := 0
	detailIDs := map[string]bool{}
	var detailMu sync.Mutex
	ds.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/rexxar/api/v2/subject/recent_hot/movie":
			return stringResponse(http.StatusOK, recentHotMultiBody("movie", 20)), nil
		case "/rexxar/api/v2/subject/recent_hot/tv":
			return stringResponse(http.StatusOK, recentHotMultiBody("tv", 20)), nil
		case "/rexxar/api/v2/tv/recommend":
			return stringResponse(http.StatusOK, recommendBody("anime-tv", "Anime TV", "tv", "8.7")), nil
		case "/rexxar/api/v2/movie/recommend":
			return stringResponse(http.StatusOK, recommendBody("anime-movie", "Anime Movie", "movie", "9.0")), nil
		default:
			if strings.HasPrefix(req.URL.Path, "/rexxar/api/v2/movie/") || strings.HasPrefix(req.URL.Path, "/rexxar/api/v2/tv/") {
				detailMu.Lock()
				detailRequests++
				detailIDs[strings.TrimPrefix(strings.TrimPrefix(req.URL.Path, "/rexxar/api/v2/movie/"), "/rexxar/api/v2/tv/")] = true
				detailMu.Unlock()
				return stringResponse(http.StatusOK, `{"intro":"Hero description"}`), nil
			}
			t.Fatalf("unexpected request URL: %s", req.URL.String())
			return nil, nil
		}
	})}

	sections := ds.GetHomeSections(context.Background())
	detailMu.Lock()
	defer detailMu.Unlock()
	if detailRequests != homeHeroDescriptionCandidateLimit {
		t.Fatalf("detailRequests = %d, want %d", detailRequests, homeHeroDescriptionCandidateLimit)
	}
	if sections[0].Items[0].Desc != "Hero description" {
		t.Fatalf("first movie desc = %q", sections[0].Items[0].Desc)
	}
	if sections[1].Items[0].Desc != "Hero description" {
		t.Fatalf("first tv desc = %q", sections[1].Items[0].Desc)
	}
	if detailIDs["movie-18"] {
		t.Fatalf("round-robin enrichment should not let first section consume the whole budget: %+v", detailIDs)
	}
	if sections[0].Items[6].Desc != "" {
		t.Fatalf("movie item outside round-robin pool was enriched: %+v", sections[0].Items[6])
	}
}

func TestDoubanRewriteCovers(t *testing.T) {
	ds := NewDoubanService(newServiceTestStore(t))
	items := []DoubanItem{{Title: "Movie", Cover: "https://img1.doubanio.com/a.jpg"}}

	if err := ds.store.SetSetting("douban_image_proxy", "direct"); err != nil {
		t.Fatalf("SetSetting error: %v", err)
	}
	ds.RewriteCovers(items)
	if items[0].Cover != "https://img2.doubanio.com/a.jpg" {
		t.Fatalf("unexpected cover URL: %q", items[0].Cover)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func stringResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func recentHotBody(id, title, rating string) string {
	return `{"items":[{"id":"` + id + `","title":"` + title + `","card_subtitle":"2026 / 中国大陆","pic":{"normal":"https://img1.doubanio.com/` + id + `.jpg"},"rating":{"value":` + rating + `}}]}`
}

func recentHotMultiBody(prefix string, count int) string {
	items := make([]string, 0, count)
	for i := 0; i < count; i++ {
		id := prefix + "-" + strconv.Itoa(i+1)
		items = append(items, `{"id":"`+id+`","title":"Title `+id+`","card_subtitle":"2026 / 中国大陆","pic":{"normal":"https://img1.doubanio.com/`+id+`.jpg"},"rating":{"value":8.8}}`)
	}
	return `{"items":[` + strings.Join(items, ",") + `]}`
}

func recommendBody(id, title, kind, rating string) string {
	return `{"items":[{"id":"` + id + `","title":"` + title + `","type":"` + kind + `","year":"2026","pic":{"normal":"https://img1.doubanio.com/` + id + `.jpg"},"rating":{"value":` + rating + `}}]}`
}
