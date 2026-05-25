/**
 * AppLayout — persistent top-navigation shell rendered around every authenticated or
 * anonymous route. Controls the site brand, viewer nav links, language selector, and
 * account popover (avatar menu, admin link, logout).
 * AppLayout — 为每个已认证或匿名路由渲染持久的顶部导航外壳.
 * 管理站点品牌名、观看者导航链接、语言切换及账号弹出菜单 (头像菜单、管理入口、登出).
 *
 * Key exports / 主要导出:
 *   AppLayout
 *
 * Callers / 调用方:
 *   AppRoutes.tsx — wraps the main page area with this shell for authenticated + anonymous paths
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { useAdminSettingsQuery } from "@/api/adminHooks";
import { useAuth } from "@/auth/AuthContext";
import { IncognitoAvatar } from "@/shared/ui/IncognitoAvatar";
import { useI18nStore, type Lang } from "@/store/i18nStore";

// LANGS is the ordered list of selectable UI languages shown in the account popover.
// LANGS 是账号弹出菜单中可选的 UI 语言列表, 顺序即展示顺序.
const LANGS: readonly Lang[] = ["zh", "en"] as const;

/**
 * AppLayout renders the persistent top-navigation chrome and wraps the page content area.
 * AppLayout 渲染持久的顶部导航框架并包裹页面内容区域.
 *
 * Assumes it is mounted inside AuthProvider, BrowserRouter, and QueryClientProvider.
 * 假设已挂载在 AuthProvider、BrowserRouter 及 QueryClientProvider 内部.
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(["nav", "common"]);
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const settingsQuery = useAdminSettingsQuery();
  // brand falls back to the i18n "common:brand" key when the settings query is pending
  // or returns an empty site_name — ensures the <title> and brand mark never flash blank.
  // brand 在设置查询未完成或 site_name 为空时回退到 i18n "common:brand",
  // 确保 <title> 和品牌标识不会闪烁为空白.
  const brand = useMemo(() => {
    const siteName = settingsQuery.data?.settings?.site_name?.trim();
    return siteName || t("common:brand");
  }, [settingsQuery.data, t]);

  // Sync the browser tab title whenever the brand name changes (settings load or lang switch).
  // settings 加载完成或切换语言时同步浏览器标签标题.
  useEffect(() => {
    document.title = brand;
  }, [brand]);

  // Close the account popover on outside pointer-down or Escape key.
  // Registered only while menuOpen to avoid unnecessary global listeners.
  // 在外部按下鼠标或按 Escape 键时关闭账号弹出菜单.
  // 仅在菜单打开期间注册监听, 避免不必要的全局监听器.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      const node = menuRef.current;
      if (!node) return;
      if (event.target instanceof Node && !node.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const isAnonymous = auth.isAnonymous;

  // avatarContent renders the button face: incognito icon for anonymous, user avatar
  // image if provided, or the first letter of the username as a monogram fallback.
  // avatarContent 渲染按钮图标: 匿名时显示无痕图标, 有头像则显示头像图片,
  // 否则显示用户名首字母作为缩写回退.
  function avatarContent() {
    if (isAnonymous) return <IncognitoAvatar label={t("nav:account.anonymous")} />;
    if (auth.user?.avatar) return <img src={auth.user.avatar} alt="" />;
    return <span>{auth.user?.username.slice(0, 1).toUpperCase()}</span>;
  }

  // handleLoginClick closes the popover and navigates to /login while preserving the
  // current path as the ?next= query param so the login page can redirect back after success.
  // handleLoginClick 关闭弹出菜单并导航到 /login, 同时将当前路径保存为 ?next= 参数,
  // 以便登录成功后跳回原页面.
  function handleLoginClick() {
    setMenuOpen(false);
    const fromPath = `${location.pathname}${location.search}`;
    navigate(`/login?next=${encodeURIComponent(fromPath)}`);
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <NavLink className="brand-mark" to="/">
          {brand}
        </NavLink>
        <nav className="viewer-nav" aria-label={t("links.home")}>
          <NavLink to="/">{t("links.home")}</NavLink>
          <NavLink to="/categories">{t("links.categories")}</NavLink>
          <NavLink to="/search">{t("links.search")}</NavLink>
          <NavLink to="/favorites">{t("links.favorites")}</NavLink>
        </nav>
        <div className="account-menu" ref={menuRef}>
          <button
            className="avatar-button"
            type="button"
            aria-label={t("account.menu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {avatarContent()}
          </button>
          {menuOpen ? (
            <div className="account-popover">
              {isAnonymous ? (
                <>
                  <span className="account-popover-anonymous-label">{t("nav:account.anonymous")}</span>
                  <button
                    type="button"
                    className="account-popover-item account-popover-login"
                    onClick={handleLoginClick}
                  >
                    {t("nav:account.login")}
                  </button>
                </>
              ) : (
                <>
                  <NavLink className="account-popover-item" to="/account" onClick={() => setMenuOpen(false)}>
                    {t("account.profile")}
                  </NavLink>
                  {auth.user?.role === "admin" ? (
                    <NavLink className="account-popover-item" to="/admin" onClick={() => setMenuOpen(false)}>
                      {t("account.admin")}
                    </NavLink>
                  ) : null}
                </>
              )}
              <div className="account-popover-divider" role="separator" aria-hidden="true" />
              <div className="account-popover-section">
                <span className="account-popover-section-label" aria-hidden="true">{t("account.language")}</span>
                <div className="account-language-pills" role="radiogroup" aria-label={t("account.language")}>
                  {LANGS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={lang === value}
                      className={`account-language-pill${lang === value ? " is-active" : ""}`}
                      onClick={() => setLang(value)}
                    >
                      {t(`account.languages.${value}` as const)}
                    </button>
                  ))}
                </div>
              </div>
              {isAnonymous ? null : (
                <>
                  <div className="account-popover-divider" role="separator" aria-hidden="true" />
                  <button type="button" className="account-popover-item account-popover-logout" onClick={() => void auth.logout()}>
                    {t("account.logout")}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}
