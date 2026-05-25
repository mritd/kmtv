package service

import (
	"net/http"
	"time"

	"github.com/mritd/kmtv/internal/store"
)

// DoubanService provides access to Douban movie/TV data.
// DoubanService 提供 Douban 影视数据访问能力.
type DoubanService struct {
	client *http.Client
	store  *store.Store
}

// NewDoubanService creates a new DoubanService.
// NewDoubanService 创建一个新的 DoubanService.
func NewDoubanService(s *store.Store) *DoubanService {
	return NewDoubanServiceWithClient(s, NewSSRFSafeClient(10*time.Second))
}

// NewDoubanServiceWithClient creates a DoubanService with an injected HTTP client.
// NewDoubanServiceWithClient 使用注入的 HTTP client 创建 DoubanService.
func NewDoubanServiceWithClient(s *store.Store, client *http.Client) *DoubanService {
	if client == nil {
		client = NewSSRFSafeClient(10 * time.Second)
	}
	return &DoubanService{
		client: client,
		store:  s,
	}
}
