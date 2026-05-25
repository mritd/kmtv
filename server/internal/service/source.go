package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/robfig/cron/v3"
	"github.com/sirupsen/logrus"

	"github.com/mritd/kmtv/internal/config"
	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
	"github.com/mritd/kmtv/internal/utils"
)

// SourceService manages video sources, health checks, and subscription sync.
// SourceService 管理视频源, 健康检查和订阅同步.
type SourceService struct {
	store         *store.Store
	client        *http.Client
	cron          *cron.Cron
	mu            sync.Mutex
	subCrons      map[int64]cron.EntryID // subscription ID -> cron entry ID, 订阅 ID 到 cron entry ID 的映射
	cancel        context.CancelFunc     // cancels in-flight health checks on Stop, Stop 时取消正在执行的健康检查
	ctx           context.Context        // cancelled when Stop is called, Stop 调用后被取消
	started       bool                   // Start has been called successfully, Start 已经成功调用
	stopped       bool                   // Stop has been called, Stop 已经调用
	healthRunning atomic.Bool            // prevents concurrent RunHealthCheck execution, 防止并发执行 RunHealthCheck
}

// NewSourceService creates a new SourceService.
// NewSourceService 创建一个新的 SourceService.
func NewSourceService(s *store.Store) *SourceService {
	return NewSourceServiceWithClient(s, NewSSRFSafeClient(10*time.Second))
}

// NewSourceServiceWithClient creates a SourceService with an injected HTTP client.
// NewSourceServiceWithClient 使用注入的 HTTP client 创建 SourceService.
func NewSourceServiceWithClient(s *store.Store, client *http.Client) *SourceService {
	if client == nil {
		client = NewSSRFSafeClient(10 * time.Second)
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &SourceService{
		store:    s,
		client:   client,
		cron:     cron.New(),
		subCrons: make(map[int64]cron.EntryID),
		ctx:      ctx,
		cancel:   cancel,
	}
}

// Start initializes cron jobs for health check and subscription sync.
// Health check: read interval from settings (default 1h), run on startup.
// Subscription sync: per subscription with auto_update=true.
// Start 初始化健康检查和订阅同步的 cron job.
// 健康检查: 从设置读取间隔, 默认 1h, 启动时执行一次.
// 订阅同步: 对 auto_update=true 的订阅分别创建任务.
func (ss *SourceService) Start() error {
	ss.mu.Lock()
	if ss.stopped {
		ss.mu.Unlock()
		return errs.ErrServiceStopped
	}
	if ss.started {
		ss.mu.Unlock()
		return errs.ErrServiceAlreadyStarted
	}
	ss.started = true
	ss.mu.Unlock()

	// Get health check interval from settings.
	// 从设置读取健康检查间隔.
	intervalStr, err := ss.store.GetSetting(consts.SettingHealthCheckInterval)
	if err != nil {
		ss.mu.Lock()
		ss.started = false
		ss.mu.Unlock()
		return fmt.Errorf("get health check interval: %w", err)
	}

	intervalSec := 3600
	if intervalStr != "" {
		if v, err := strconv.Atoi(intervalStr); err == nil && v > 0 {
			intervalSec = v
		}
	}

	// Schedule health check cron.
	// 注册健康检查 cron.
	spec := fmt.Sprintf("@every %ds", intervalSec)
	if _, err := ss.cron.AddFunc(spec, ss.RunHealthCheck); err != nil {
		ss.mu.Lock()
		ss.started = false
		ss.mu.Unlock()
		return fmt.Errorf("add health check cron: %w", err)
	}

	// Schedule subscription sync for auto_update subscriptions.
	// 为 auto_update 订阅注册同步 cron.
	subs, err := ss.store.ListSubscriptions()
	if err != nil {
		ss.mu.Lock()
		ss.started = false
		ss.mu.Unlock()
		return fmt.Errorf("list subscriptions: %w", err)
	}

	for _, sub := range subs {
		if !sub.AutoUpdate || sub.Interval <= 0 {
			continue
		}
		if err := ss.addSubCron(sub.ID, sub.Interval); err != nil {
			ss.rollbackSubCrons()
			ss.mu.Lock()
			ss.started = false
			ss.mu.Unlock()
			return fmt.Errorf("add subscription cron: %w", err)
		}
	}

	ss.cron.Start()

	// Run health check on startup.
	// 启动时执行一次健康检查.
	go ss.RunHealthCheck()

	return nil
}

// Stop stops all cron jobs and cancels in-flight health checks.
// Stop 停止所有 cron job, 并取消正在执行的健康检查.
func (ss *SourceService) Stop() {
	ss.mu.Lock()
	ss.stopped = true
	ss.mu.Unlock()
	ss.cancel()
	ss.cron.Stop()
}

// RunHealthCheck checks all enabled sources with concurrent workers.
// It is safe to call concurrently; duplicate invocations are skipped.
// RunHealthCheck 使用并发 worker 检查所有已启用视频源.
// 它可以被并发调用; 重复调用会被跳过.
func (ss *SourceService) RunHealthCheck() {
	if !ss.healthRunning.CompareAndSwap(false, true) {
		logrus.Info("health check already running, skipping")
		return
	}
	defer ss.healthRunning.Store(false)

	sources, err := ss.store.ListEnabledSources()
	if err != nil {
		logrus.WithError(err).Error("list enabled sources for health check failed")
		return
	}

	logrus.WithField("count", len(sources)).Info("starting health check")

	// Mark all queued sources as checking up front so the admin UI can show progress.
	// 提前把所有待检源标记为 checking, 让管理面板能展示进行中状态.
	for _, s := range sources {
		if err := ss.store.UpdateSourceHealth(s.ID, consts.HealthChecking); err != nil {
			logrus.Warnf("mark source checking [%s] (%s) failed: %v", s.Name, s.Key, err)
		}
	}

	// Health-check failures are recorded per source instead of failing the whole batch.
	// 健康检查失败会按视频源记录状态, 不会让整个批次失败.
	_, _ = utils.GoProcess(ss.ctx, sources, 5, false, func(ctx context.Context, s model.Source) (struct{}, error) {
		health := consts.HealthHealthy
		checkURL := buildHealthCheckURL(s.API)

		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, checkURL, nil)
		if reqErr != nil {
			health = consts.HealthUnhealthy
			logrus.Warnf("health check [%s] (%s) build request failed: %v", s.Name, s.Key, reqErr)
		} else {
			resp, err := ss.client.Do(req)
			if err != nil {
				health = consts.HealthUnhealthy
				logrus.Warnf("health check [%s] (%s) request failed: %v", s.Name, s.Key, err)
			} else {
				_ = resp.Body.Close()
				if resp.StatusCode != http.StatusOK {
					health = consts.HealthUnhealthy
					logrus.Warnf("health check [%s] (%s) bad status: %d", s.Name, s.Key, resp.StatusCode)
				}
			}
		}

		if err := ss.store.UpdateSourceHealth(s.ID, health); err != nil {
			logrus.Warnf("update source health [%s] (%s) failed: %v", s.Name, s.Key, err)
		}
		return struct{}{}, nil
	})
	logrus.Info("health check completed")
}

