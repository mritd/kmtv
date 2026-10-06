package service

import (
	"fmt"
	"strings"
	"testing"
)

const adFilterBase = "https://cdn.example.com/20260922/main/hls/"

// adPlaylist builds a VOD playlist shaped like the sources that insert ads: explicit-IV content
// under one directory, and clear ad runs under another, each run bracketed by discontinuities.
// Each entry of runs is "c<count>" for content or "a<count>" for an ad run.
//
// adPlaylist 构建与插入广告的源站相同结构的 VOD playlist: 正片带显式 IV 且位于同一目录, 明文广告段
// 位于另一目录, 每段广告前后都有 discontinuity. runs 的每一项为正片 "c<数量>" 或广告 "a<数量>".
func adPlaylist(runs ...string) string {
	var b strings.Builder
	b.WriteString("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:0\n")
	key := `#EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=0x00000000000000000000000000000000`
	b.WriteString(key + "\n")
	content, ad := 0, 0
	for i, run := range runs {
		var count int
		_, _ = fmt.Sscanf(run[1:], "%d", &count)
		if i > 0 {
			b.WriteString("#EXT-X-DISCONTINUITY\n")
		}
		if run[0] == 'a' {
			b.WriteString("#EXT-X-KEY:METHOD=NONE\n")
			for j := 0; j < count; j++ {
				fmt.Fprintf(&b, "#EXTINF:4.4,\n/20260917/ad/hls/ad%d.ts\n", ad%4)
				ad++
			}
			continue
		}
		if i > 0 {
			b.WriteString(key + "\n")
		}
		for j := 0; j < count; j++ {
			fmt.Fprintf(&b, "#EXTINF:2.0,\nc%04d.ts\n", content)
			content++
		}
	}
	b.WriteString("#EXT-X-ENDLIST")
	return b.String()
}

func segmentURIs(playlist string) []string {
	var uris []string
	for _, line := range strings.Split(playlist, "\n") {
		if line != "" && !strings.HasPrefix(line, "#") {
			uris = append(uris, line)
		}
	}
	return uris
}

func TestFilterInsertedAdsRemovesForeignRuns(t *testing.T) {
	input := adPlaylist("c40", "a4", "c30", "a4", "c20")
	got, stats := FilterInsertedAds(input, adFilterBase)

	if stats.Segments != 8 || stats.Seconds < 35.1 || stats.Seconds > 35.3 {
		t.Fatalf("stats = %+v, want 8 segments and 35.2 seconds", stats)
	}
	var want []string
	for i := 0; i < 90; i++ {
		want = append(want, fmt.Sprintf("c%04d.ts", i))
	}
	if uris := segmentURIs(got); strings.Join(uris, ",") != strings.Join(want, ",") {
		t.Fatalf("segments = %v, want %v", uris, want)
	}
	// One discontinuity stays at each removed ad, and every content key is still declared
	// before its segments.
	//
	// 每处被移除的广告保留一个 discontinuity, 每段正片在其分片之前仍声明 key.
	if n := strings.Count(got, "#EXT-X-DISCONTINUITY\n"); n != 2 {
		t.Fatalf("discontinuities = %d, want 2:\n%s", n, got)
	}
	if !strings.HasSuffix(got, "c0089.ts\n#EXT-X-ENDLIST") {
		t.Fatalf("playlist tail lost:\n%s", got)
	}
	lines := strings.Split(got, "\n")
	for i, line := range lines {
		if line == "c0040.ts" || line == "c0070.ts" {
			if !strings.HasPrefix(lines[i-2], "#EXT-X-KEY:METHOD=AES-128") {
				t.Fatalf("segment %s lost its key, preceded by %q", line, lines[i-2])
			}
		}
	}
}

func TestFilterInsertedAdsRemovesAPreRoll(t *testing.T) {
	got, stats := FilterInsertedAds(adPlaylist("a4", "c40", "a4", "c40"), adFilterBase)
	if stats.Segments != 8 {
		t.Fatalf("stats = %+v, want 8 segments", stats)
	}
	if strings.Count(got, "#EXT-X-DISCONTINUITY") != 1 || strings.Contains(got, "/ad/") {
		t.Fatalf("pre-roll not removed cleanly:\n%s", got)
	}
	if !strings.HasPrefix(segmentURIs(got)[0], "c0000") || len(segmentURIs(got)) != 80 {
		t.Fatalf("content lost:\n%s", got)
	}
}

