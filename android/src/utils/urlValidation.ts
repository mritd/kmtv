// English. 中文.
// URL validation helper that mirrors apple/Shared/Utils/URLValidation.swift.
// 镜像 apple/Shared/Utils/URLValidation.swift 的 URL 校验 helper.

/**
 * Returns true when the string parses as an absolute URL with http/https scheme and non-empty host.
 * 当字符串为 http/https 协议且包含非空 host 的绝对 URL 时返回 true.
 */
export function isValidHTTPURL(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return false;
  if (!url.hostname || url.hostname.length === 0) return false;
  return true;
}
