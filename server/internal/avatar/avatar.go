// Package avatar builds the avatar URLs the API returns and holds the default avatar served to
// users who have not uploaded one.
//
// Package avatar 构造 API 返回的头像 URL, 并保存未上传头像的用户所使用的默认头像.
package avatar

import (
	_ "embed"
	"fmt"
	"hash/fnv"
	"net/url"
)

// DefaultContentType is the media type of the default avatar.
//
// DefaultContentType 是默认头像的媒体类型.
const DefaultContentType = "image/gif"

// defaultVersion is the URL version of the default avatar; bump it when default.gif changes.
//
// defaultVersion 是默认头像 URL 中的版本; 替换 default.gif 时需要同步修改.
const defaultVersion = "default-1"

//go:embed default.gif
var defaultImage []byte

// Default returns the default avatar image, an animated pixel-art cat.
//
// Default 返回默认头像图片, 一只像素风动图猫咪.
func Default() []byte {
	return defaultImage
}

// URL returns the avatar URL for username and whether it points at the default avatar. stored is
// the user's stored avatar data URL, empty when none was uploaded. The `v` query changes whenever
// the image does, so a client or browser cache never serves a replaced avatar under the same URL.
//
// URL 返回 username 的头像 URL, 以及它是否指向默认头像. stored 是用户保存的头像 data URL, 未上传时为空.
// 查询参数 `v` 随图片变化而变化, 因此客户端或浏览器缓存不会在同一 URL 下返回已被替换的头像.
func URL(username, stored string) (string, bool) {
	version := defaultVersion
	if stored != "" {
		h := fnv.New64a()
		_, _ = h.Write([]byte(stored))
		version = fmt.Sprintf("%016x", h.Sum64())
	}
	return "/api/v1/avatar/" + url.PathEscape(username) + "?v=" + version, stored == ""
}
