// Shared button primitive that composes HTML button attributes with a typed variant system.
// 共享按钮基元: 组合 HTML button 属性与类型化变体系统.
//
// Exports: ButtonVariant, Button.
// Callers: ConfirmDialog, Modal close button, admin/account forms throughout the app.

import type { ButtonHTMLAttributes, ReactNode } from "react";

// ButtonVariant enumerates the visual intent of a button.
// ButtonVariant 枚举按钮的视觉意图.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "warning";

// Button renders a styled <button> element with a variant-based class.
// Button 渲染带变体类名的 <button> 元素.
// Variant defaults to "secondary" when not provided.
// 未提供 variant 时默认为 "secondary".
export function Button({
  className = "",
  variant = "secondary",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; children: ReactNode }): React.JSX.Element {
  return (
    <button className={["ui-button", `ui-button-${variant}`, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </button>
  );
}
