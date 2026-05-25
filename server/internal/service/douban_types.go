package service

import "strings"

// DoubanCategory represents a browsable category.
// DoubanCategory 表示可浏览分类.
type DoubanCategory struct {
	Name string `json:"name"`
	Type string `json:"type"` // movie, tv
}

// DoubanItem represents a single movie/TV item from Douban.
// DoubanItem 表示一个 Douban 影视条目.
type DoubanItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Cover string `json:"cover"`
	Rate  string `json:"rate"`
	Year  string `json:"year"`
	Desc  string `json:"desc,omitempty"`
	Kind  string `json:"-"`
}

type doubanSubjectDetailResponse struct {
	Intro       string `json:"intro"`
	Summary     string `json:"summary"`
	Description string `json:"description"`
	Abstract    string `json:"abstract"`
}

func (r doubanSubjectDetailResponse) bestDescription() string {
	for _, value := range []string{r.Intro, r.Summary, r.Description, r.Abstract} {
		if desc := strings.TrimSpace(value); desc != "" {
			return desc
		}
	}
	return ""
}

// doubanAPIItem is the raw JSON shape from the Douban API.
// doubanAPIItem 表示 Douban API 返回的原始 JSON 结构.
type doubanAPIItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Cover string `json:"cover"`
	Rate  string `json:"rate"`
	// Year is not directly in the API response; we leave it empty.
	// API 响应不直接包含 Year, 因此保持为空.
}

// recentHotItem is the raw JSON shape from the Douban recent_hot mobile API.
// recentHotItem 表示 Douban recent_hot 移动端 API 的原始 JSON 结构.
type recentHotItem struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	CardSubtitle string `json:"card_subtitle"`
	Pic          struct {
		Normal string `json:"normal"`
		Large  string `json:"large"`
	} `json:"pic"`
	Rating struct {
		Value float64 `json:"value"`
	} `json:"rating"`
}

type recentHotResponse struct {
	Items []recentHotItem `json:"items"`
}

// SubCategory represents a browsable subcategory/tag filter.
// SubCategory 表示可浏览的子分类或标签过滤器.
type SubCategory struct {
	Name   string `json:"name"`
	Tag    string `json:"tag"`
	Kind   string `json:"kind,omitempty"`   // overrides CategoryGroup.DoubanKind
	Format string `json:"format,omitempty"` // overrides CategoryGroup.Format
}

// Region represents a region filter option.
// Region 表示地区过滤选项.
type Region struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// CategoryGroup represents a top-level category group with subcategory and region filters.
// CategoryGroup 表示包含子分类和地区过滤器的顶层分类组.
type CategoryGroup struct {
	Key           string        `json:"key"`
	Name          string        `json:"name"`
	DoubanKind    string        `json:"douban_kind"`
	Format        string        `json:"format"`
	SubCategories []SubCategory `json:"subcategories"`
	Regions       []Region      `json:"regions"`
}

// recommendItem is the raw JSON shape from the Douban recommend mobile API.
// recommendItem 表示 Douban recommend 移动端 API 的原始 JSON 结构.
type recommendItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Type  string `json:"type"`
	Year  string `json:"year"`
	Pic   struct {
		Normal string `json:"normal"`
		Large  string `json:"large"`
	} `json:"pic"`
	Rating struct {
		Value float64 `json:"value"`
	} `json:"rating"`
}

type recommendResponse struct {
	Items []recommendItem `json:"items"`
}

// HomeSection represents a section on the home page.
// HomeSection 表示首页的一个内容分区.
type HomeSection struct {
	Name  string       `json:"name"`
	Tag   string       `json:"tag"`
	Type  string       `json:"type"`
	Items []DoubanItem `json:"items"`
}

type homeSectionDef struct {
	Name      string
	Tag       string
	Type      string
	Kind      string
	Category  string
	MediaType string
}