// CheckSingleSource checks one source's health and returns the health status.
// CheckSingleSource 检查单个视频源健康状态并返回结果.
func (ss *SourceService) CheckSingleSource(id int64) (string, error) {
	src, err := ss.store.GetSourceByID(id)
	if err != nil {
		return "", fmt.Errorf("get source: %w", err)
	}
	if src == nil {
		return "", fmt.Errorf("source not found: %d", id)
	}

	// Mark the source as checking so concurrent admin views see progress.
	// 标记为 checking, 其它管理端能看到进行中状态.
	if err := ss.store.UpdateSourceHealth(id, consts.HealthChecking); err != nil {
		logrus.Warnf("mark source checking [%s] (%s) failed: %v", src.Name, src.Key, err)
	}

	health := consts.HealthHealthy
	checkURL := buildHealthCheckURL(src.API)

	req, reqErr := http.NewRequestWithContext(ss.ctx, http.MethodGet, checkURL, nil)
	if reqErr != nil {
		health = consts.HealthUnhealthy
	} else {
		resp, err := ss.client.Do(req)
		if err != nil {
			health = consts.HealthUnhealthy
		} else {
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				health = consts.HealthUnhealthy
			}
		}
	}

	if err := ss.store.UpdateSourceHealth(id, health); err != nil {
		return health, fmt.Errorf("update source health: %w", err)
	}

	return health, nil
}

