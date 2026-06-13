// English. 中文.
// Strongly typed navigation parameter lists for root + tab navigators.
// 根导航与 Tab 导航的强类型参数列表.

/**
 * Root stack: bootstrap → serverSetup → mainTabs. No params at M1.
 * 根 stack: bootstrap → serverSetup → mainTabs. M1 阶段无参数.
 */
export type RootStackParamList = {
  Bootstrap: undefined;
  ServerSetup: undefined;
  MainTabs: undefined;
};

/**
 * Bottom tabs. Each tab will host its own stack in later milestones.
 * 底部 Tab. 后续里程碑各 Tab 内部将托管独立 stack.
 */
export type TabParamList = {
  HomeTab: undefined;
  CategoriesTab: undefined;
  FavoritesTab: undefined;
  MeTab: undefined;
};
