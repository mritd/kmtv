package store

import (
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
)

const (
	// MaxWatchHistoryItems bounds per-user history growth in the self-hosted SQLite database.
	// MaxWatchHistoryItems 限制每个用户的观看历史数量, 避免自托管 SQLite 数据库无限增长.
	MaxWatchHistoryItems = 100

	MaxWatchHistoryTitleRunes   = 512
	MaxWatchHistorySourceRunes  = 1024
	MaxWatchHistoryVideoIDRunes = 1024
	MaxWatchHistoryCoverRunes   = 8192
	MaxWatchHistoryEpisodeRunes = 512

	maxWatchHistoryClockSkew = 24 * time.Hour
)

// WatchHistoryTitleKey normalizes a title into the per-user dedupe key.
// WatchHistoryTitleKey 将标题归一化为每个用户内去重的 key.
func WatchHistoryTitleKey(title string) string {
	return strings.ToLower(strings.TrimSpace(title))
}

// UpsertWatchHistory stores the latest playback state for a user/title pair.
// UpsertWatchHistory 保存某个用户/标题组合的最新播放状态.
func (s *Store) UpsertWatchHistory(userID int64, item *model.WatchHistoryItem) (*model.WatchHistoryItem, error) {
	if userID <= 0 || !validWatchHistoryItem(item) {
		return nil, errs.ErrInvalidRequest
	}
	title := strings.TrimSpace(item.Title)
	titleKey := WatchHistoryTitleKey(title)
	if titleKey == "" {
		return nil, errs.ErrInvalidRequest
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin watch history upsert: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var clearedAtMS int64
	err = tx.QueryRow(
		`SELECT cleared_at_ms FROM watch_history_clear_state WHERE user_id = ?`,
		userID,
	).Scan(&clearedAtMS)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("read watch history clear state: %w", err)
	}
	if item.EventTimeMS <= clearedAtMS {
		return nil, errs.ErrStaleWrite
	}

	result, err := tx.Exec(
		`INSERT INTO watch_history (
			user_id, title_key, source_key, video_id, title, cover, episode,
			group_index, episode_index, progress_sec, duration_sec, completed, event_time_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, title_key) DO UPDATE SET
			source_key = excluded.source_key,
			video_id = excluded.video_id,
			title = excluded.title,
			cover = excluded.cover,
			episode = excluded.episode,
			group_index = excluded.group_index,
			episode_index = excluded.episode_index,
			progress_sec = excluded.progress_sec,
			duration_sec = excluded.duration_sec,
			completed = excluded.completed,
			event_time_ms = excluded.event_time_ms,
			updated_at = CURRENT_TIMESTAMP
		WHERE excluded.event_time_ms > watch_history.event_time_ms`,
		userID,
		titleKey,
		strings.TrimSpace(item.SourceKey),
		strings.TrimSpace(item.VideoID),
		title,
		strings.TrimSpace(item.Cover),
		strings.TrimSpace(item.Episode),
		item.GroupIndex,
		item.EpisodeIndex,
		item.ProgressSec,
		item.DurationSec,
		item.Completed,
		item.EventTimeMS,
	)
	if err != nil {
		return nil, fmt.Errorf("upsert watch history: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil {
		return nil, fmt.Errorf("check watch history upsert: %w", err)
	} else if affected == 0 {
		return nil, errs.ErrStaleWrite
	}

	if _, err := tx.Exec(
		`DELETE FROM watch_history
		 WHERE user_id = ?
		   AND id NOT IN (
			 SELECT id FROM watch_history
			 WHERE user_id = ?
			 ORDER BY event_time_ms DESC, id DESC
			 LIMIT ?
		   )`,
		userID,
		userID,
		MaxWatchHistoryItems,
	); err != nil {
		return nil, fmt.Errorf("trim watch history: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit watch history upsert: %w", err)
	}

	return s.GetWatchHistoryByTitle(userID, title)
}

// GetWatchHistoryByTitle returns the stored history item for a normalized title.
// GetWatchHistoryByTitle 根据归一化标题返回观看历史条目.
func (s *Store) GetWatchHistoryByTitle(userID int64, title string) (*model.WatchHistoryItem, error) {
	titleKey := WatchHistoryTitleKey(title)
	if userID <= 0 || titleKey == "" {
		return nil, errs.ErrInvalidRequest
	}
	item, err := scanWatchHistoryRow(s.db.QueryRow(
		watchHistorySelectSQL+` WHERE user_id = ? AND title_key = ?`,
		userID,
		titleKey,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get watch history by title: %w", err)
	}
	return item, nil
}

// ListWatchHistory returns the most recent history items for a user.
// ListWatchHistory 返回某个用户最近的观看历史.
func (s *Store) ListWatchHistory(userID int64, limit int, completed *bool) ([]model.WatchHistoryItem, error) {
	if userID <= 0 {
		return nil, errs.ErrInvalidRequest
	}
	if limit <= 0 || limit > MaxWatchHistoryItems {
		limit = MaxWatchHistoryItems
	}
	query := watchHistorySelectSQL + ` WHERE user_id = ?`
	args := []any{userID}
	if completed != nil {
		query += ` AND completed = ?`
		args = append(args, *completed)
	}
	query += ` ORDER BY event_time_ms DESC, id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list watch history: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items := []model.WatchHistoryItem{}
	for rows.Next() {
		item, err := scanWatchHistoryScanner(rows)
		if err != nil {
			return nil, fmt.Errorf("scan watch history: %w", err)
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate watch history: %w", err)
	}
	return items, nil
}

// DeleteWatchHistoryByTitle removes one user/title history item.
// DeleteWatchHistoryByTitle 删除某个用户/标题组合的观看历史.
func (s *Store) DeleteWatchHistoryByTitle(userID int64, title string) error {
	titleKey := WatchHistoryTitleKey(title)
	if userID <= 0 || titleKey == "" {
		return errs.ErrInvalidRequest
	}
	result, err := s.db.Exec(`DELETE FROM watch_history WHERE user_id = ? AND title_key = ?`, userID, titleKey)
	if err != nil {
		return fmt.Errorf("delete watch history by title: %w", err)
	}
	return checkRowsAffected(result)
}

// ClearWatchHistory removes all history for a user.
// ClearWatchHistory 删除某个用户的全部观看历史.
func (s *Store) ClearWatchHistory(userID, clearedAtMS int64) error {
	if userID <= 0 || !validWatchHistoryEventTime(clearedAtMS) {
		return errs.ErrInvalidRequest
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin clear watch history: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(
		`INSERT INTO watch_history_clear_state (user_id, cleared_at_ms) VALUES (?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET cleared_at_ms = MAX(cleared_at_ms, excluded.cleared_at_ms)`,
		userID,
		clearedAtMS,
	); err != nil {
		return fmt.Errorf("record watch history clear state: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM watch_history WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("clear watch history: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit clear watch history: %w", err)
	}
	return nil
}

const watchHistorySelectSQL = `SELECT
	id, user_id, title_key, source_key, video_id, title, cover, episode,
	group_index, episode_index, progress_sec, duration_sec, completed,
	event_time_ms, created_at, updated_at
	FROM watch_history`

type watchHistoryScanner interface {
	Scan(dest ...any) error
}

func scanWatchHistoryRow(row *sql.Row) (*model.WatchHistoryItem, error) {
	return scanWatchHistoryScanner(row)
}

func scanWatchHistoryScanner(scanner watchHistoryScanner) (*model.WatchHistoryItem, error) {
	var item model.WatchHistoryItem
	if err := scanner.Scan(
		&item.ID,
		&item.UserID,
		&item.TitleKey,
		&item.SourceKey,
		&item.VideoID,
		&item.Title,
		&item.Cover,
		&item.Episode,
		&item.GroupIndex,
		&item.EpisodeIndex,
		&item.ProgressSec,
		&item.DurationSec,
		&item.Completed,
		&item.EventTimeMS,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &item, nil
}

func validWatchHistoryItem(item *model.WatchHistoryItem) bool {
	if item == nil || item.GroupIndex < 0 || item.EpisodeIndex < 0 {
		return false
	}
	if !validWatchHistoryFloat(item.ProgressSec) || !validWatchHistoryFloat(item.DurationSec) {
		return false
	}
	if !validWatchHistoryEventTime(item.EventTimeMS) {
		return false
	}
	return validHistoryString(item.Title, MaxWatchHistoryTitleRunes, true) &&
		validHistoryString(item.SourceKey, MaxWatchHistorySourceRunes, false) &&
		validHistoryString(item.VideoID, MaxWatchHistoryVideoIDRunes, false) &&
		validHistoryString(item.Cover, MaxWatchHistoryCoverRunes, false) &&
		validHistoryString(item.Episode, MaxWatchHistoryEpisodeRunes, false)
}

func validWatchHistoryFloat(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}

func validWatchHistoryEventTime(value int64) bool {
	if value <= 0 {
		return false
	}
	return value <= time.Now().Add(maxWatchHistoryClockSkew).UnixMilli()
}

func validHistoryString(value string, maxRunes int, required bool) bool {
	trimmed := strings.TrimSpace(value)
	if required && trimmed == "" {
		return false
	}
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= maxRunes
}
