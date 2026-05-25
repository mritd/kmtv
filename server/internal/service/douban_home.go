package service

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/sirupsen/logrus"

	"github.com/mritd/kmtv/internal/utils"
)

type homeSectionResult struct {
	index   int
	section HomeSection
	ok      bool
}

const (
	homeSectionItemLimit              = 24
	homeHeroDescriptionCandidateLimit = 18
	homeHeroDescriptionConcurrency    = 4
)

type homeHeroDescriptionJob struct {
	sectionIndex int
	itemIndex    int
	kind         string
	id           string
}

type homeHeroDescriptionResult struct {
	sectionIndex int
	itemIndex    int
	desc         string
}

// GetHomeSections fetches all home page sections in parallel.
// GetHomeSections 并行获取所有首页内容分区.
func (ds *DoubanService) GetHomeSections(ctx context.Context) []HomeSection {
	defs := []homeSectionDef{
		{Name: "热门电影", Tag: "热门", Type: "movie", Kind: "movie", Category: "热门", MediaType: "全部"},
		{Name: "热门剧集", Tag: "tv", Type: "tv", Kind: "tv", Category: "tv", MediaType: "tv"},
		{Name: "热门综艺", Tag: "show", Type: "tv", Kind: "tv", Category: "show", MediaType: "show"},
	}

	type sectionJob struct {
		index int
		def   homeSectionDef
		anime bool
	}

	// animeIndex is where the anime section is inserted in the results slice.
	// animeIndex 表示动漫分区插入 results 切片的位置.
	animeIndex := 2
	results := make([]homeSectionResult, len(defs)+1)
	sectionJobs := make([]sectionJob, 0, len(defs))
	for i, def := range defs {
		actualIdx := i
		if i >= animeIndex {
			actualIdx = i + 1
		}
		sectionJobs = append(sectionJobs, sectionJob{index: actualIdx, def: def})
	}
	sectionJobs = append(sectionJobs, sectionJob{index: animeIndex, anime: true})

	// Fetch all home sections through the shared helper to keep top-level parallelism.
	// 通过共享 helper 拉取所有首页分区, 保持顶层并发语义.
	sectionResults, _ := utils.GoProcess(ctx, sectionJobs, len(sectionJobs), false, func(ctx context.Context, job sectionJob) (homeSectionResult, error) {
		if job.anime {
			return ds.fetchAnimeHomeSection(ctx, job.index), nil
		}
		return ds.fetchStandardHomeSection(ctx, job.index, job.def), nil
	})
	for _, r := range sectionResults {
		results[r.index] = r
	}

	var sections []HomeSection
	for _, r := range results {
		if r.ok && len(r.section.Items) > 0 {
			sections = append(sections, r.section)
		}
	}
	ds.enrichHomeHeroDescriptions(ctx, sections)
	return sections
}

// fetchStandardHomeSection fetches one non-anime home section.
// fetchStandardHomeSection 拉取一个非动漫首页分区.
func (ds *DoubanService) fetchStandardHomeSection(ctx context.Context, index int, def homeSectionDef) homeSectionResult {
	items, err := ds.GetRecentHot(ctx, def.Kind, def.Category, def.MediaType, 0, homeSectionItemLimit)
	if err != nil {
		logrus.WithError(err).WithField("section", def.Name).Warn("failed to fetch home section")
		return homeSectionResult{index: index}
	}
	ds.RewriteCovers(items)
	return homeSectionResult{
		index: index,
		section: HomeSection{
			Name:  def.Name,
			Tag:   def.Tag,
			Type:  def.Type,
			Items: items,
		},
		ok: true,
	}
}

