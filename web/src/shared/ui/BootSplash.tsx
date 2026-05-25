// BootSplash — full-screen branded loading screen shown while auth state is being resolved.
// BootSplash — 认证状态解析期间显示的全屏品牌加载画面.
//
// Exports: BootSplash.
// Callers: BootGate (app/BootGate.tsx) — rendered while AuthProvider probes /auth/me on startup.
// 调用者: BootGate (app/BootGate.tsx) — AuthProvider 启动时探测 /auth/me 期间渲染.
//
// Behaviour:
//   • Fetches site_name from the admin settings query (cached — this is not an extra network round-trip
//     when the app boots, because BootGate is rendered before the router mounts and the settings are
//     fetched eagerly). Falls back to the i18n "brand" key when the query is loading or errored.
//   • The outer div carries role="status" + aria-busy="true" + aria-label so screen readers announce
//     the brand name while the spinner is visible.
//   • The spinner element is aria-hidden because it is decorative; the status role covers the region.
// 行为:
//   • 从管理员设置查询获取 site_name (有缓存 — 非额外网络请求);
//     查询加载中或出错时回退到 i18n "brand" 键.
//   • 外层 div 带 role="status" + aria-busy="true" + aria-label, 使屏幕阅读器在显示期间播报品牌名.
//   • 旋转器元素 aria-hidden, 因其为装饰性; status 角色已覆盖整个区域.

import { useTranslation } from "react-i18next";

import { useAdminSettingsQuery } from "@/api/adminHooks";

// BootSplash renders the full-screen splash with the site brand name and a spinner.
// It reads site_name from the admin settings query so a self-hosted instance can show
// a custom name instead of the i18n default.
// BootSplash 渲染带站点品牌名和旋转动画的全屏启动画面.
// 从管理员设置读取 site_name, 支持自托管实例显示自定义名称.
export function BootSplash(): React.JSX.Element {
  const { t } = useTranslation("common");
  const settingsQuery = useAdminSettingsQuery();
  // Prefer the custom site_name from settings; fall back to the translated brand string
  // while the query is still loading or if settings have not been configured.
  // 优先使用设置中的自定义 site_name; 查询加载中或未配置时回退到翻译字符串.
  const brand = settingsQuery.data?.settings?.site_name?.trim() || t("brand");
  return (
    <div className="boot-splash" role="status" aria-busy="true" aria-label={brand}>
      <span className="boot-splash-brand">{brand}</span>
      <span className="boot-splash-spinner" aria-hidden="true" />
    </div>
  );
}
