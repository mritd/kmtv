// Strongly typed navigation parameter lists for root + tab + per-tab native-stacks.
// 根导航、Tab 导航与各 Tab 内 native-stack 的强类型参数列表.

import type { NavigatorScreenParams } from "@react-navigation/native";

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
 * Search route params shared by HomeStack and CategoriesStack.
 * Search 路由参数, HomeStack 与 CategoriesStack 共用.
 */
export type SearchRouteParams = { initialQuery?: string } | undefined;

/**
 * HomeTab's nested native-stack: HomeRoot + Search.
 * HomeTab 内的 native-stack: HomeRoot + Search.
 */
export type HomeStackParamList = {
  HomeRoot: undefined;
  Search: SearchRouteParams;
};

/**
 * CategoriesTab's nested native-stack: CategoriesRoot + Search.
 * CategoriesTab 内的 native-stack: CategoriesRoot + Search.
 */
export type CategoriesStackParamList = {
  CategoriesRoot: undefined;
  Search: SearchRouteParams;
};

/**
 * Bottom tabs. Each tab will host its own stack in later milestones.
 * 底部 Tab. 后续里程碑各 Tab 内部将托管独立 stack.
 */
export type TabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  CategoriesTab: NavigatorScreenParams<CategoriesStackParamList>;
  FavoritesTab: undefined;
  MeTab: undefined;
};
