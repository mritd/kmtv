package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/mritd/kmtv/internal/model"
)

// CreateSubscription inserts a new subscription.
// CreateSubscription 插入一个新订阅.
func (s *Store) CreateSubscription(url string, autoUpdate bool, interval int) (int64, error) {
	result, err := s.db.Exec(
		`INSERT INTO subscriptions (url, auto_update, interval) VALUES (?, ?, ?)`,
		url, autoUpdate, interval,
	)
	if err != nil {
		return 0, fmt.Errorf("create subscription: %w", err)
	}
	return result.LastInsertId()
}

// GetSubscriptionByID retrieves a subscription by ID.
// GetSubscriptionByID 根据 ID 获取订阅.
func (s *Store) GetSubscriptionByID(id int64) (*model.Subscription, error) {
	var sub model.Subscription
	var lastSync *time.Time
	err := s.db.QueryRow(
		`SELECT id, url, auto_update, interval, last_sync, updated_at FROM subscriptions WHERE id = ?`, id,
	).Scan(&sub.ID, &sub.URL, &sub.AutoUpdate, &sub.Interval, &lastSync, &sub.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get subscription by id: %w", err)
	}
	if lastSync != nil {
		sub.LastSync = *lastSync
	}
	return &sub, nil
}

// ListSubscriptions retrieves all subscriptions ordered by ID.
// ListSubscriptions 按 ID 顺序获取所有订阅.
func (s *Store) ListSubscriptions() ([]model.Subscription, error) {
	rows, err := s.db.Query(
		`SELECT id, url, auto_update, interval, last_sync, updated_at FROM subscriptions ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("list subscriptions: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var subs []model.Subscription
	for rows.Next() {
		var sub model.Subscription
		var lastSync *time.Time
		if err := rows.Scan(&sub.ID, &sub.URL, &sub.AutoUpdate, &sub.Interval, &lastSync, &sub.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan subscription: %w", err)
		}
		if lastSync != nil {
			sub.LastSync = *lastSync
		}
		subs = append(subs, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscriptions: %w", err)
	}
	return subs, nil
}

// UpdateSubscription updates a subscription's mutable fields.
// UpdateSubscription 更新订阅的可变字段.
func (s *Store) UpdateSubscription(id int64, url string, autoUpdate bool, interval int) error {
	result, err := s.db.Exec(
		`UPDATE subscriptions SET url = ?, auto_update = ?, interval = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		url, autoUpdate, interval, id,
	)
	if err != nil {
		return fmt.Errorf("update subscription: %w", err)
	}
	return checkRowsAffected(result)
}

// UpdateSubscriptionLastSync updates the last_sync timestamp to now.
// UpdateSubscriptionLastSync 将 last_sync 更新时间设置为当前时间.
func (s *Store) UpdateSubscriptionLastSync(id int64) error {
	_, err := s.db.Exec(
		`UPDATE subscriptions SET last_sync = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		id,
	)
	if err != nil {
		return fmt.Errorf("update subscription last sync: %w", err)
	}
	return nil
}

// DeleteSubscription deletes a subscription by ID.
// DeleteSubscription 根据 ID 删除订阅.
func (s *Store) DeleteSubscription(id int64) error {
	result, err := s.db.Exec(`DELETE FROM subscriptions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete subscription: %w", err)
	}
	return checkRowsAffected(result)
}
