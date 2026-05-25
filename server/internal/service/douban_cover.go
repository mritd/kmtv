package service

import (
	"net/url"
	"regexp"

	"github.com/mritd/kmtv/internal/consts"
)

// doubanCoverRe matches Douban image CDN hostnames like img1.doubanio.com.
// doubanCoverRe 匹配类似 img1.doubanio.com 的 Douban 图片 CDN 主机名.
var doubanCoverRe = regexp.MustCompile(`img\d+\.doubanio\.com`)

// RewriteCovers rewrites cover URLs based on the configured proxy mode.
// RewriteCovers 根据配置的代理模式重写封面 URL.
func (ds *DoubanService) RewriteCovers(items []DoubanItem) {
	mode, err := ds.store.GetSetting(consts.SettingDoubanImageProxy)
	if err != nil || mode == "" {
		// Default to the Tencent CDN mirror for lower latency than the server proxy.
		// 默认使用腾讯云 CDN 镜像, 比服务端代理延迟更低.
		mode = "tencent"
	}

	for i := range items {
		items[i].Cover = ds.rewriteCoverURL(items[i].Cover, mode)
	}
}

func (ds *DoubanService) rewriteCoverURL(rawURL, mode string) string {
	// Normalize CDN hostname because some subdomains, such as img9, have anti-crawl JS.
	// 规范化 CDN 主机名, 因为 img9 等部分子域存在反爬 JS.
	normalized := doubanCoverRe.ReplaceAllString(rawURL, "img2.doubanio.com")
	switch mode {
	case "tencent":
		return doubanCoverRe.ReplaceAllString(normalized, "img.doubanio.cmliussss.net")
	case "ali":
		return doubanCoverRe.ReplaceAllString(normalized, "img.doubanio.cmliussss.com")
	case "server":
		return "/api/v1/proxy/image?url=" + url.QueryEscape(normalized)
	default: // "direct"
		return normalized
	}
}
