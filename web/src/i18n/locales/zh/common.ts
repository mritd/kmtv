const common = {
  brand: "KMTV",
  actions: {
    confirm: "确认",
    cancel: "取消",
    save: "保存",
    delete: "删除",
    edit: "编辑",
    create: "新建",
    close: "关闭",
    retry: "重试",
    import: "导入",
    sync: "同步",
    check: "检查",
    enable: "启用",
    disable: "停用",
    search: "搜索",
  },
  states: {
    loading: "加载中",
    empty: "暂无内容",
    error: "出错了",
    success: "成功",
  },
  pluralization: {
    items: "{{count}} 项",
  },
  date: {
    missing: "无时间",
  },
} as const;

export default common;
