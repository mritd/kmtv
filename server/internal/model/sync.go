package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

// SyncKind names one synchronized data collection.
//
// SyncKind 表示一类同步数据集合.
type SyncKind string

const (
	// SyncKindWatch stores the latest playback state per title.
	//
	// SyncKindWatch 按标题保存最近一次播放状态.
	SyncKindWatch SyncKind = "watch"

	// SyncKindFavorite stores one favorite per title.
	//
	// SyncKindFavorite 按标题保存一条收藏.
	SyncKindFavorite SyncKind = "favorite"

	// SyncKindSearch stores one search history entry per query.
	//
	// SyncKindSearch 按搜索词保存一条搜索历史.
	SyncKindSearch SyncKind = "search"
)

// Valid reports whether k is a known kind.
//
// Valid 判断 k 是否为已知的数据类型.
func (k SyncKind) Valid() bool {
	switch k {
	case SyncKindWatch, SyncKindFavorite, SyncKindSearch:
		return true
	}
	return false
}

// SyncOp is the operation carried by one pushed change.
//
// SyncOp 表示一次推送变更携带的操作.
type SyncOp string

const (
	// SyncOpUpsert creates or replaces a record from its payload.
	//
	// SyncOpUpsert 根据 payload 创建或替换一条记录.
	SyncOpUpsert SyncOp = "upsert"

	// SyncOpDelete writes a tombstone for a key.
	//
	// SyncOpDelete 为一个 key 写入删除标记.
	SyncOpDelete SyncOp = "delete"

	// SyncOpClear removes every record of a kind written at or before the event time.
	//
	// SyncOpClear 删除某类数据中事件时间不晚于本次时间的全部记录.
	SyncOpClear SyncOp = "clear"
)

// SyncStatus is the per-change outcome of a push.
//
// SyncStatus 表示推送中单条变更的处理结果.
type SyncStatus string

const (
	// SyncStatusApplied means the change was stored.
	//
	// SyncStatusApplied 表示变更已保存.
	SyncStatusApplied SyncStatus = "applied"

	// SyncStatusStale means newer server state won; the result carries that state.
	//
	// SyncStatusStale 表示服务端已有更新的状态, 结果中携带该状态.
	SyncStatusStale SyncStatus = "stale"

	// SyncStatusInvalid means the change failed validation.
	//
	// SyncStatusInvalid 表示变更未通过校验.
	SyncStatusInvalid SyncStatus = "invalid"

	// SyncStatusLimit means the kind is full and the new key was rejected.
	//
	// SyncStatusLimit 表示该类数据已满, 新 key 被拒绝.
	SyncStatusLimit SyncStatus = "limit"
)

// MaxSyncKeyRunes bounds a normalized record key.
//
// MaxSyncKeyRunes 限制归一化后记录 key 的长度.
const MaxSyncKeyRunes = 512

const (
	maxSyncTitleRunes     = 512
	maxSyncSourceKeyRunes = 1024
	maxSyncVideoIDRunes   = 1024
	maxSyncCoverRunes     = 8192
	maxSyncEpisodeRunes   = 512
	maxSyncShortRunes     = 64
	maxSyncDescRunes      = 2048
	maxSyncQueryRunes     = 512
)

// isSyncSpace is the explicit whitespace set every client mirrors for key normalization.
//
// isSyncSpace 是 key 归一化使用的显式空白字符集合, 各客户端需保持一致.
func isSyncSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

// NormalizeSyncKey trims, collapses internal whitespace to one space, and lowercases s.
//
// NormalizeSyncKey 去掉首尾空白, 将内部连续空白合并为一个空格, 再转为小写.
func NormalizeSyncKey(s string) string {
	return strings.ToLower(strings.Join(strings.FieldsFunc(s, isSyncSpace), " "))
}

func trimSyncText(s string) string {
	return strings.TrimFunc(s, isSyncSpace)
}

