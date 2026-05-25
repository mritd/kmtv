package service

// GetCategories returns a structured list of Douban category groups.
// GetCategories 返回结构化的 Douban 分类组列表.
func (ds *DoubanService) GetCategories() []CategoryGroup {
	return []CategoryGroup{
		{
			Key:        "movie",
			Name:       "电影",
			DoubanKind: "movie",
			SubCategories: []SubCategory{
				{Name: "全部", Tag: ""},
				{Name: "热门", Tag: "热门"},
				{Name: "最新", Tag: "最新"},
				{Name: "豆瓣高分", Tag: "豆瓣高分"},
				{Name: "冷门佳片", Tag: "冷门佳片"},
			},
			Regions: []Region{
				{Name: "全部", Value: ""},
				{Name: "华语", Value: "华语"},
				{Name: "欧美", Value: "欧美"},
				{Name: "韩国", Value: "韩国"},
				{Name: "日本", Value: "日本"},
			},
		},
		{
			Key:        "tv",
			Name:       "剧集",
			DoubanKind: "tv",
			Format:     "电视剧",
			SubCategories: []SubCategory{
				{Name: "全部", Tag: ""},
				{Name: "热门", Tag: "热门"},
			},
			Regions: []Region{
				{Name: "全部", Value: ""},
				{Name: "国产", Value: "华语"},
				{Name: "欧美", Value: "欧美"},
				{Name: "日本", Value: "日本"},
				{Name: "韩国", Value: "韩国"},
			},
		},
		{
			Key:        "anime",
			Name:       "动画",
			DoubanKind: "tv",
			Format:     "电视剧",
			SubCategories: []SubCategory{
				{Name: "番剧", Tag: "动画"},
				{Name: "剧场版", Tag: "动画", Kind: "movie"},
			},
			Regions: []Region{},
		},
		{
			Key:        "show",
			Name:       "综艺",
			DoubanKind: "tv",
			Format:     "综艺",
			SubCategories: []SubCategory{
				{Name: "全部", Tag: ""},
				{Name: "热门", Tag: "热门"},
			},
			Regions: []Region{
				{Name: "全部", Value: ""},
				{Name: "国内", Value: "华语"},
				{Name: "国外", Value: "欧美"},
			},
		},
	}
}
