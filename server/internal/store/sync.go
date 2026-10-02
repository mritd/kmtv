package store

import (
	"errors"
	"fmt"

	"github.com/mritd/kmtv/internal/consts"
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
