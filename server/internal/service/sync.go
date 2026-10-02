package service

import (
	"sync"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/store"
)

// SyncTombstoneTTL is how long a delete marker stays pullable before GC removes it.
//
// SyncTombstoneTTL 是删除标记在被回收前保持可拉取的时长.
const SyncTombstoneTTL = 90 * 24 * time.Hour

const syncPurgeInterval = 24 * time.Hour

// SyncService runs background maintenance for the sync tables.
//
// SyncService 负责同步表的后台维护.
type SyncService struct {
	store *store.Store
	now   func() time.Time

	mu      sync.Mutex
	started bool
	stopped bool
	done    chan struct{}
	wg      sync.WaitGroup
}

// NewSyncService creates a SyncService bound to the store.
//
// NewSyncService 创建绑定到 store 的 SyncService.
func NewSyncService(s *store.Store) *SyncService {
	return &SyncService{store: s, now: time.Now, done: make(chan struct{})}
}

// Start purges expired tombstones once and then every 24 hours until Stop.
//
// Start 先回收一次过期删除标记, 之后每 24 小时回收一次, 直到 Stop.
func (ss *SyncService) Start() error {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.stopped {
		return errs.ErrServiceStopped
	}
	if ss.started {
		return errs.ErrServiceAlreadyStarted
	}
	ss.started = true
	ss.wg.Go(ss.loop)
	return nil
}

// Stop ends the background loop and waits for it to exit. It is safe to call twice.
//
// Stop 结束后台循环并等待其退出, 可以重复调用.
func (ss *SyncService) Stop() {
	ss.mu.Lock()
	if ss.stopped {
		ss.mu.Unlock()
		return
	}
	ss.stopped = true
	ss.mu.Unlock()
	close(ss.done)
	ss.wg.Wait()
}

// PurgeTombstones removes tombstones older than SyncTombstoneTTL and returns how many were removed.
//
// PurgeTombstones 删除早于 SyncTombstoneTTL 的删除标记, 返回删除数量.
func (ss *SyncService) PurgeTombstones() int64 {
	purged, err := ss.store.PurgeSyncTombstones(ss.now().Add(-SyncTombstoneTTL))
	if err != nil {
		logrus.Warnf("purge sync tombstones: %v", err)
		return 0
	}
	if purged > 0 {
		logrus.Infof("purged %d sync tombstones", purged)
	}
	return purged
}

func (ss *SyncService) loop() {
	ss.PurgeTombstones()
	ticker := time.NewTicker(syncPurgeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ss.done:
			return
		case <-ticker.C:
			ss.PurgeTombstones()
		}
	}
}
