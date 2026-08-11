package service

import (
	"fmt"
	"math"
	"strings"
	"testing"

	"github.com/mritd/kmtv/internal/model"
)

func TestSearchComparisonKey(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "chinese whitespace",
			input: "庆余年 第二季",
			want:  "庆余年第二季",
		},
		{
			name:  "chinese punctuation",
			input: "庆余年: 第二季",
			want:  "庆余年:第二季",
		},
		{
			name:  "latin case and whitespace",
			input: "The Matrix",
			want:  "thematrix",
		},
		{
			name:  "ascii punctuation",
			input: "THE-MATRIX",
			want:  "the-matrix",
		},
		{
			name:  "full width ascii",
			input: "ＴＨＥ ＭＡＴＲＩＸ ２",
			want:  "thematrix2",
		},
		{
			name:  "full width punctuation and spaces",
			input: "　ＴＨＥ：ＭＡＴＲＩＸ！２　",
			want:  "the：matrix！2",
		},
		{
			name:  "controls removed",
			input: "庆余年\u0000第二季",
			want:  "庆余年第二季",
		},
		{
			name:  "empty input",
			input: "",
			want:  "",
		},
		{
			name:  "long input capped",
			input: strings.Repeat("a", maxSearchNormalizedRunes+12),
			want:  strings.Repeat("a", maxSearchNormalizedRunes),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := searchComparisonKey(tt.input); got != tt.want {
				t.Fatalf("searchComparisonKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestSearchRankKeyTiers(t *testing.T) {
	tests := []struct {
		name           string
		query          string
		title          string
		year           string
		wantTier       searchMatchTier
		wantSimilarity float64
	}{
		{
			name:           "exact title",
			query:          "The Matrix",
			title:          "THE MATRIX",
			wantTier:       searchTierExact,
			wantSimilarity: 1,
		},
		{
			name:           "exact title plus year",
			query:          "沙丘2021",
			title:          "沙丘",
			year:           "2021",
			wantTier:       searchTierExact,
			wantSimilarity: 1,
		},
		{
			name:     "prefix",
			query:    "庆余年",
			title:    "庆余年 第二季",
			wantTier: searchTierPrefix,
		},
		{
			name:     "substring",
			query:    "matrix",
			title:    "The Matrix Reloaded",
			wantTier: searchTierSubstring,
		},
		{
			name:     "fuzzy positive overlap",
			query:    "庆余年2",
			title:    "庆余年第二季",
			wantTier: searchTierFuzzy,
		},
		{
			name:     "unrelated zero overlap",
			query:    "沙丘",
			title:    "The Matrix",
			wantTier: searchTierUnrelated,
		},
		{
			name:     "multi rune query does not fuzzy match one rune title",
			query:    "沙丘",
			title:    "沙",
			wantTier: searchTierUnrelated,
		},
		{
			name:     "empty query",
			query:    "",
			title:    "沙丘",
			wantTier: searchTierUnrelated,
		},
		{
			name:     "empty title",
			query:    "沙丘",
			title:    "",
			wantTier: searchTierUnrelated,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildSearchRankKey(tt.query, tt.title, tt.year)
			if got.tier != tt.wantTier {
				t.Fatalf("buildSearchRankKey(%q, %q, %q).tier = %d, want %d", tt.query, tt.title, tt.year, got.tier, tt.wantTier)
			}
			if tt.wantSimilarity != 0 && !almostEqual(got.similarity, tt.wantSimilarity) {
				t.Fatalf("buildSearchRankKey(%q, %q, %q).similarity = %f, want %f", tt.query, tt.title, tt.year, got.similarity, tt.wantSimilarity)
			}
			if got.similarity < 0 || got.similarity > 1 {
				t.Fatalf("buildSearchRankKey(%q, %q, %q).similarity = %f, want bounded [0, 1]", tt.query, tt.title, tt.year, got.similarity)
			}
		})
	}
}

func TestSearchNGramSimilarity(t *testing.T) {
	tests := []struct {
		name  string
		query string
		title string
		want  float64
	}{
		{
			name:  "identical strings",
			query: "庆余年",
			title: "庆余年",
			want:  1,
		},
		{
			name:  "repeated bigrams counted",
			query: "aaaa",
			title: "aaab",
			want:  2.0 / 3.0,
		},
		{
			name:  "one rune overlap",
			query: "沙",
			title: "沙丘",
			want:  0.5,
		},
		{
			name:  "multi rune query and one rune title",
			query: "沙丘",
			title: "沙",
			want:  0,
		},
		{
			name:  "empty query",
			query: "",
			title: "沙丘",
			want:  0,
		},
		{
			name:  "empty title",
			query: "沙丘",
			title: "",
			want:  0,
		},
		{
			name:  "zero overlap",
			query: "沙丘",
			title: "黑客",
			want:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := searchNGramSimilarity(tt.query, tt.title)
			if !almostEqual(got, tt.want) {
				t.Fatalf("searchNGramSimilarity(%q, %q) = %f, want %f", tt.query, tt.title, got, tt.want)
			}
			if got < 0 || got > 1 {
				t.Fatalf("searchNGramSimilarity(%q, %q) = %f, want bounded [0, 1]", tt.query, tt.title, got)
			}
		})
	}
}

func TestSearchNGramSimilaritySymmetry(t *testing.T) {
	tests := []struct {
		name  string
		left  string
		right string
	}{
		{
			name:  "latin",
			left:  "matrix",
			right: "matrices",
		},
		{
			name:  "chinese",
			left:  "庆余年第二季",
			right: "庆余年2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			forward := searchNGramSimilarity(tt.left, tt.right)
			reverse := searchNGramSimilarity(tt.right, tt.left)
			if !almostEqual(forward, reverse) {
				t.Fatalf("searchNGramSimilarity is not symmetric: %q/%q = %f, %q/%q = %f", tt.left, tt.right, forward, tt.right, tt.left, reverse)
			}
		})
	}
}

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < 0.000001
}

func BenchmarkSortSearchEntries500(b *testing.B) {
	fixture := make([]searchResultEntry, 500)
	for i := range fixture {
		title := fmt.Sprintf("Bounded Fixture Title %03d Season %02d", i, i%12)
		if i%10 == 0 {
			title = fmt.Sprintf("Exact Title %03d", i)
		}
		fixture[i] = searchResultEntry{
			result: model.SearchResult{
				Title: title,
				Type:  "movie",
				Year:  fmt.Sprintf("20%02d", i%30),
				Cover: "cover.jpg",
				Desc:  "fixture description",
				Sources: []model.SourceResult{
					{
						SourceKey:  fmt.Sprintf("source-%03d-a.example", i),
						SourceName: "Source A",
						VideoID:    fmt.Sprintf("%d-a", i),
						Duration:   float64((i % 50) + 1),
						Episodes:   []model.Episode{{Name: "ep1", URL: "url1"}},
					},
					{
						SourceKey:  fmt.Sprintf("source-%03d-b.example", i),
						SourceName: "Source B",
						VideoID:    fmt.Sprintf("%d-b", i),
						Duration:   float64((i % 75) + 5),
						Episodes:   []model.Episode{{Name: "ep1", URL: "url2"}},
					},
				},
			},
			fastest:       float64((i % 50) + 1),
			originalIndex: i,
		}
	}

	work := make([]searchResultEntry, len(fixture))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		copy(work, fixture)
		b.StartTimer()

		rankSearchEntries("Exact Title 240", work)
	}
}
