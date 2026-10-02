package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
)

const (
	// SyncMaxWatchRecords caps live watch records per user; older rows are trimmed.
	//
	// SyncMaxWatchRecords 限制每个用户的有效观看记录数量, 更旧的行会被淘汰.
	SyncMaxWatchRecords = 200

	// SyncMaxFavoriteRecords caps live favorites per user; new keys beyond it are rejected.
	//
	// SyncMaxFavoriteRecords 限制每个用户的有效收藏数量, 超出后拒绝新 key.
	SyncMaxFavoriteRecords = 1000

	// SyncMaxSearchRecords caps live search history entries per user; older rows are trimmed.
	//
	// SyncMaxSearchRecords 限制每个用户的有效搜索历史数量, 更旧的行会被淘汰.
	SyncMaxSearchRecords = 50

	syncMaxFutureLead = time.Second
)

// SyncEpoch returns the random identifier of this database instance.
// Clients compare it to detect a server reset.
//
// SyncEpoch 返回当前数据库实例的随机标识. 客户端通过比较它发现服务端被重置.
func (s *Store) SyncEpoch() (string, error) {
	epoch, err := s.GetSetting(consts.SettingSyncEpoch)
	if err != nil {
		return "", fmt.Errorf("read sync epoch: %w", err)
	}
	if epoch == "" {
		return "", errors.New("sync epoch is missing")
	}
	return epoch, nil
}

