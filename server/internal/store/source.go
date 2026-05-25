package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
)

// scanSource scans a single source row into a model.Source.
// scanSource 将单行 source 查询结果扫描为 model.Source.
func scanSource(row interface{ Scan(...any) error }) (*model.Source, error) {
	var src model.Source
	var lastCheck *time.Time
	err := row.Scan(
		&src.ID, &src.Key, &src.Name, &src.API, &src.Detail,
		&src.Enabled, &src.IsAdult, &src.Searchable, &src.Comment, &src.Health, &lastCheck,
		&src.CreatedAt, &src.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if lastCheck != nil {
		src.LastCheck = *lastCheck
	}
	return &src, nil
}

// querySources executes a query and returns a slice of sources.
// querySources 执行查询并返回视频源切片.
func (s *Store) querySources(query string, args ...any) ([]model.Source, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var sources []model.Source
	for rows.Next() {
		src, err := scanSource(rows)
		if err != nil {
			return nil, fmt.Errorf("scan source: %w", err)
		}
		sources = append(sources, *src)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return sources, nil
}

const sourceColumns = `id, key, name, api, detail, enabled, is_adult, searchable, comment, health, last_check, created_at, updated_at`

// CreateSource inserts a new source.
// CreateSource 插入一个新视频源.
func (s *Store) CreateSource(src *model.Source) (int64, error) {
	result, err := s.db.Exec(
		`INSERT INTO sources (key, name, api, detail, enabled, is_adult, comment) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		src.Key, src.Name, src.API, src.Detail, src.Enabled, src.IsAdult, src.Comment,
	)
	if err != nil {
		return 0, fmt.Errorf("create source: %w", err)
	}
	return result.LastInsertId()
}

// GetSourceByID retrieves a source by ID.
// GetSourceByID 根据 ID 获取视频源.
func (s *Store) GetSourceByID(id int64) (*model.Source, error) {
	row := s.db.QueryRow(
		`SELECT `+sourceColumns+` FROM sources WHERE id = ?`, id,
	)
	src, err := scanSource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get source by id: %w", err)
	}
	return src, nil
}

// GetSourceByKey retrieves a source by its unique key.
// GetSourceByKey 根据唯一 key 获取视频源.
func (s *Store) GetSourceByKey(key string) (*model.Source, error) {
	row := s.db.QueryRow(
		`SELECT `+sourceColumns+` FROM sources WHERE key = ?`, key,
	)
	src, err := scanSource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get source by key: %w", err)
	}
	return src, nil
}

// ListSources retrieves all sources ordered by ID.
// ListSources 按 ID 顺序获取所有视频源.
func (s *Store) ListSources() ([]model.Source, error) {
	sources, err := s.querySources(`SELECT ` + sourceColumns + ` FROM sources ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}
	return sources, nil
}

// ListEnabledHealthySources retrieves sources that are enabled, searchable, and not unhealthy.
// ListEnabledHealthySources 获取已启用, 可搜索且非 unhealthy 的视频源.
func (s *Store) ListEnabledHealthySources() ([]model.Source, error) {
	sources, err := s.querySources(
		`SELECT ` + sourceColumns + ` FROM sources WHERE enabled = 1 AND searchable = 1 AND health != 'unhealthy' ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("list enabled healthy sources: %w", err)
	}
	return sources, nil
}

// ListEnabledSources retrieves all enabled sources.
// ListEnabledSources 获取所有已启用视频源.
func (s *Store) ListEnabledSources() ([]model.Source, error) {
	sources, err := s.querySources(
		`SELECT ` + sourceColumns + ` FROM sources WHERE enabled = 1 ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("list enabled sources: %w", err)
	}
	return sources, nil
}

// UpdateSource updates a source's mutable fields.
// UpdateSource 更新视频源的可变字段.
func (s *Store) UpdateSource(id int64, name, api, detail, comment string, enabled bool) error {
	src, err := s.GetSourceByID(id)
	if err != nil {
		return err
	}
	if src == nil {
		return errs.ErrNotFound
	}
	return s.UpdateSourceFull(id, name, api, detail, comment, enabled, src.IsAdult)
}

// UpdateSourceFull updates a source's mutable fields including adult classification.
// UpdateSourceFull 更新视频源可变字段, 包括成人内容分类.
func (s *Store) UpdateSourceFull(id int64, name, api, detail, comment string, enabled, isAdult bool) error {
	result, err := s.db.Exec(
		`UPDATE sources SET name = ?, api = ?, detail = ?, comment = ?, enabled = ?, is_adult = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		name, api, detail, comment, enabled, isAdult, id,
	)
	if err != nil {
		return fmt.Errorf("update source: %w", err)
	}
	return checkRowsAffected(result)
}

// BulkSetSourcesEnabled atomically sets the enabled flag for all given source ids.
// BulkSetSourcesEnabled 在单个事务中原子地把指定 id 集合的 enabled 字段置为相同值.
// All ids must match an existing row; otherwise the transaction rolls back and
// returns an error wrapping errs.ErrNotFound. This avoids the partial-success
// pitfall of concurrent per-row PUTs which fail unpredictably under WAL writer
// lock contention.
// 所有 id 必须命中现有行, 否则整个事务回滚并返回包装 errs.ErrNotFound 的错误.
// 这避免了并发逐行 PUT 在 WAL 写锁竞争下出现的不可预测的部分成功问题.
func (s *Store) BulkSetSourcesEnabled(ids []int64, enabled bool) error {
	if len(ids) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("bulk set sources enabled: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	placeholders := strings.Repeat("?,", len(ids)-1) + "?"
	args := make([]any, 0, len(ids)+1)
	args = append(args, enabled)
	for _, id := range ids {
		args = append(args, id)
	}
	query := fmt.Sprintf(
		`UPDATE sources SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (%s)`,
		placeholders,
	)

	result, err := tx.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("bulk set sources enabled: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("bulk set sources enabled: rows affected: %w", err)
	}
	if int(affected) != len(ids) {
		return fmt.Errorf("bulk set sources enabled: matched %d of %d: %w", affected, len(ids), errs.ErrNotFound)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("bulk set sources enabled: commit: %w", err)
	}
	return nil
}

// UpdateSourceHealth updates a source's health status and last_check timestamp.
// UpdateSourceHealth 更新视频源健康状态和 last_check 时间.
func (s *Store) UpdateSourceHealth(id int64, health string) error {
	_, err := s.db.Exec(
		`UPDATE sources SET health = ?, last_check = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		health, id,
	)
	if err != nil {
		return fmt.Errorf("update source health: %w", err)
	}
	return nil
}

// UpdateSourceSearchable marks whether a source supports search.
// UpdateSourceSearchable 标记视频源是否支持搜索.
func (s *Store) UpdateSourceSearchable(id int64, searchable bool) error {
	_, err := s.db.Exec(
		`UPDATE sources SET searchable = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		searchable, id,
	)
	if err != nil {
		return fmt.Errorf("update source searchable: %w", err)
	}
	return nil
}

// DeleteSource deletes a source by ID.
// DeleteSource 根据 ID 删除视频源.
func (s *Store) DeleteSource(id int64) error {
	result, err := s.db.Exec(`DELETE FROM sources WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete source: %w", err)
	}
	return checkRowsAffected(result)
}

// UpsertSourceByKey inserts a source or updates it if the key already exists.
// UpsertSourceByKey 插入视频源, 如果 key 已存在则更新.
func (s *Store) UpsertSourceByKey(src *model.Source) error {
	_, err := s.db.Exec(
		`INSERT INTO sources (key, name, api, detail, enabled, is_adult, comment)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET
			name = excluded.name,
			api = excluded.api,
			detail = excluded.detail,
			is_adult = excluded.is_adult,
			comment = excluded.comment,
			updated_at = CURRENT_TIMESTAMP`,
		src.Key, src.Name, src.API, src.Detail, src.Enabled, src.IsAdult, src.Comment,
	)
	if err != nil {
		return fmt.Errorf("upsert source by key: %w", err)
	}
	return nil
}
