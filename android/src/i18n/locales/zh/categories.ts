const categories = {
  title: "分类",
  loading: "正在加载分类",
  retry: "重试",
  error: {
    title: "分类加载失败",
    description: "请检查网络后重试.",
  },
  empty: {
    title: "暂无结果",
    description: "调整筛选条件后重试.",
  },
  loadingMore: "加载更多",
} as const;

export default categories;
