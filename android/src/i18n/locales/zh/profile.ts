// Profile Tab 的中文文案.

const profile = {
  title: "我的",
  anonymous: "匿名用户",
  role: { admin: "管理员", user: "普通用户" },
  username: {
    placeholder: "用户名",
    edit: "修改用户名",
    confirm: "保存",
    cancel: "取消",
    updated: "用户名已更新",
  },
  avatar: {
    change: "更换头像",
    remove: "移除头像",
    updated: "头像已更新",
    removed: "头像已移除",
    permissionDenied: "未获得相册访问权限",
  },
  password: {
    title: "修改密码",
    current: "当前密码",
    next: "新密码",
    confirm: "确认新密码",
    save: "保存密码",
    mismatch: "两次输入的密码不一致",
    empty: "密码不能为空",
    changed: "密码已修改",
  },
  language: { title: "语言", options: { en: "English", zh: "中文" } },
  theme: { title: "主题", options: { system: "跟随系统", light: "浅色", dark: "深色" } },
  danger: {
    clearHistory: "清除观看历史",
    historyCleared: "观看历史已清除",
    signOut: "退出登录",
  },
  admin: { entry: "管理面板" },
} as const;

export default profile;
