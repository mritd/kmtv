// English shared phrases reused across modules.
// 跨模块复用的英文通用文本.

const common = {
  brand: "KMTV",
  actions: { confirm: "Confirm", cancel: "Cancel", retry: "Retry", close: "Close" },
  states: { loading: "Loading", error: "Something went wrong" },
  sync: {
    serverTooOld: "This server is too old to sync. Upgrade it to v1.1.0 or later; until then, history and favorites stay on this device.",
  },
} as const;

export default common;
