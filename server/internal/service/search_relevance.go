package service

import (
	"math"
	"strings"
	"unicode"
)

const maxSearchNormalizedRunes = 128

type searchMatchTier int

const (
	searchTierExact searchMatchTier = iota
	searchTierPrefix
	searchTierSubstring
	searchTierFuzzy
	searchTierUnrelated
)

type searchRankKey struct {
	tier       searchMatchTier
	similarity float64
}

func searchComparisonKey(input string) string {
	var builder strings.Builder
	normalizedRunes := 0

	for _, r := range strings.TrimSpace(input) {
		r = foldFullWidthASCII(r)
		r = unicode.ToLower(r)
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			continue
		}

		builder.WriteRune(r)
		normalizedRunes++
		if normalizedRunes >= maxSearchNormalizedRunes {
			break
		}
	}

	return builder.String()
}

func foldFullWidthASCII(r rune) rune {
	switch {
	case r >= '０' && r <= '９':
		return '0' + (r - '０')
	case r >= 'Ａ' && r <= 'Ｚ':
		return 'A' + (r - 'Ａ')
	case r >= 'ａ' && r <= 'ｚ':
		return 'a' + (r - 'ａ')
	default:
		return r
	}
}

func buildSearchRankKey(query, title, year string) searchRankKey {
	return buildSearchRankKeyFromNormalizedQuery(searchComparisonKey(query), title, year)
}

func buildSearchRankKeyFromNormalizedQuery(normalizedQuery, title, year string) searchRankKey {
	normalizedTitle := searchComparisonKey(title)
	if normalizedQuery == "" || normalizedTitle == "" {
		return searchRankKey{tier: searchTierUnrelated}
	}

	similarity := searchNGramSimilarity(normalizedQuery, normalizedTitle)
	if normalizedTitle == normalizedQuery || normalizedTitle+searchComparisonKey(year) == normalizedQuery {
		return searchRankKey{tier: searchTierExact, similarity: 1}
	}
	if strings.HasPrefix(normalizedTitle, normalizedQuery) {
		return searchRankKey{tier: searchTierPrefix, similarity: similarity}
	}
	if strings.Contains(normalizedTitle, normalizedQuery) {
		return searchRankKey{tier: searchTierSubstring, similarity: similarity}
	}
	if similarity > 0 {
		return searchRankKey{tier: searchTierFuzzy, similarity: similarity}
	}
	return searchRankKey{tier: searchTierUnrelated}
}

func searchNGramSimilarity(query, title string) float64 {
	queryRunes := []rune(query)
	titleRunes := []rune(title)
	if len(queryRunes) == 0 || len(titleRunes) == 0 {
		return 0
	}

	if len(queryRunes) == 1 {
		return runeOverlapSimilarity(queryRunes, titleRunes)
	}
	if len(titleRunes) == 1 {
		return 0
	}

	queryGrams := runeBigramCounts(queryRunes)
	titleGrams := runeBigramCounts(titleRunes)
	overlap := 0
	for gram, queryCount := range queryGrams {
		if titleCount, ok := titleGrams[gram]; ok {
			overlap += min(queryCount, titleCount)
		}
	}

	denominator := max(len(queryRunes)-1, len(titleRunes)-1)
	if denominator == 0 {
		return 0
	}
	return boundedSimilarity(float64(overlap) / float64(denominator))
}

func runeOverlapSimilarity(queryRunes, titleRunes []rune) float64 {
	queryCounts := make(map[rune]int, len(queryRunes))
	for _, r := range queryRunes {
		queryCounts[r]++
	}

	overlap := 0
	for _, r := range titleRunes {
		if queryCounts[r] > 0 {
			overlap++
			queryCounts[r]--
		}
	}

	denominator := max(len(queryRunes), len(titleRunes))
	if denominator == 0 {
		return 0
	}
	return boundedSimilarity(float64(overlap) / float64(denominator))
}

func runeBigramCounts(runes []rune) map[[2]rune]int {
	counts := make(map[[2]rune]int, max(len(runes)-1, 0))
	for i := 0; i < len(runes)-1; i++ {
		counts[[2]rune{runes[i], runes[i+1]}]++
	}
	return counts
}

func boundedSimilarity(value float64) float64 {
	if value < 0 || math.IsNaN(value) {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}
