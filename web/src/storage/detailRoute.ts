/**
 * storage/detailRoute.ts — opaque base58 token encoding for /detail/:token routes.
 * storage/detailRoute.ts — 详情页 /detail/:token 路由的不透明 base58 令牌编解码.
 *
 * Why opaque tokens / 为什么使用不透明令牌:
 *   The previous /detail/:source/:id route placed third-party source domains
 *   (e.g. /detail/www.subozy.com/110661) directly in the URL bar. The token form
 *   hides the source identity from the visible path while preserving deterministic
 *   one-to-one mapping so React Query keys, localStorage bundle lookup, and the
 *   detail recovery search all keep working unchanged.
 *   旧路径 /detail/:source/:id 会把第三方源域名 (如 /detail/www.subozy.com/110661)
 *   暴露在地址栏中. 令牌形式将源信息从可见路径中隐去, 同时保持确定性的一一映射,
 *   使 React Query key、localStorage bundle 查找与详情恢复搜索均保持原行为不变.
 *
 * Why base58 (not base64url) / 为什么用 base58 (而非 base64url):
 *   - Matches the project's existing convention (ADR-012 backend bearer tokens are base58).
 *   - Alphabet is URL-safe with no `-`, `_`, or `=` padding noise.
 *   - Visually unambiguous: omits 0/O/I/l.
 *   - 与项目已有约定一致 (ADR-012 后端 bearer token 即为 base58).
 *   - 字母表 URL 安全, 不含 `-`、`_` 或 `=` 填充噪音.
 *   - 视觉无歧义: 排除 0/O/I/l.
 *
 * Token layout / 令牌结构:
 *   token = base58( utf8( source_key + "\x1F" + video_id ) )
 *   - "\x1F" (Unit Separator) is forbidden inside source_key / video_id so the split
 *     is unambiguous on decode.
 *   - "\x1F" (单元分隔符) 不允许出现在 source_key / video_id 中, 解码时分割无歧义.
 *
 * Reversibility note / 可逆性说明:
 *   The encoding is reversible by design — anyone with a token can recover the
 *   underlying (source_key, video_id). This is cosmetic URL hygiene, not access
 *   control. Real authorization still goes through ADR-012 bearer tokens.
 *   该编码按设计可逆 — 持有 token 的任何人都能还原 (source_key, video_id).
 *   这是 URL 表现层的清理, 不是访问控制. 真正的鉴权仍走 ADR-012 bearer token.
 *
 * Key exports / 主要导出:
 *   encodeDetailToken, decodeDetailToken, detailRoutePath
 *
 * Callers / 调用方:
 *   viewer/search/SearchPage.tsx (encode for navigate target)
 *   viewer/detail/DetailPage.tsx (decode from useParams)
 *   app/AppRoutes.tsx (route path /detail/:token)
 */

// fieldSeparator separates source_key from video_id inside the encoded payload.
// 0x1F (Unit Separator) is a control character that never appears in URLs or IDs.
// fieldSeparator 在编码负载内分隔 source_key 与 video_id.
// 0x1F (单元分隔符) 是控制字符, 永远不会出现在 URL 或 ID 中.
const fieldSeparator = "\x1F";

// Bitcoin/IPFS base58 alphabet — same one used by the Go backend (ADR-012).
// Bitcoin/IPFS base58 字母表 — 与 Go 后端 (ADR-012) 一致.
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_LEADING_ZERO_CHAR = BASE58_ALPHABET[0]; // "1"
const BASE58_INDEX = buildAlphabetIndex(BASE58_ALPHABET);

/**
 * DetailRouteParts is the decoded shape returned by decodeDetailToken.
 * DetailRouteParts 是 decodeDetailToken 返回的解码结构.
 */
export interface DetailRouteParts {
  sourceKey: string;
  videoId: string;
}

/**
 * encodeDetailToken produces an opaque URL-safe base58 token for a (sourceKey, videoId) pair.
 * encodeDetailToken 为 (sourceKey, videoId) 生成不透明的 URL 安全 base58 令牌.
 *
 * Throws when either field is empty or contains the unit-separator byte 0x1F — those
 * inputs would round-trip to an unparseable token and produce a permanently-broken
 * URL for the user. Caller-side validation (e.g. isSourceResult) is expected to
 * filter such garbage before reaching this point; the throw is a loud failsafe.
 * 当任一字段为空或包含单元分隔符 0x1F 时抛出 — 这些输入会往返出无法解析的 token,
 * 让用户得到永久死链. 期望调用方 (如 isSourceResult) 提前过滤垃圾数据; 抛出仅作为兜底.
 */
