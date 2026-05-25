// IncognitoAvatar — hat-and-glasses SVG silhouette used for anonymous / incognito user display.
// IncognitoAvatar — 礼帽 + 眼镜 SVG 剪影, 用于匿名/隐身用户的头像占位.
//
// Exports: IncognitoAvatar, IncognitoAvatarProps.
// Callers: AccountPage (when no avatar is set), anonymous mode user display.
// 调用者: AccountPage (无头像时)、匿名模式用户显示.
//
// Design: uses currentColor so the icon inherits the parent's text color without extra CSS.
//   The lens circles carry a translucent fill (fillOpacity 0.18) to suggest glass without
//   obscuring the path lines underneath.
// 设计: 使用 currentColor 继承父级文字颜色; 镜片圆形使用半透明填充 (fillOpacity 0.18)
//   以体现玻璃质感而不遮挡底部线条.

// IncognitoAvatarProps defines the public API of IncognitoAvatar.
// IncognitoAvatarProps 定义 IncognitoAvatar 的公开 API.
export interface IncognitoAvatarProps {
  className?: string;
  // label is the accessible name announced by screen readers (defaults to "Anonymous").
  // label 是屏幕阅读器播报的可访问名称 (默认为 "Anonymous").
  label?: string;
}

// IncognitoAvatar renders a Chrome-style incognito hat-and-glasses silhouette as an inline SVG.
// The SVG uses role="img" + aria-label so assistive technology treats it as a named image.
// IncognitoAvatar 渲染类 Chrome 隐身模式的礼帽 + 眼镜内联 SVG.
// 使用 role="img" + aria-label, 使辅助技术将其识别为具名图像.
export function IncognitoAvatar({ className, label = "Anonymous" }: IncognitoAvatarProps): React.JSX.Element {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Brim of the hat */}
      <path d="M3 13h18" />
      {/* Crown of the hat */}
      <path d="M6 13c0-3 1.5-7 3-7h6c1.5 0 3 4 3 7" />
      {/* Left lens (translucent fill suggests glass without hiding stroke) */}
      <circle cx="8.5" cy="16.5" r="2.4" fill="currentColor" fillOpacity="0.18" />
      {/* Right lens */}
      <circle cx="15.5" cy="16.5" r="2.4" fill="currentColor" fillOpacity="0.18" />
      {/* Bridge connecting the two lenses */}
      <path d="M10.9 16.5h2.2" />
    </svg>
  );
}
