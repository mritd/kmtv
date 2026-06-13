// Resolve a hero/poster URL by joining relative covers to the API base.
// 通过将相对 cover 拼接到 API base, 解析 hero/poster URL.

export function heroImageURL(baseURL: string, cover: string): string | null {
  if (!cover) return null;
  if (/^https?:\/\//i.test(cover)) return cover;
  if (cover.startsWith("/")) {
    const trimmed = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
    return `${trimmed}${cover}`;
  }
  return cover;
}
