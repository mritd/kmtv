const search = {
  title: "搜索",
  placeholder: "搜索影片...",
  history: {
    heading: "搜索历史",
    clear: "清空",
  },
  progress: {
    searching: "正在搜索可用源 {{completed}} / {{total}} ...",
    probing: "正在探测 CDN 可用性 {{completed}} / {{total}} ...",
    starting: "搜索中...",
  },
  empty: {
    noResults: "未找到结果",
  },
  error: {
    generic: "搜索失败",
    retry: "重试",
  },
} as const;

export default search;
