// English. 中文.
// English shared phrases reused across modules.
// 跨模块复用的英文通用文本.

const common = {
  brand: "KMTV",
  actions: { confirm: "Confirm", cancel: "Cancel", retry: "Retry", close: "Close" },
  states: { loading: "Loading", error: "Something went wrong" },
} as const;

export default common;
