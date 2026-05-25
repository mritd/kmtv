const errors = {
  generic: "出错了, 请稍后重试.",
  network: "网络错误, 请检查连接.",
  unauthorized: "请先登录.",
  forbidden: "无权访问该资源.",
  notFound: "资源不存在.",
  validation: "输入有误, 请检查后重试.",
  saveFailed: "保存失败, 请稍后重试.",
  loadFailed: "加载失败, 请稍后重试.",
  importFailed: "导入失败, 请稍后重试.",
  invalidJSON: "JSON 格式无效.",
} as const;

export default errors;