func TestFilterInsertedAdsLeavesUnsafePlaylistsUnchanged(t *testing.T) {
	cases := map[string]string{
		"live playlist": strings.TrimSuffix(adPlaylist("c40", "a4", "c40"), "#EXT-X-ENDLIST"),
		"derived IVs": strings.ReplaceAll(adPlaylist("c40", "a4", "c40"),
			",IV=0x00000000000000000000000000000000", ""),
		"no discontinuity": strings.ReplaceAll(adPlaylist("c40", "a4", "c40"), "#EXT-X-DISCONTINUITY\n", ""),
		// A foreign run longer than an ad break is content from another directory.
		//
		// 比广告时段更长的外部目录段是来自另一目录的正片.
		"long foreign run": adPlaylist("c200", "a40", "c200"),
		// Foreign runs adding up to a large share of the episode are not ads.
		//
		// 累计占比很大的外部目录段不是广告.
		"large foreign share": adPlaylist("c10", "a4", "c10", "a4", "c10"),
		// A single foreign run is content spliced from another path, such as a short tail.
		//
		// 只出现一次的外部目录段是从其他路径拼接的正片, 例如较短的片尾.
		"single foreign run": adPlaylist("c40", "a4", "c40"),
		// An IV= inside the key URI is not an IV attribute.
		//
		// key URI 中的 IV= 不是 IV 属性.
		"IV only in key URI": strings.ReplaceAll(adPlaylist("c40", "a4", "c40", "a4", "c40"),
			`URI="key.key",IV=0x00000000000000000000000000000000`, `URI="key.php?IV=1"`),
		"master playlist": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nhigh/index.m3u8",
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			got, stats := FilterInsertedAds(input, adFilterBase)
			if got != input || stats.Segments != 0 {
				t.Fatalf("playlist changed (stats %+v):\n%s", stats, got)
			}
		})
	}
}

func TestFilterInsertedAdsKeepsRunsThatTouchTheMainDirectory(t *testing.T) {
	// The ad directory shares a run with content once, so it is not an ad directory anywhere.
	//
	// 广告目录有一次与正片同段, 因此在任何位置都不视为广告目录.
	input := strings.Replace(adPlaylist("c40", "a4", "c40", "a4", "c40"), "/20260917/ad/hls/ad1.ts", "c9999.ts", 1)
	got, stats := FilterInsertedAds(input, adFilterBase)
	if got != input || stats.Segments != 0 {
		t.Fatalf("mixed run removed (stats %+v):\n%s", stats, got)
	}
}

func TestFilterInsertedAdsIgnoresHostAndQuery(t *testing.T) {
	// Content rotating between CDN hosts and carrying signed queries is still one directory.
	//
	// 在多个 CDN 主机间轮换并带签名查询参数的正片仍属于同一目录.
	input := adPlaylist("c40", "a4", "c40", "a4", "c40")
	input = strings.Replace(input, "c0001.ts", "https://cdn2.example.com/20260922/main/hls/c0001.ts?sign=1", 1)
	input = strings.Replace(input, "c0044.ts", "c0044.ts?sign=2", 1)
	got, stats := FilterInsertedAds(input, adFilterBase)
	if stats.Segments != 8 {
		t.Fatalf("stats = %+v, want 8 segments", stats)
	}
	if len(segmentURIs(got)) != 120 {
		t.Fatalf("content lost:\n%s", got)
	}
}

func TestFilterInsertedAdsDropsTagsInsideRemovedRuns(t *testing.T) {
	input := adPlaylist("c40", "a4", "c40", "a4", "c40")
	input = strings.ReplaceAll(input, "#EXT-X-KEY:METHOD=NONE\n",
		"#EXT-X-CUE-OUT:DURATION=17.6\n#EXT-X-BITRATE:900\n#EXT-X-KEY:METHOD=NONE\n")
	input = strings.ReplaceAll(input, "/20260917/ad/hls/ad3.ts\n", "/20260917/ad/hls/ad3.ts\n#EXT-X-CUE-IN\n")
	got, stats := FilterInsertedAds(input, adFilterBase)
	if stats.Segments != 8 {
		t.Fatalf("stats = %+v, want 8 segments", stats)
	}
	for _, tag := range []string{"#EXT-X-CUE-OUT", "#EXT-X-CUE-IN", "#EXT-X-BITRATE"} {
		if strings.Contains(got, tag) {
			t.Fatalf("%s kept from a removed run:\n%s", tag, got)
		}
	}
	// Key state set inside the run stays, so the next content run still re-declares its key.
	//
	// 段内设置的 key 状态保留, 下一段正片仍会重新声明它的 key.
	if strings.Count(got, "#EXT-X-KEY:METHOD=NONE") != 2 {
		t.Fatalf("key tags of removed runs lost:\n%s", got)
	}
}

func TestHLSAttributes(t *testing.T) {
	got := hlsAttributes(`METHOD=AES-128,URI="k.php?a=1,IV=2",IV=0x01,KEYFORMAT="identity"`)
	want := map[string]string{"METHOD": "AES-128", "URI": "k.php?a=1,IV=2", "IV": "0x01", "KEYFORMAT": "identity"}
	if len(got) != len(want) {
		t.Fatalf("attrs = %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("attrs[%s] = %q, want %q (all %v)", k, got[k], v, got)
		}
	}
}
