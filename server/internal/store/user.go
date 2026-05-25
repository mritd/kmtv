package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"golang.org/x/crypto/bcrypt"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// HashPassword returns a bcrypt hash of the given password.
// HashPassword 返回给定密码的 bcrypt hash.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(hash), nil
}

// CheckPassword reports whether the given password matches the bcrypt hash.
// CheckPassword 判断给定密码是否匹配 bcrypt hash.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// ValidateUsername checks that a username is valid (alphanumeric, dash, underscore, 1-32 chars).
// ValidateUsername 检查用户名是否合法, 仅允许字母, 数字, dash, underscore, 长度 1-32.
func ValidateUsername(username string) error {
	if len(username) == 0 || len(username) > 32 {
		return fmt.Errorf("username must be 1-32 characters: %w", errs.ErrInvalidUsername)
	}
	for _, c := range username {
		if !isUsernameChar(c) {
			return fmt.Errorf("username contains invalid character: %c: %w", c, errs.ErrInvalidUsername)
		}
	}
	return nil
}

func isUsernameChar(c rune) bool {
	return c >= 'a' && c <= 'z' ||
		c >= 'A' && c <= 'Z' ||
		c >= '0' && c <= '9' ||
		c == '-' ||
		c == '_'
}

// CreateUser inserts a new user with a bcrypt-hashed password.
// CreateUser 插入一个新用户, 并使用 bcrypt hash 保存密码.
func (s *Store) CreateUser(username, password, role string) (int64, error) {
	if err := ValidateUsername(username); err != nil {
		return 0, err
	}
	existing, err := s.GetUserByUsername(username)
	if err != nil {
		return 0, fmt.Errorf("check username conflict: %w", err)
	}
	if existing != nil {
		return 0, errs.ErrUsernameTaken
	}

	hash, err := HashPassword(password)
	if err != nil {
		return 0, err
	}

	result, err := s.db.Exec(
		`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
		username, hash, role,
	)
	if err != nil {
		if isUniqueConstraint(err) {
			return 0, fmt.Errorf("create user: %w", errs.ErrUsernameTaken)
		}
		return 0, fmt.Errorf("create user: %w", err)
	}
	return result.LastInsertId()
}

// GetUserByID retrieves a user by ID.
// GetUserByID 根据 ID 获取用户.
func (s *Store) GetUserByID(id int64) (*model.User, error) {
	var u model.User
	err := s.db.QueryRow(
		`SELECT id, username, password, avatar, role, created_at, updated_at FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.Username, &u.Password, &u.Avatar, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return &u, nil
}

// GetUserByUsername retrieves a user by username.
// GetUserByUsername 根据用户名获取用户.
func (s *Store) GetUserByUsername(username string) (*model.User, error) {
	var u model.User
	err := s.db.QueryRow(
		`SELECT id, username, password, avatar, role, created_at, updated_at FROM users WHERE username = ?`, username,
	).Scan(&u.ID, &u.Username, &u.Password, &u.Avatar, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by username: %w", err)
	}
	return &u, nil
}

// ListUsers retrieves all users ordered by ID.
// ListUsers 按 ID 顺序获取所有用户.
func (s *Store) ListUsers() ([]model.User, error) {
	rows, err := s.db.Query(
		`SELECT id, username, role, created_at, updated_at FROM users ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var users []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate users: %w", err)
	}
	return users, nil
}

// UpdateUser updates a user's username and role.
// UpdateUser 更新用户的用户名和角色.
func (s *Store) UpdateUser(id int64, username, role string) error {
	result, err := s.db.Exec(
		`UPDATE users SET username = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		username, role, id,
	)
	if err != nil {
		if isUniqueConstraint(err) {
			return fmt.Errorf("update user: %w", errs.ErrUsernameTaken)
		}
		return fmt.Errorf("update user: %w", err)
	}
	return checkRowsAffected(result)
}

// UpdateUserPassword updates a user's password with a new bcrypt hash.
// UpdateUserPassword 使用新的 bcrypt hash 更新用户密码.
func (s *Store) UpdateUserPassword(id int64, password string) error {
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	result, err := s.db.Exec(
		`UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		hash, id,
	)
	if err != nil {
		return fmt.Errorf("update user password: %w", err)
	}
	return checkRowsAffected(result)
}

// UpdateUsername updates a user's username after validating and checking for conflicts.
// UpdateUsername 校验并检查冲突后更新用户名.
func (s *Store) UpdateUsername(id int64, newUsername string) error {
	if err := ValidateUsername(newUsername); err != nil {
		return err
	}

	existing, err := s.GetUserByUsername(newUsername)
	if err != nil {
		return fmt.Errorf("check username conflict: %w", err)
	}
	if existing != nil && existing.ID != id {
		return errs.ErrUsernameTaken
	}

	result, err := s.db.Exec(
		`UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		newUsername, id,
	)
	if err != nil {
		if isUniqueConstraint(err) {
			return fmt.Errorf("update username: %w", errs.ErrUsernameTaken)
		}
		return fmt.Errorf("update username: %w", err)
	}
	return checkRowsAffected(result)
}

// CountAdminUsers returns the number of users with admin role.
// CountAdminUsers 返回 admin 角色用户数量.
func (s *Store) CountAdminUsers() (int64, error) {
	var count int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count admin users: %w", err)
	}
	return count, nil
}

