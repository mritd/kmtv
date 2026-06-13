// AuthenticatedAvatarImage — fetches a protected avatar via APIClient.getBlob and renders it.
// AuthenticatedAvatarImage — 通过 APIClient.getBlob 拉取受保护头像并渲染.

import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import type { APIClient } from "@/api/client";

/**
 * Props for AuthenticatedAvatarImage. `path` is the full server-rooted path (`/api/v1/avatar/...`)
 * — we strip the `/api/v1` prefix internally since APIClient adds it.
 * AuthenticatedAvatarImage 的 props. path 是带 /api/v1 前缀的完整路径,
 * 内部会剥离前缀, 因为 APIClient 自动添加.
 */
export interface AuthenticatedAvatarImageProps {
  apiClient: APIClient | null;
  path: string | undefined;
  size?: number;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Encode an ArrayBuffer to a base64 string. RN ≤ 0.85 does NOT reliably ship `btoa` on Hermes;
 * we hand-roll the encoder to keep the encoding deterministic and dependency-free.
 * 把 ArrayBuffer 编码为 base64. RN ≤ 0.85 在 Hermes 上不一定提供 btoa, 手写编码避免依赖.
 */
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.byteLength; i += 3) {
    const b0 = bytes[i]!, b1 = bytes[i + 1]!, b2 = bytes[i + 2]!;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += BASE64_ALPHABET[b2 & 0x3f];
  }
  if (i < bytes.byteLength) {
    const b0 = bytes[i]!;
    out += BASE64_ALPHABET[b0 >> 2];
    if (i + 1 < bytes.byteLength) {
      const b1 = bytes[i + 1]!;
      out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
      out += BASE64_ALPHABET[(b1 & 0x0f) << 2];
      out += "=";
    } else {
      out += BASE64_ALPHABET[(b0 & 0x03) << 4];
      out += "==";
    }
  }
  return out;
}

function bufferToDataUri(buf: ArrayBuffer, mime = "image/jpeg"): string {
  return `data:${mime};base64,${bufferToBase64(buf)}`;
}

/**
 * AuthenticatedAvatarImage — wraps `expo-image` with bearer-authenticated binary fetch.
 * AuthenticatedAvatarImage — 用受 bearer 认证的二进制 fetch 包裹 expo-image.
 */
export function AuthenticatedAvatarImage({ apiClient, path, size = 60 }: AuthenticatedAvatarImageProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setUri(null);
    if (!apiClient || !path) return;
    const stripped = path.startsWith("/api/v1") ? path.slice("/api/v1".length) : path;
    void (async () => {
      try {
        const buf = await apiClient.getBlob(stripped);
        if (!cancelled) setUri(bufferToDataUri(buf));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [apiClient, path]);

  if (failed || !uri) {
    return <View testID="avatar-fallback" style={{ width: size, height: size }} />;
  }
  return <Image testID="avatar-image" source={{ uri }} style={{ width: size, height: size }} />;
}
