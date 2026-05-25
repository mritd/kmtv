const account = {
  title: "个人设置",
  eyebrow: "账户",
  description: "管理个人信息, 退出登录和页面外观偏好.",
  profile: "账户信息",
  themeSection: "外观主题",
  changePassword: "修改密码",
  savePreferences: "保存偏好",
  usernameLabel: "用户名",
  saveProfile: "保存个人信息",
  logout: "退出登录",
  roleAdmin: "管理员",
  roleUser: "普通用户",
  anonymousBadge: "匿名访问",
  updateSuccess: "个人信息已更新, 重新登录后令牌快照会同步最新用户名.",
  updateFailed: "个人信息更新失败",
  avatar: {
    uploadButton: "上传头像",
    uploadPending: "上传中...",
    deleteButton: "删除头像",
    deletePending: "删除中...",
    uploadSuccess: "头像已更新",
    uploadFailed: "头像上传失败",
    deleteSuccess: "头像已删除",
    deleteFailed: "头像删除失败",
    errorType: "仅支持 JPEG, PNG, GIF, WEBP 格式",
    errorTooLarge: "图片不能超过 256 KB",
    hint: "支持 JPEG / PNG / GIF / WEBP, 不超过 256 KB",
  },
  loginPromptCard: {
    title: "登录以管理个人资料",
    description: "匿名模式下无法修改用户名, 头像或密码. 登录后可保存收藏并解锁更多功能.",
    action: "去登录",
  },
  theme: {
    sectionTitle: "页面主题",
    description: "主题只影响当前浏览器, 不会修改服务端系统设置.",
    customPaletteTitle: "自定义配色",
    customPaletteDescription: "自定义背景, 面板, 强调色和文字亮度.",
    resetButton: "恢复默认",
    themes: {
      graphite: {
        label: "石墨黑",
        description: "冷白与石墨黑, 安静电影主题.",
      },
      nocturne: {
        label: "夜曲蓝",
        description: "深蓝黑底, 雾蓝色克制点缀.",
      },
      "tech-purple": {
        label: "科技紫",
        description: "深空黑底, 科技紫色克制点缀.",
      },
    },
  },
} as const;

export default account;