func syncTextFits(s string, maxRunes int) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) <= maxRunes
}

func syncSecondsValid(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0
}

// WatchPayload is the playback state stored for one title.
//
// WatchPayload 是某个标题保存的播放状态.
type WatchPayload struct {
	Title        string  `json:"title"`
	Cover        string  `json:"cover"`
	SourceKey    string  `json:"source_key"`
	VideoID      string  `json:"video_id"`
	Episode      string  `json:"episode"`
	GroupIndex   int     `json:"group_index"`
	EpisodeIndex int     `json:"episode_index"`
	ProgressSec  float64 `json:"progress_sec"`
	DurationSec  float64 `json:"duration_sec"`
	Completed    bool    `json:"completed"`
}

// FavoritePayload is the display data stored for one favorite title.
//
// FavoritePayload 是某个收藏标题保存的展示数据.
type FavoritePayload struct {
	Title     string `json:"title"`
	Cover     string `json:"cover"`
	Type      string `json:"type"`
	Year      string `json:"year"`
	Rate      string `json:"rate"`
	Desc      string `json:"desc"`
	SourceKey string `json:"source_key"`
	VideoID   string `json:"video_id"`
}

// SearchPayload is one search history entry.
//
// SearchPayload 是一条搜索历史.
type SearchPayload struct {
	Query string `json:"query"`
}

