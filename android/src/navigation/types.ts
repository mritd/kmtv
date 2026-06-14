// Strongly typed navigation parameter lists for root + tab + per-tab native-stacks.
// 根导航、Tab 导航与各 Tab 内 native-stack 的强类型参数列表.

import type { NavigatorScreenParams } from "@react-navigation/native";

import type { PlayDestination } from "@/api/types";

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
 * Search resume hint comes from continue-watching. Search still refreshes sources from the server,
 * then uses this hint only to prefer the previous source when it remains available and to carry the
 * last watched episode into Player.
 * Search 续播提示来自继续观看. Search 仍会从 server 刷新源, 然后仅用该 hint 优先选择仍可用的旧源,
 * 并把上次观看集数带入 Player.
 */
export interface SearchResumeHint {
  title: string;
  sourceKey: string;
  videoId: string;
  coverHint: string;
  episodeIndex: number;
  episodeName: string;
}

/**
 * Search route params shared by HomeStack and CategoriesStack.
 * Search 路由参数, HomeStack 与 CategoriesStack 共用.
 */
export type SearchRouteParams = { initialQuery?: string; resumeHint?: SearchResumeHint } | undefined;

/**
 * HomeTab's nested native-stack: HomeRoot + Search + Player.
 * HomeTab 内的 native-stack: HomeRoot + Search + Player.
 */
export type HomeStackParamList = {
  HomeRoot: undefined;
  Search: SearchRouteParams;
  Player: PlayDestination;
};

/**
 * CategoriesTab's nested native-stack: CategoriesRoot + Search + Player.
 * CategoriesTab 内的 native-stack: CategoriesRoot + Search + Player.
 */
export type CategoriesStackParamList = {
  CategoriesRoot: undefined;
  Search: SearchRouteParams;
  Player: PlayDestination;
};

/**
 * FavoritesTab's nested native-stack: FavoritesRoot + Player.
 * FavoritesTab 内的 native-stack: FavoritesRoot + Player.
 */
export type FavoritesStackParamList = {
  FavoritesRoot: undefined;
  Player: PlayDestination;
};

/**
 * ProfileStack param list — root profile + admin panel + four admin sub-screens.
 * ProfileStack 路由表 — 根 profile + 管理面板 + 四个管理子页面.
 */
export type ProfileStackParamList = {
  ProfileRoot: undefined;
  AdminPanel: undefined;
  AdminSources: undefined;
  AdminSubscriptions: undefined;
  AdminUsers: undefined;
  AdminSettings: undefined;
  Diagnostics: undefined;
};

/**
 * Bottom tabs. Each tab hosts its own native-stack from M5+.
 * 底部 Tab. M5 起每个 Tab 拥有独立 native-stack.
 */
export type TabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  CategoriesTab: NavigatorScreenParams<CategoriesStackParamList>;
  FavoritesTab: NavigatorScreenParams<FavoritesStackParamList>;
  MeTab: NavigatorScreenParams<ProfileStackParamList>;
};