// fetchAnimeHomeSection fetches the anime section from TV and movie sources in parallel.
// fetchAnimeHomeSection 从剧集和电影来源并发拉取动漫分区.
func (ds *DoubanService) fetchAnimeHomeSection(ctx context.Context, index int) homeSectionResult {
	type animeDef struct {
		name      string
		kind      string
		category  string
		mediaType string
	}

	animeDefs := []animeDef{
		{name: "anime TV", kind: "tv", category: "动画", mediaType: "电视剧"},
		{name: "anime movie", kind: "movie", category: "动画"},
	}

	// Fetch anime sources through the shared helper and keep partial success.
	// 通过共享 helper 拉取动漫来源, 并保留部分成功结果.
	animeItems, _ := utils.GoProcess(ctx, animeDefs, len(animeDefs), false, func(ctx context.Context, def animeDef) ([]DoubanItem, error) {
		items, err := ds.GetRecommendByFilters(ctx, def.kind, def.category, def.mediaType, "", 0, homeSectionItemLimit)
		if err != nil {
			logrus.WithError(err).WithField("section", def.name).Warn("failed to fetch anime section")
			return nil, nil
		}
		return items, nil
	})

	// Merge results from both sources.
	// 合并两个来源的结果.
	var merged []DoubanItem
	for _, items := range animeItems {
		merged = append(merged, items...)
	}
	if len(merged) > 0 {
		// Sort by rating descending, empty rates last.
		// 按评分降序排序, 空评分放在最后.
		slices.SortStableFunc(merged, func(a, b DoubanItem) int {
			ra, rb := a.Rate, b.Rate
			if ra == rb {
				return 0
			}
			if ra == "" {
				return 1
			}
			if rb == "" {
				return -1
			}
			fa, _ := strconv.ParseFloat(ra, 64)
			fb, _ := strconv.ParseFloat(rb, 64)
			if fb > fa {
				return 1
			} else if fb < fa {
				return -1
			}
			return 0
		})

		// Keep the home rails broad enough to avoid repeating the same short shelf.
		if len(merged) > homeSectionItemLimit {
			merged = merged[:homeSectionItemLimit]
		}

		ds.RewriteCovers(merged)
		return homeSectionResult{
			index: index,
			section: HomeSection{
				Name:  "热门动漫",
				Tag:   "anime",
				Type:  "tv",
				Items: merged,
			},
			ok: true,
		}
	}

	return homeSectionResult{index: index}
}

func collectHomeHeroDescriptionJobs(sections []HomeSection, limit int) []homeHeroDescriptionJob {
	jobs := make([]homeHeroDescriptionJob, 0, limit)
	for itemIndex := 0; len(jobs) < limit; itemIndex++ {
		addedAtDepth := false
		for sectionIndex := range sections {
			if itemIndex >= len(sections[sectionIndex].Items) {
				continue
			}
			item := sections[sectionIndex].Items[itemIndex]
			kind := item.Kind
			if kind == "" {
				kind = sections[sectionIndex].Type
			}
			if kind != "movie" && kind != "tv" {
				continue
			}
			id := strings.TrimSpace(item.ID)
			if id == "" || strings.TrimSpace(item.Title) == "" {
				continue
			}
			jobs = append(jobs, homeHeroDescriptionJob{sectionIndex: sectionIndex, itemIndex: itemIndex, kind: kind, id: id})
			addedAtDepth = true
			if len(jobs) >= limit {
				return jobs
			}
		}
		if !addedAtDepth {
			return jobs
		}
	}
	return jobs
}

func (ds *DoubanService) enrichHomeHeroDescriptions(ctx context.Context, sections []HomeSection) {
	jobs := collectHomeHeroDescriptionJobs(sections, homeHeroDescriptionCandidateLimit)
	results, _ := utils.GoProcess(ctx, jobs, homeHeroDescriptionConcurrency, false, func(ctx context.Context, job homeHeroDescriptionJob) (homeHeroDescriptionResult, error) {
		desc, err := ds.GetSubjectDescription(ctx, job.kind, job.id)
		if err != nil {
			logrus.WithError(err).WithField("douban_id", job.id).Debug("failed to enrich home hero description")
			return homeHeroDescriptionResult{sectionIndex: job.sectionIndex, itemIndex: job.itemIndex}, nil
		}
		return homeHeroDescriptionResult{sectionIndex: job.sectionIndex, itemIndex: job.itemIndex, desc: strings.TrimSpace(desc)}, nil
	})

	for _, result := range results {
		if result.desc == "" || result.sectionIndex >= len(sections) || result.itemIndex >= len(sections[result.sectionIndex].Items) {
			continue
		}
		sections[result.sectionIndex].Items[result.itemIndex].Desc = result.desc
	}
}