export function encodeDetailToken(sourceKey: string, videoId: string): string {
  if (!sourceKey || !videoId || sourceKey.includes(fieldSeparator) || videoId.includes(fieldSeparator)) {
    throw new Error(
      `encodeDetailToken: refusing to encode invalid source identity (sourceKey=${JSON.stringify(sourceKey)}, videoId=${JSON.stringify(videoId)})`,
    );
  }
  const payload = `${sourceKey}${fieldSeparator}${videoId}`;
  return base58Encode(new TextEncoder().encode(payload));
}

/**
 * decodeDetailToken reverses encodeDetailToken. Returns null when the token is
 * malformed (non-base58 char, missing separator, invalid UTF-8, or empty fields).
 * decodeDetailToken 反向解码 encodeDetailToken. token 格式错误
 * (非 base58 字符、缺少分隔符、UTF-8 非法或字段为空) 时返回 null.
 */
export function decodeDetailToken(token: string | undefined | null): DetailRouteParts | null {
  if (!token) {
    return null;
  }
  const bytes = base58Decode(token);
  if (!bytes) {
    return null;
  }
  let payload: string;
  try {
    payload = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const separatorIndex = payload.indexOf(fieldSeparator);
  if (separatorIndex <= 0 || separatorIndex === payload.length - 1) {
    // separator missing, leading separator, or trailing separator → reject.
    // 分隔符缺失、位于首位或末位 → 拒绝.
    return null;
  }
  const sourceKey = payload.slice(0, separatorIndex);
  const videoId = payload.slice(separatorIndex + 1);
  if (videoId.includes(fieldSeparator)) {
    // A second separator would make decoding ambiguous — refuse rather than guess.
    // 出现第二个分隔符会导致解码歧义 — 直接拒绝而非猜测.
    return null;
  }
  return { sourceKey, videoId };
}

/**
 * detailRoutePath builds the canonical "/detail/:token" path for the given pair.
 * detailRoutePath 为给定 (sourceKey, videoId) 构造规范的 "/detail/:token" 路径.
 */
export function detailRoutePath(sourceKey: string, videoId: string): string {
  return `/detail/${encodeDetailToken(sourceKey, videoId)}`;
}

// buildAlphabetIndex maps each alphabet char to its base-58 digit value for O(1) decode lookup.
// buildAlphabetIndex 将字母表中每个字符映射到 base-58 数位值, 供解码 O(1) 查表使用.
function buildAlphabetIndex(alphabet: string): Int8Array {
  const index = new Int8Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i += 1) {
    index[alphabet.charCodeAt(i)] = i;
  }
  return index;
}

// base58Encode converts an unsigned big-endian byte buffer to its base58 string form.
// Leading zero bytes are preserved as leading "1" characters per the standard convention.
// base58Encode 将无符号大端字节序列编码为 base58 字符串.
// 前导零字节按标准约定保留为前导 "1" 字符.
function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros += 1;
  }
  // Convert via BigInt arithmetic — payloads are short (<512 bytes in practice).
  // 借助 BigInt 计算 — 实际负载短 (<512 字节).
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value = value / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }
  return BASE58_LEADING_ZERO_CHAR.repeat(leadingZeros) + encoded;
}

// base58Decode reverses base58Encode. Returns null on any non-alphabet character.
// base58Decode 反向解码 base58Encode. 字母表外字符返回 null.
function base58Decode(text: string): Uint8Array | null {
  if (text.length === 0) {
    return null;
  }
  let leadingZeros = 0;
  while (leadingZeros < text.length && text[leadingZeros] === BASE58_LEADING_ZERO_CHAR) {
    leadingZeros += 1;
  }
  let value = 0n;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const digit = code < 128 ? BASE58_INDEX[code] : -1;
    if (digit < 0) {
      return null;
    }
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[leadingZeros + i] = bytes[i];
  }
  return out;
}
