package handler

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/middleware"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/store"
	"github.com/mritd/kmtv/internal/vodsource"
)

// Handler holds dependencies for all HTTP handlers.
// Handler 保存所有 HTTP handler 的依赖.
type Handler struct {
	store        *store.Store
	authSvc      *service.AuthService
	mediaSvc     *service.MediaTokenService
	searchSvc    *service.SearchService
	proxySvc     *service.ProxyService
	sourceSvc    *service.SourceService
	doubanSvc    *service.DoubanService
	sourceClient *vodsource.Client
	imageClient  *http.Client
}

// New creates a new Handler with all service dependencies.
// New 使用所有服务依赖创建新的 Handler.
func New(s *store.Store, authSvc *service.AuthService, mediaSvc *service.MediaTokenService, searchSvc *service.SearchService, proxySvc *service.ProxyService, sourceSvc *service.SourceService, doubanSvc *service.DoubanService) *Handler {
	if authSvc == nil {
		authSvc = service.NewAuthService(s)
	}
	if mediaSvc == nil {
		mediaSvc = service.NewMediaTokenService(s)
	}
	return &Handler{
		store:        s,
		authSvc:      authSvc,
		mediaSvc:     mediaSvc,
		searchSvc:    searchSvc,
		proxySvc:     proxySvc,
		sourceSvc:    sourceSvc,
		doubanSvc:    doubanSvc,
		sourceClient: vodsource.NewClient(service.NewSSRFSafeClient(20 * time.Second)),
		imageClient:  service.NewSSRFSafeClient(20 * time.Second),
	}
}

// RegisterRoutes sets up all API routes on the given gin engine.
// RegisterRoutes 在给定 gin engine 上注册所有 API 路由.
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	r.Use(middleware.CORS())
	r.Use(middleware.MaxBodySize(10 << 20)) // 10MB global limit

	apiv1 := r.Group("/api/v1")

	// Auth routes do not require authentication.
	// Auth 路由不需要认证.
	authv1 := apiv1.Group("/auth")
	authv1.POST("/login", h.Login)
	authv1.POST("/logout", h.Logout)
	authv1.GET("/me", h.Me)

	// Public endpoints use optional auth for role-aware responses.
	// 公开端点使用可选认证, 以便返回和角色相关的响应.
	apiv1.GET("/settings", middleware.OptionalAuth(h.authSvc), h.GetSettings)
	apiv1.GET("/proxy/image", h.ProxyImage)

	// Media proxy endpoints stay public because AVPlayer/AppleCoreMedia accesses them directly.
	// 媒体代理端点保持公开, 因为 AVPlayer/AppleCoreMedia 会直接访问它们.
	apiv1.GET("/proxy/m3u8", h.ProxyM3U8)
	apiv1.GET("/proxy/segment", h.ProxySegment)
	apiv1.GET("/proxy/key", h.ProxyKey)

	// Protected routes require authentication.
	// 受保护路由需要认证.
	protectedv1 := apiv1.Group("")
	protectedv1.Use(middleware.Auth(h.store, h.authSvc))
	protectedv1.GET("/search", h.Search)
	protectedv1.GET("/search/stream", h.SearchStream)
	protectedv1.PUT("/auth/profile", h.UpdateProfile)
	protectedv1.PUT("/auth/password", h.ChangePassword)
	protectedv1.PUT("/auth/avatar", h.UploadAvatar)
	protectedv1.DELETE("/auth/avatar", h.DeleteAvatar)
	protectedv1.GET("/avatar/:username", h.GetAvatar)
	protectedv1.GET("/search/suggestions", h.SearchSuggestions)
	protectedv1.GET("/detail", h.Detail)
	protectedv1.GET("/douban/categories", h.DoubanCategories)
	protectedv1.GET("/douban/list", h.DoubanList)
	protectedv1.GET("/douban/recommend", h.DoubanRecommend)
	protectedv1.GET("/douban/recommend/filter", h.DoubanRecommendByFilters)
	protectedv1.GET("/douban/home", h.DoubanHomeSections)
	protectedv1.POST("/playback/url", h.PlaybackURL)

	// Admin routes require authentication and admin role.
	// 管理端路由需要认证和 admin 角色.
	adminv1 := apiv1.Group("/admin")
	adminv1.Use(middleware.Auth(h.store, h.authSvc), middleware.AdminOnly())
	adminv1.GET("/sources", h.ListSources)
	adminv1.POST("/sources", h.CreateSource)
	adminv1.PUT("/sources/:id", h.UpdateSource)
	adminv1.DELETE("/sources/:id", h.DeleteSource)
	adminv1.POST("/sources/:id/check", h.CheckSource)
	adminv1.POST("/sources/check-all", h.CheckAllSources)
	adminv1.POST("/sources/bulk-enabled", h.BulkSetSourcesEnabled)
	adminv1.POST("/sources/import", h.ImportSources)
	adminv1.GET("/subscriptions", h.ListSubscriptions)
	adminv1.POST("/subscriptions", h.CreateSubscription)
	adminv1.PUT("/subscriptions/:id", h.UpdateSubscription)
	adminv1.DELETE("/subscriptions/:id", h.DeleteSubscription)
	adminv1.POST("/subscriptions/:id/sync", h.SyncSubscription)
	adminv1.GET("/users", h.ListUsers)
	adminv1.POST("/users", h.CreateUser)
	adminv1.PUT("/users/:id", h.UpdateUser)
	adminv1.DELETE("/users/:id", h.DeleteUser)
	adminv1.PUT("/settings", h.UpdateSettings)
}

// RegisterStaticRoutes serves the embedded frontend SPA with fallback to index.html.
// RegisterStaticRoutes 提供内嵌前端 SPA, 并回退到 index.html.
func RegisterStaticRoutes(r *gin.Engine, frontendFS embed.FS) {
	distFS, err := fs.Sub(frontendFS, "web/dist")
	if err != nil {
		return
	}
	registerStaticRoutesFromFS(r, distFS)
}

// registerStaticRoutesFromFS serves a prepared static dist filesystem.
// registerStaticRoutesFromFS 提供已经定位到 dist 根目录的静态文件系统.
func registerStaticRoutesFromFS(r *gin.Engine, distFS fs.FS) {
	fileServer := http.FileServer(http.FS(distFS))

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// API paths should never fall through to the SPA.
		// API 路径不能回退到 SPA.
		if strings.HasPrefix(path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}

		if f, err := distFS.Open(path[1:]); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		// SPA fallback: serve index.html.
		// SPA 回退: 返回 index.html.
		c.Request.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}