// PushSyncChanges applies a batch of changes for one user in a single transaction.
// It returns the user's revision after the batch and one result per change, in input order.
//
// PushSyncChanges 在单个事务中为一个用户应用一批变更.
// 返回本批处理后的用户版本号, 以及与输入顺序一致的逐条结果.
func (s *Store) PushSyncChanges(userID int64, changes []model.SyncChange, now time.Time) (int64, []model.SyncResult, error) {
	if userID <= 0 {
		return 0, nil, errs.ErrInvalidRequest
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, nil, fmt.Errorf("begin sync push: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := ensureSyncUser(tx, userID); err != nil {
		return 0, nil, err
	}

	clamped := clampSyncEventTimes(changes, now)
	results := make([]model.SyncResult, 0, len(changes))
	for i, change := range changes {
		eventTime := change.EventTimeMS
		if t, ok := clamped[eventTime]; ok {
			eventTime = t
		}
		result, err := applySyncChange(tx, userID, change, eventTime, now)
		if err != nil {
			return 0, nil, err
		}
		result.Index = i
		results = append(results, result)
	}
	rev, err := currentSyncRev(tx, userID)
	if err != nil {
		return 0, nil, err
	}
	if err := tx.Commit(); err != nil {
		return 0, nil, fmt.Errorf("commit sync push: %w", err)
	}
	return rev, results, nil
}

// SyncRev returns the user's current sync revision, or 0 if the user never synced.
//
// SyncRev 返回用户当前的同步版本号; 从未同步过时返回 0.
func (s *Store) SyncRev(userID int64) (int64, error) {
	return currentSyncRev(s.db, userID)
}

// ensureSyncUser is the first statement of every sync write transaction. Writing first makes
// SQLite take the write lock at once, so a concurrent writer waits on busy_timeout instead of
// failing to upgrade a read snapshot with SQLITE_BUSY.
//
// ensureSyncUser 是每个同步写事务的第一条语句. 先写入可让 SQLite 立即获取写锁, 并发写入方会按
// busy_timeout 等待, 而不是在升级读快照时直接以 SQLITE_BUSY 失败.
func ensureSyncUser(tx *sql.Tx, userID int64) error {
	if _, err := tx.Exec(`INSERT INTO sync_users (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING`, userID); err != nil {
		return fmt.Errorf("lock sync user: %w", err)
	}
	return nil
}

func invalidSyncResult(reason string) model.SyncResult {
	return model.SyncResult{Status: model.SyncStatusInvalid, Reason: reason}
}

// clampSyncEventTimes maps every event time in the batch that is more than syncMaxFutureLead
// ahead of now onto now, now+1, ... in ascending order. Equal times stay equal, so clamping keeps
// the order of changes inside one batch (a clear followed by a newer upsert still lets the upsert win).
//
// clampSyncEventTimes 把本批中超前 now 超过 syncMaxFutureLead 的事件时间按升序映射为 now, now+1, ....
// 相同时间映射后仍相同, 因此钳制不会打乱同一批内变更的先后 (先清空后写入时, 较新的写入仍然生效).
func clampSyncEventTimes(changes []model.SyncChange, now time.Time) map[int64]int64 {
	limit := now.Add(syncMaxFutureLead).UnixMilli()
	var future []int64
	for _, change := range changes {
		if change.EventTimeMS > limit {
			future = append(future, change.EventTimeMS)
		}
	}
	slices.Sort(future)
	future = slices.Compact(future)
	clamped := make(map[int64]int64, len(future))
	for i, eventTime := range future {
		clamped[eventTime] = now.UnixMilli() + int64(i)
	}
	return clamped
}

func applySyncChange(tx *sql.Tx, userID int64, change model.SyncChange, eventTime int64, now time.Time) (model.SyncResult, error) {
	if !change.Kind.Valid() {
		return invalidSyncResult("unknown kind"), nil
	}
	if change.EventTimeMS <= 0 {
		return invalidSyncResult("event_time_ms must be positive"), nil
	}
	switch change.Op {
	case model.SyncOpClear:
		return applySyncClear(tx, userID, change.Kind, eventTime)
	case model.SyncOpUpsert:
		key, payload, err := model.NormalizeSyncPayload(change.Kind, change.Payload)
		if err != nil {
			return invalidSyncResult(err.Error()), nil
		}
		return applySyncWrite(tx, userID, change.Kind, key, payload, false, eventTime, now)
	case model.SyncOpDelete:
		key := model.NormalizeSyncKey(change.Key)
		if key == "" || utf8.RuneCountInString(key) > model.MaxSyncKeyRunes {
			return invalidSyncResult("key is empty or too long"), nil
		}
		return applySyncWrite(tx, userID, change.Kind, key, json.RawMessage(`{}`), true, eventTime, now)
	default:
		return invalidSyncResult("unknown op"), nil
	}
}

func applySyncWrite(
	tx *sql.Tx,
	userID int64,
	kind model.SyncKind,
	key string,
	payload json.RawMessage,
	deleted bool,
	eventTime int64,
	now time.Time,
) (model.SyncResult, error) {
	existing, err := getSyncRecord(tx, userID, kind, key)
	if err != nil {
		return model.SyncResult{}, err
	}
	watermark, err := getSyncClear(tx, userID, kind)
	if err != nil {
		return model.SyncResult{}, err
	}
	if watermark != nil && eventTime <= watermark.ClearedAtMS {
		return model.SyncResult{Status: model.SyncStatusStale, Record: existing}, nil
	}
	if existing != nil && existing.EventTimeMS >= eventTime {
		return model.SyncResult{Status: model.SyncStatusStale, Record: existing}, nil
	}
	if !deleted && kind == model.SyncKindFavorite && (existing == nil || existing.Deleted) {
		live, err := countLiveSyncRecords(tx, userID, kind)
		if err != nil {
			return model.SyncResult{}, err
		}
		if live >= SyncMaxFavoriteRecords {
			return model.SyncResult{Status: model.SyncStatusLimit, Record: existing}, nil
		}
	}

	rev, err := nextSyncRev(tx, userID)
	if err != nil {
		return model.SyncResult{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO sync_records (user_id, kind, record_key, payload, event_time_ms, deleted, rev, updated_at_ms)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, kind, record_key) DO UPDATE SET
			payload = excluded.payload,
			event_time_ms = excluded.event_time_ms,
			deleted = excluded.deleted,
			rev = excluded.rev,
			updated_at_ms = excluded.updated_at_ms`,
		userID, string(kind), key, string(payload), eventTime, deleted, rev, now.UnixMilli(),
	); err != nil {
		return model.SyncResult{}, fmt.Errorf("write sync record: %w", err)
	}
	if !deleted {
		if err := trimSyncRecords(tx, userID, kind, now); err != nil {
			return model.SyncResult{}, err
		}
	}
	current, err := getSyncRecord(tx, userID, kind, key)
	if err != nil {
		return model.SyncResult{}, err
	}
	if !deleted && current != nil && current.Deleted {
		// The row fell outside the kind's cap and was trimmed into a tombstone in this transaction.
		//
		// 该行超出该类数据的上限, 已在本事务中被淘汰为删除标记.
		return model.SyncResult{Status: model.SyncStatusStale, Record: current}, nil
	}
	return model.SyncResult{Status: model.SyncStatusApplied, Record: current}, nil
}

func applySyncClear(tx *sql.Tx, userID int64, kind model.SyncKind, clearedAt int64) (model.SyncResult, error) {
	existing, err := getSyncClear(tx, userID, kind)
	if err != nil {
		return model.SyncResult{}, err
	}
	if existing != nil && clearedAt <= existing.ClearedAtMS {
		return model.SyncResult{Status: model.SyncStatusStale, Clear: existing}, nil
	}
	rev, err := nextSyncRev(tx, userID)
	if err != nil {
		return model.SyncResult{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO sync_clears (user_id, kind, cleared_at_ms, rev) VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, kind) DO UPDATE SET cleared_at_ms = excluded.cleared_at_ms, rev = excluded.rev`,
		userID, string(kind), clearedAt, rev,
	); err != nil {
		return model.SyncResult{}, fmt.Errorf("write sync clear: %w", err)
	}
	if _, err := tx.Exec(
		`DELETE FROM sync_records WHERE user_id = ? AND kind = ? AND event_time_ms <= ?`,
		userID, string(kind), clearedAt,
	); err != nil {
		return model.SyncResult{}, fmt.Errorf("apply sync clear: %w", err)
	}
	return model.SyncResult{
		Status: model.SyncStatusApplied,
		Clear:  &model.SyncClear{Kind: kind, ClearedAtMS: clearedAt, Rev: rev},
	}, nil
}

func syncCap(kind model.SyncKind) int {
	switch kind {
	case model.SyncKindWatch:
		return SyncMaxWatchRecords
	case model.SyncKindSearch:
		return SyncMaxSearchRecords
	}
	return 0
}

// trimSyncRecords turns live rows beyond the kind's cap into tombstones. Each trimmed row gets
// its own rev, so pull pages never split rows that share a rev, and offline devices learn
// about the trim. The event time is kept, so older replays stay stale.
//
// trimSyncRecords 将超出上限的有效行转为删除标记. 每个被淘汰的行分配独立的 rev, 拉取分页不会拆开
// 共享 rev 的行, 离线设备也能通过拉取得知淘汰. 事件时间保持不变, 更早的重放仍然是 stale.
func trimSyncRecords(tx *sql.Tx, userID int64, kind model.SyncKind, now time.Time) error {
	limit := syncCap(kind)
	if limit == 0 {
		return nil
	}
	rows, err := tx.Query(
		`SELECT record_key FROM sync_records
		 WHERE user_id = ? AND kind = ? AND deleted = 0
		 ORDER BY event_time_ms DESC, record_key ASC
		 LIMIT -1 OFFSET ?`,
		userID, string(kind), limit,
	)
	if err != nil {
		return fmt.Errorf("find trimmed sync records: %w", err)
	}
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan trimmed sync record: %w", err)
		}
		keys = append(keys, key)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close trimmed sync records: %w", err)
	}
	for _, key := range keys {
		rev, err := nextSyncRev(tx, userID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(
			`UPDATE sync_records SET deleted = 1, payload = '{}', rev = ?, updated_at_ms = ?
			 WHERE user_id = ? AND kind = ? AND record_key = ?`,
			rev, now.UnixMilli(), userID, string(kind), key,
		); err != nil {
			return fmt.Errorf("trim sync record: %w", err)
		}
	}
	return nil
}