func decodeSyncPayload(raw json.RawMessage, dst any) error {
	if len(bytes.TrimSpace(raw)) == 0 {
		return errors.New("payload is required")
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	return nil
}

// NormalizeSyncPayload validates an upsert payload and returns its canonical key and JSON.
// Unknown fields are dropped and text fields are trimmed.
//
// NormalizeSyncPayload 校验 upsert payload, 返回规范 key 和规范 JSON.
// 未知字段会被丢弃, 文本字段会去掉首尾空白.
func NormalizeSyncPayload(kind SyncKind, raw json.RawMessage) (string, json.RawMessage, error) {
	var (
		key     string
		payload any
	)
	switch kind {
	case SyncKindWatch:
		var p WatchPayload
		if err := decodeSyncPayload(raw, &p); err != nil {
			return "", nil, err
		}
		p.Title = trimSyncText(p.Title)
		p.Cover = trimSyncText(p.Cover)
		p.SourceKey = trimSyncText(p.SourceKey)
		p.VideoID = trimSyncText(p.VideoID)
		p.Episode = trimSyncText(p.Episode)
		switch {
		case !syncTextFits(p.Title, maxSyncTitleRunes):
			return "", nil, errors.New("title is too long")
		case !syncTextFits(p.Cover, maxSyncCoverRunes):
			return "", nil, errors.New("cover is too long")
		case !syncTextFits(p.SourceKey, maxSyncSourceKeyRunes):
			return "", nil, errors.New("source_key is too long")
		case !syncTextFits(p.VideoID, maxSyncVideoIDRunes):
			return "", nil, errors.New("video_id is too long")
		case !syncTextFits(p.Episode, maxSyncEpisodeRunes):
			return "", nil, errors.New("episode is too long")
		case p.GroupIndex < 0 || p.EpisodeIndex < 0:
			return "", nil, errors.New("indexes must be non-negative")
		case !syncSecondsValid(p.ProgressSec) || !syncSecondsValid(p.DurationSec):
			return "", nil, errors.New("progress and duration must be finite and non-negative")
		}
		key, payload = NormalizeSyncKey(p.Title), p
	case SyncKindFavorite:
		var p FavoritePayload
		if err := decodeSyncPayload(raw, &p); err != nil {
			return "", nil, err
		}
		p.Title = trimSyncText(p.Title)
		p.Cover = trimSyncText(p.Cover)
		p.Type = trimSyncText(p.Type)
		p.Year = trimSyncText(p.Year)
		p.Rate = trimSyncText(p.Rate)
		p.Desc = trimSyncText(p.Desc)
		p.SourceKey = trimSyncText(p.SourceKey)
		p.VideoID = trimSyncText(p.VideoID)
		switch {
		case !syncTextFits(p.Title, maxSyncTitleRunes):
			return "", nil, errors.New("title is too long")
		case !syncTextFits(p.Cover, maxSyncCoverRunes):
			return "", nil, errors.New("cover is too long")
		case !syncTextFits(p.Type, maxSyncShortRunes),
			!syncTextFits(p.Year, maxSyncShortRunes),
			!syncTextFits(p.Rate, maxSyncShortRunes):
			return "", nil, errors.New("type, year, and rate are limited to 64 characters")
		case !syncTextFits(p.Desc, maxSyncDescRunes):
			return "", nil, errors.New("desc is too long")
		case !syncTextFits(p.SourceKey, maxSyncSourceKeyRunes):
			return "", nil, errors.New("source_key is too long")
		case !syncTextFits(p.VideoID, maxSyncVideoIDRunes):
			return "", nil, errors.New("video_id is too long")
		}
		key, payload = NormalizeSyncKey(p.Title), p
	case SyncKindSearch:
		var p SearchPayload
		if err := decodeSyncPayload(raw, &p); err != nil {
			return "", nil, err
		}
		p.Query = trimSyncText(p.Query)
		if !syncTextFits(p.Query, maxSyncQueryRunes) {
			return "", nil, errors.New("query is too long")
		}
		key, payload = NormalizeSyncKey(p.Query), p
	default:
		return "", nil, fmt.Errorf("unknown kind %q", kind)
	}
	if key == "" {
		return "", nil, errors.New("key is empty")
	}
	if utf8.RuneCountInString(key) > MaxSyncKeyRunes {
		return "", nil, errors.New("key is too long")
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return "", nil, fmt.Errorf("encode payload: %w", err)
	}
	return key, out, nil
}

// SyncRecord is one keyed record as stored and returned by the sync API.
//
// SyncRecord 是同步接口保存并返回的一条带 key 的记录.
type SyncRecord struct {
	Kind        SyncKind        `json:"kind"`
	Key         string          `json:"key"`
	Payload     json.RawMessage `json:"payload"`
	EventTimeMS int64           `json:"event_time_ms"`
	Deleted     bool            `json:"deleted"`
	Rev         int64           `json:"rev"`
}

// SyncClear is the clear watermark of one kind.
//
// SyncClear 是某类数据的清空时间点.
type SyncClear struct {
	Kind        SyncKind `json:"kind"`
	ClearedAtMS int64    `json:"cleared_at_ms"`
	Rev         int64    `json:"rev"`
}

// SyncChange is one client change inside a push request.
//
// SyncChange 是推送请求中的一条客户端变更.
type SyncChange struct {
	Kind        SyncKind        `json:"kind"`
	Op          SyncOp          `json:"op"`
	Key         string          `json:"key,omitempty"`
	Payload     json.RawMessage `json:"payload,omitempty"`
	EventTimeMS int64           `json:"event_time_ms"`
}

// SyncResult reports the outcome of one pushed change.
// Record is the server's current row for the key, or null when none exists.
//
// SyncResult 报告一条推送变更的结果. Record 是服务端该 key 当前的记录, 不存在时为 null.
type SyncResult struct {
	Index  int         `json:"index"`
	Status SyncStatus  `json:"status"`
	Record *SyncRecord `json:"record"`
	Clear  *SyncClear  `json:"clear,omitempty"`
	Reason string      `json:"reason,omitempty"`
}

// SyncPullPage is one page of changes ordered by revision.
//
// SyncPullPage 是按版本号排序的一页变更.
type SyncPullPage struct {
	Rev     int64        `json:"rev"`
	Reset   bool         `json:"reset"`
	HasMore bool         `json:"has_more"`
	Clears  []SyncClear  `json:"clears"`
	Records []SyncRecord `json:"records"`
}