// ImportConfig imports sources from source config.json bytes.
// Returns the number of sources imported/updated.
// ImportConfig 从 source config.json 字节内容导入视频源.
// 返回导入或更新的视频源数量.
func (ss *SourceService) ImportConfig(data []byte) (int, error) {
	parsed, err := config.ParseSourceConfig(bytes.NewReader(data))
	if err != nil {
		return 0, fmt.Errorf("parse config: %w", err)
	}

	count := 0
	for _, src := range parsed.Sources {
		src.IsAdult = isAdultSource(src.Name)
		// NSFW sources default to disabled on first import; the UpsertSourceByKey
		// CONFLICT clause leaves existing rows' enabled flag untouched, so this
		// only affects new inserts.
		// 首次导入的 🔞 视频源默认禁用; UpsertSourceByKey 的 CONFLICT 子句
		// 不会改写已存在行的 enabled 字段, 所以只影响新插入.
		if src.IsAdult {
			src.Enabled = false
		}
		if err := ss.store.UpsertSourceByKey(&src); err != nil {
			logrus.WithError(err).WithField("source", src.Key).Error("upsert source failed")
			continue
		}
		count++
	}

	logrus.WithField("count", count).Info("imported sources from config")
	return count, nil
}

// SyncSubscription fetches and imports sources from a subscription URL.
// SyncSubscription 从订阅 URL 拉取并导入视频源.
func (ss *SourceService) SyncSubscription(id int64) error {
	sub, err := ss.store.GetSubscriptionByID(id)
	if err != nil {
		return fmt.Errorf("get subscription: %w", err)
	}
	if sub == nil {
		return fmt.Errorf("subscription not found: %d", id)
	}

	req, err := http.NewRequestWithContext(ss.ctx, http.MethodGet, sub.URL, nil)
	if err != nil {
		return fmt.Errorf("build subscription request: %w", err)
	}
	resp, err := ss.client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch subscription URL: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("subscription URL returned status %d", resp.StatusCode)
	}

	// Limit subscription payloads to 10MB to avoid unbounded memory use.
	// 将订阅响应限制为 10MB, 避免无限制占用内存.
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return fmt.Errorf("read subscription response: %w", err)
	}

	count, err := ss.ImportConfig(data)
	if err != nil {
		return fmt.Errorf("import subscription config: %w", err)
	}

	if err := ss.store.UpdateSubscriptionLastSync(id); err != nil {
		return fmt.Errorf("update subscription last sync: %w", err)
	}

	logrus.WithField("subscription_id", id).WithField("count", count).Info("synced subscription")
	return nil
}

// addSubCron registers a cron job for a subscription.
// addSubCron 为订阅注册 cron job.
func (ss *SourceService) addSubCron(subID int64, intervalSec int) error {
	if intervalSec <= 0 {
		return fmt.Errorf("subscription interval must be positive")
	}
	spec := fmt.Sprintf("@every %ds", intervalSec)
	entryID, err := ss.cron.AddFunc(spec, func() {
		if err := ss.SyncSubscription(subID); err != nil {
			logrus.WithError(err).WithField("subscription_id", subID).Error("sync subscription failed")
		}
	})
	if err != nil {
		return fmt.Errorf("add cron entry for subscription %d: %w", subID, err)
	}
	ss.mu.Lock()
	ss.subCrons[subID] = entryID
	ss.mu.Unlock()
	return nil
}

func (ss *SourceService) rollbackSubCrons() {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	for subID, entryID := range ss.subCrons {
		ss.cron.Remove(entryID)
		delete(ss.subCrons, subID)
	}
}

// RemoveSubCron removes the cron job for a subscription.
// RemoveSubCron 移除订阅对应的 cron job.
func (ss *SourceService) RemoveSubCron(subID int64) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if entryID, ok := ss.subCrons[subID]; ok {
		ss.cron.Remove(entryID)
		delete(ss.subCrons, subID)
	}
}

// UpdateSubCron updates the cron job for a subscription (remove old, add new).
// UpdateSubCron 更新订阅对应的 cron job, 先移除旧任务再添加新任务.
func (ss *SourceService) UpdateSubCron(subID int64, autoUpdate bool, intervalSec int) {
	ss.mu.Lock()
	if entryID, ok := ss.subCrons[subID]; ok {
		ss.cron.Remove(entryID)
		delete(ss.subCrons, subID)
	}
	ss.mu.Unlock()
	if autoUpdate && intervalSec > 0 {
		if err := ss.addSubCron(subID, intervalSec); err != nil {
			logrus.WithError(err).WithField("subscription_id", subID).Error("add subscription cron failed")
		}
	}
}

// buildHealthCheckURL constructs a video-source health check URL without the wd parameter.
// buildHealthCheckURL 构造不带 wd 参数的视频源健康检查 URL.
func buildHealthCheckURL(apiURL string) string {
	sep := "?"
	if strings.Contains(apiURL, "?") {
		sep = "&"
	}
	return apiURL + sep + "ac=videolist&pg=1"
}
