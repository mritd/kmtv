package cmd

import (
	"embed"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/handler"
	"github.com/mritd/kmtv/internal/middleware"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/store"
	"github.com/mritd/kmtv/internal/utils"
	"github.com/mritd/kmtv/internal/version"
)

var (
	listenAddr string
	dbPath     string
)

// FrontendFS holds the embedded frontend files, set by main package.
// FrontendFS 保存由 main package 注入的内嵌前端文件.
var FrontendFS embed.FS

var rootCmd = &cobra.Command{
	Use:   "kmtv",
	Short: "KMTV - Video aggregation player",
	Long:  "KMTV is a video aggregation player that collects and plays videos from multiple sources.",
	// Version drives the auto-registered -v/--version flag; the template prints
	// the full build summary (version, commit, build time) on its own.
	// Version 驱动自动注册的 -v/--version 选项; 模板单独打印完整构建摘要
	// (版本号、commit、编译时间).
	Version: version.Info(),
	Run: func(cmd *cobra.Command, args []string) {
		_, cleanup, r, err := prepareServer(resolveDBPath(cmd), FrontendFS)
		if err != nil {
			logrus.Fatalf("Failed to prepare server: %v", err)
		}
		defer cleanup()

		logrus.Infof("Server listening on %s", listenAddr)
		if err := r.Run(listenAddr); err != nil {
			logrus.Fatalf("Server failed: %v", err)
		}
	},
}

// chooseDBPath applies precedence: an explicit --db-path flag wins, otherwise
// the KMTV_DB_PATH env value (if non-empty), otherwise the flag default.
// flagChanged reports whether --db-path was set explicitly on the command line.
// chooseDBPath 按优先级选择: 显式 --db-path > KMTV_DB_PATH 环境变量 > 默认值.
// flagChanged 表示 --db-path 是否在命令行被显式设置.
func chooseDBPath(flagChanged bool, flagVal, envVal string) string {
	if flagChanged {
		return flagVal
	}
	if env := strings.TrimSpace(envVal); env != "" {
		return env
	}
	return flagVal
}

// resolveDBPath resolves the effective database path from the flag and env.
// resolveDBPath 从 flag 和环境变量解析出生效的数据库路径.
func resolveDBPath(cmd *cobra.Command) string {
	return chooseDBPath(cmd.Flags().Changed("db-path"), dbPath, os.Getenv(consts.EnvDBPath))
}

func init() {
	rootCmd.PersistentFlags().StringVar(&listenAddr, "listen", ":8080", "server listen address")
	rootCmd.PersistentFlags().StringVar(&dbPath, "db-path", "kmtv.db", "database file path (use :memory: or set KMTV_DB_PATH=:memory: for an ephemeral in-memory database)")
	// Print only the build summary for -v/--version instead of the default
	// "kmtv version <...>" wrapper, since Info() is already self-describing.
	// -v/--version 只打印构建摘要, 而非默认的 "kmtv version <...>" 包装,
	// 因为 Info() 本身已包含完整描述.
	rootCmd.SetVersionTemplate("{{.Version}}\n")
}

