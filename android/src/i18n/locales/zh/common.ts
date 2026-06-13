// Chinese shared phrases reused across modules.
// 跨模块复用的中文通用文本.

const common = {
  brand: "KMTV",
  actions: { confirm: "确认", cancel: "取消", retry: "重试", close: "关闭" },
  states: { loading: "加载中", error: "出错了" },
} as const;

export default common;
