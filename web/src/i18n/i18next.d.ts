// i18next module augmentation — enables typed validation for statically known t() key paths across the codebase.
// Note: dynamic key lookups (e.g. template literals cast with "as never" or "as const") bypass the
// compiler check; those call sites are intentional escape hatches for runtime-computed keys.
// The zh locale is used as the canonical type source because it is the primary/fallback language;
// any key that exists in zh is guaranteed to be present at runtime (en may be missing some).
// Excluded from vitest coverage because it has no executable lines (declaration file only).
//
// How this works: i18next ships a CustomTypeOptions hook; augmenting the "resources" field
// causes the t() function to accept only valid namespace:key paths and infer the return type
// as string (never null, because returnNull: false is set in index.ts).
//
// Callers: every component or hook that calls useTranslation() or t() implicitly depends on
// this file for compile-time key validation. No runtime import is generated.
//
// i18next 模块增强 — 为静态已知的 t() key 路径开启类型校验.
// 注意: 动态 key 查找 (例如用 "as never" 或 "as const" 强转的模板字符串) 会绕过编译器校验;
// 这些调用点是运行时计算 key 的有意逃生舱.
// 使用 zh locale 作为规范类型来源, 因为它是主语言/回退语言;
// zh 中存在的 key 在运行时一定存在 (en 可能缺少部分 key).
// 排除在 vitest 覆盖率之外, 因为该文件仅含声明, 无可执行行.
//
// 工作原理: i18next 提供 CustomTypeOptions 钩子; 增强 "resources" 字段后,
// t() 函数只接受合法的 namespace:key 路径, 返回类型推断为 string
// (由于 index.ts 中设置了 returnNull: false, 永不返回 null).
//
// 调用方: 每个调用 useTranslation() 或 t() 的组件或 hook 都隐式依赖本文件进行编译期 key 校验.
// 不生成运行时 import.
import "i18next";

// zh locale type imports — used only as type sources, not as runtime values.
// zh locale 类型导入 — 仅用于类型来源, 不产生运行时值.
import type zhAccount from "./locales/zh/account";
import type zhAdmin from "./locales/zh/admin";
import type zhAuth from "./locales/zh/auth";
import type zhCommon from "./locales/zh/common";
import type zhErrors from "./locales/zh/errors";
import type zhNav from "./locales/zh/nav";
import type zhViewer from "./locales/zh/viewer";

declare module "i18next" {
  // CustomTypeOptions narrows the i18next generic so the compiler rejects unknown keys.
  // CustomTypeOptions 缩窄 i18next 泛型, 让编译器拒绝未知 key.
  interface CustomTypeOptions {
    // defaultNS matches the init() option in index.ts; keys without a namespace prefix resolve
    // from "common". Must be kept in sync with the init() call.
    // defaultNS 与 index.ts 中 init() 的选项一致; 无命名空间前缀的 key 从 "common" 解析.
    // 必须与 init() 调用保持同步.
    defaultNS: "common";
    // resources lists every namespace and its shape. The type of each namespace is derived from
    // the zh locale because zh is the canonical source of truth for key existence.
    // resources 列出每个命名空间及其形状. 每个命名空间的类型来自 zh locale,
    // 因为 zh 是 key 存在性的规范来源.
    resources: {
      // common — shared labels: brand name, generic actions, loading/error/empty states, date helpers.
      // common — 公共标签: 品牌名, 通用操作, 加载/错误/空状态, 日期辅助.
      common: typeof zhCommon;
      // nav — top navigation links and account popover menu items (language switcher, login, etc.).
      // nav — 顶部导航链接和账户弹出菜单项 (语言切换器, 登录等).
      nav: typeof zhNav;
      // auth — login page strings and session-expired banner.
      // auth — 登录页文案和 session 过期提示.
      auth: typeof zhAuth;
      // viewer — home hero, search, search progress, result card, detail page, favorites, player.
      // viewer — 首页 hero, 搜索, 搜索进度, 结果卡片, 详情页, 收藏夹, 播放器.
      viewer: typeof zhViewer;
      // account — profile page, avatar upload/delete, theme settings, login-prompt card.
      // account — 个人设置页, 头像上传/删除, 主题设置, 登录引导卡片.
      account: typeof zhAccount;
      // admin — admin panel tabs, source/subscription/user/settings CRUD forms and feedback.
      // admin — 管理面板标签页, 视频源/订阅/用户/系统设置 CRUD 表单和反馈.
      admin: typeof zhAdmin;
      // errors — generic error messages intended for shared use across namespaces.
      // NOTE: as of 2026-05-24, no component imports the "errors" namespace via useTranslation();
      // all error strings are currently inlined per-namespace (admin.errors.*, viewer errors, etc.).
      // This namespace is defined for forward-compatibility; removing it requires a Tier 3 decision.
      // errors — 跨命名空间通用错误文案.
      // 注意: 截至 2026-05-24, 没有组件通过 useTranslation() 使用 "errors" 命名空间;
      // 所有错误文案均内联在各自命名空间 (admin.errors.*, viewer 错误等).
      // 该命名空间为前向兼容而定义; 删除需要 Tier 3 决策.
      errors: typeof zhErrors;
    };
  }
}