// prepareServer initializes runtime dependencies and returns a ready Gin engine.
// prepareServer 初始化运行时依赖并返回可用的 Gin engine.
func prepareServer(databasePath string, frontendFS embed.FS) (*store.Store, func(), *gin.Engine, error) {
	lines := strings.Split(version.Info(), "\n")
	for i, line := range lines {
		logrus.Info(line)
		if i == len(lines)-1 {
			logrus.Info()
		}
	}
	logrus.Infof("KMTV %s starting...", version.Version)
	logrus.Infof("Listen address: %s", listenAddr)
	if store.IsMemoryDSN(databasePath) {
		logrus.Info("Database: in-memory (ephemeral, data resets on restart)")
	} else {
		logrus.Infof("Database path: %s", databasePath)
	}

	// Initialize store before services so all DB-backed dependencies are ready.
	// 先初始化 store, 确保所有依赖数据库的服务可用.
	s, err := store.New(databasePath)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("initialize store: %w", err)
	}
	cleanup := func() { _ = s.Close() }

	// Apply runtime settings from DB without failing startup on invalid values.
	// 从数据库应用运行时设置, 无效值沿用默认值且不阻断启动.
	service.ApplyRuntimeSettingsFromReader(s)
	logrus.Infof("Search concurrency: %d, Search timeout: %s, Probe concurrency: %d, Probe timeout: %s",
		service.GetSearchConcurrency(), service.GetSearchTimeout(),
		service.GetProbeConcurrency(), service.GetProbeTimeout())

	// Initialize services.
	// 初始化服务层依赖.
	authSvc := service.NewAuthService(s)
	mediaSvc := service.NewMediaTokenService(s)
	proxySvc := service.NewProxyService()
	searchSvc := service.NewSearchService(s, proxySvc)
	sourceSvc := service.NewSourceService(s)
	doubanSvc := service.NewDoubanService(s)

	if err := sourceSvc.Start(); err != nil {
		cleanup()
		return nil, nil, nil, fmt.Errorf("start source service: %w", err)
	}
	cleanup = func() {
		sourceSvc.Stop()
		_ = s.Close()
	}

	// Ensure default admin user exists; if newly created, optionally seed initial sources from env.
	// 确保默认管理员存在; 如果是新建用户, 则可按环境变量导入初始视频源.
	freshDB := false
	if u, err := s.GetUserByUsername("admin"); err != nil {
		cleanup()
		return nil, nil, nil, fmt.Errorf("check admin user: %w", err)
	} else if u == nil {
		freshDB = true
		if _, err := s.CreateUser("admin", "admin", "admin"); err != nil {
			cleanup()
			return nil, nil, nil, fmt.Errorf("create default admin user: %w", err)
		}
		banner := strings.Repeat("=", 60)
		logrus.Warnf("\n%s\n  Default admin account created:\n  Username: admin\n  Password: admin\n  PLEASE CHANGE THIS PASSWORD AFTER FIRST LOGIN!\n%s", banner, banner)
	}

	if freshDB {
		go seedInitialSourcesFromEnv(s, sourceSvc)
	}

	// Setup Gin engine and register routes.
	// 初始化 Gin engine 并注册路由.
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(middleware.GinLogger())
	r.Use(gin.Recovery())
	h := handler.New(s, authSvc, mediaSvc, searchSvc, proxySvc, sourceSvc, doubanSvc)
	h.RegisterRoutes(r)
	handler.RegisterStaticRoutes(r, frontendFS)

	return s, cleanup, r, nil
}

func seedInitialSourcesFromEnv(s *store.Store, sourceSvc *service.SourceService) {
	seedInitialSourcesFromEnvWithClient(s, sourceSvc, service.NewSSRFSafeClient(30*time.Second))
}

func seedInitialSourcesFromEnvWithClient(s *store.Store, sourceSvc *service.SourceService, client *http.Client) {
	configURL := strings.TrimSpace(os.Getenv(consts.EnvInitSourceURL))
	if configURL == "" {
		logrus.Infof("%s is not set; skipping initial source import", consts.EnvInitSourceURL)
		return
	}
	seedSourcesFromURL(s, sourceSvc, configURL, client)
}

func seedSourcesFromURL(s *store.Store, sourceSvc *service.SourceService, configURL string, client *http.Client) {
	if err := utils.ValidateExternalURL(configURL); err != nil {
		logrus.Errorf("Invalid initial source config URL: %v", err)
		return
	}

	logrus.Infof("Seeding initial sources from %s ...", configURL)

	resp, err := client.Get(configURL)
	if err != nil {
		logrus.Errorf("Failed to fetch initial source config: %v", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		logrus.Errorf("Failed to fetch initial source config: HTTP %d", resp.StatusCode)
		return
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		logrus.Errorf("Failed to read initial source config: %v", err)
		return
	}

	count, err := sourceSvc.ImportConfig(data)
	if err != nil {
		logrus.Errorf("Failed to import initial source config: %v", err)
		return
	}
	logrus.Infof("Seeded %d initial sources", count)

	// Create a subscription record so env-based first-start seeding matches the old default behavior.
	// 创建订阅记录, 使环境变量驱动的首次启动导入行为与旧默认行为保持一致.
	if _, err := s.CreateSubscription(configURL, true, 86400); err != nil {
		logrus.Errorf("Failed to create initial source subscription: %v", err)
	}
}

// Execute runs the root command.
// Execute 运行 root command.
func Execute() {
	cobra.CheckErr(rootCmd.Execute())
}
