const nav = {
  links: {
    home: "首页",
    search: "搜索",
    categories: "分类",
    favorites: "收藏",
  },
  account: {
    menu: "账户菜单",
    profile: "个人设置",
    admin: "管理面板",
    logout: "退出登录",
    language: "语言",
    languages: { zh: "中文", en: "English" },
    login: "登录",
    anonymous: "匿名访问",
  },
} as const;

export default nav;