// DeleteUser deletes a user by ID.
// DeleteUser 根据 ID 删除用户.
func (s *Store) DeleteUser(id int64) error {
	result, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	return checkRowsAffected(result)
}

// UpdateUserFull updates username, role, and optionally password in a single transaction.
// UpdateUserFull 在单个事务中更新用户名, 角色和可选密码.
func (s *Store) UpdateUserFull(id int64, username, role, password string) error {
	if err := ValidateUsername(username); err != nil {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now()
	result, err := tx.Exec(
		`UPDATE users SET username = ?, role = ?, updated_at = ? WHERE id = ?`,
		username, role, now, id,
	)
	if err != nil {
		if isUniqueConstraint(err) {
			return fmt.Errorf("update user: %w", errs.ErrUsernameTaken)
		}
		return fmt.Errorf("update user: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check rows affected: %w", err)
	}
	if n == 0 {
		return errs.ErrNotFound
	}

	if password != "" {
		hash, err := HashPassword(password)
		if err != nil {
			return fmt.Errorf("hash password: %w", err)
		}
		if _, err := tx.Exec(
			`UPDATE users SET password = ?, updated_at = ? WHERE id = ?`,
			hash, now, id,
		); err != nil {
			return fmt.Errorf("update user password: %w", err)
		}
	}

	return tx.Commit()
}

// isUniqueConstraint reports whether SQLite rejected a write because of a unique constraint.
// isUniqueConstraint 判断 SQLite 是否因为 unique constraint 拒绝写入.
func isUniqueConstraint(err error) bool {
	var sqliteErr *sqlite.Error
	return errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}

// UpdateAvatar stores a base64 data URL as the user's avatar.
// UpdateAvatar 将 base64 data URL 保存为用户头像.
func (s *Store) UpdateAvatar(id int64, avatar string) error {
	result, err := s.db.Exec(
		`UPDATE users SET avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		avatar, id,
	)
	if err != nil {
		return fmt.Errorf("update avatar: %w", err)
	}
	return checkRowsAffected(result)
}

// GetAvatar returns the base64 data URL for the given username's avatar.
// GetAvatar 返回指定用户名头像的 base64 data URL.
func (s *Store) GetAvatar(username string) (string, error) {
	var avatar string
	err := s.db.QueryRow(`SELECT avatar FROM users WHERE username = ?`, username).Scan(&avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get avatar: %w", err)
	}
	return avatar, nil
}

// DeleteAvatar sets the avatar to an empty string.
// DeleteAvatar 将头像设置为空字符串.
func (s *Store) DeleteAvatar(id int64) error {
	result, err := s.db.Exec(
		`UPDATE users SET avatar = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		id,
	)
	if err != nil {
		return fmt.Errorf("delete avatar: %w", err)
	}
	return checkRowsAffected(result)
}
