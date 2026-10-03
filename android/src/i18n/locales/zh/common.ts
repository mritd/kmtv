// Chinese shared phrases reused across modules.
// 跨模块复用的中文通用文本.

const common = {
  brand: "KMTV",
  actions: { confirm: "确认", cancel: "取消", retry: "重试", close: "关闭" },
  states: { loading: "加载中", error: "出错了" },
  sync: {
    serverTooOld: "服务器版本过旧, 无法同步. 请升级到 v1.1.0 或更高版本; 在此之前, 观看记录和收藏只保存在本机.",
  },
} as const;

export default common;