func nextSyncRev(tx *sql.Tx, userID int64) (int64, error) {
	var rev int64
	if err := tx.QueryRow(
		`INSERT INTO sync_users (user_id, rev) VALUES (?, 1)
		 ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1
		 RETURNING rev`,
		userID,
	).Scan(&rev); err != nil {
		return 0, fmt.Errorf("advance sync rev: %w", err)
	}
	return rev, nil
}

type syncQuerier interface {
	QueryRow(query string, args ...any) *sql.Row
}

func currentSyncRev(q syncQuerier, userID int64) (int64, error) {
	var rev int64
	err := q.QueryRow(`SELECT rev FROM sync_users WHERE user_id = ?`, userID).Scan(&rev)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read sync rev: %w", err)
	}
	return rev, nil
}

func countLiveSyncRecords(tx *sql.Tx, userID int64, kind model.SyncKind) (int, error) {
	var count int
	if err := tx.QueryRow(
		`SELECT COUNT(*) FROM sync_records WHERE user_id = ? AND kind = ? AND deleted = 0`,
		userID, string(kind),
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count sync records: %w", err)
	}
	return count, nil
}

func getSyncRecord(q syncQuerier, userID int64, kind model.SyncKind, key string) (*model.SyncRecord, error) {
	var (
		record  model.SyncRecord
		payload string
	)
	err := q.QueryRow(
		`SELECT kind, record_key, payload, event_time_ms, deleted, rev
		 FROM sync_records WHERE user_id = ? AND kind = ? AND record_key = ?`,
		userID, string(kind), key,
	).Scan(&record.Kind, &record.Key, &payload, &record.EventTimeMS, &record.Deleted, &record.Rev)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read sync record: %w", err)
	}
	record.Payload = json.RawMessage(payload)
	return &record, nil
}

func getSyncClear(q syncQuerier, userID int64, kind model.SyncKind) (*model.SyncClear, error) {
	watermark := model.SyncClear{Kind: kind}
	err := q.QueryRow(
		`SELECT cleared_at_ms, rev FROM sync_clears WHERE user_id = ? AND kind = ?`,
		userID, string(kind),
	).Scan(&watermark.ClearedAtMS, &watermark.Rev)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read sync clear: %w", err)
	}
	return &watermark, nil
}
