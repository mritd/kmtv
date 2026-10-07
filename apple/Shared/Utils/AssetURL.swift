import Foundation

/// Resolves an image reference from the server, such as a cover. A server-relative path ("/...")
/// is prefixed with `baseURL`; an absolute URL is used as is. Returns nil for an empty or
/// unparsable reference. Without a `baseURL`, a relative path stays relative, as it did before
/// the rule had one home.
///
/// 解析服务端返回的图片引用 (例如封面). 服务端相对路径 ("/...") 会加上 `baseURL` 前缀; 绝对 URL 原样
/// 使用. 引用为空或无法解析时返回 nil. 没有 `baseURL` 时相对路径保持相对, 与此规则集中之前的行为一致.
func resolveAssetURL(_ raw: String?, baseURL: String?) -> URL? {
    guard let raw, !raw.isEmpty else { return nil }
    if raw.hasPrefix("/"), let baseURL {
        return URL(string: baseURL + raw)
    }
    return URL(string: raw)
}
