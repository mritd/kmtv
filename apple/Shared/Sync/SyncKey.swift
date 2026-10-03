import Foundation

/// Whitespace that separates words in a record key. It mirrors `server/internal/model/sync.go`,
/// and `testdata/sync-key-vectors.json` pins the behavior.
///
/// 记录 key 中用于分隔单词的空白字符. 与 `server/internal/model/sync.go` 一致,
/// 行为由 `testdata/sync-key-vectors.json` 固定.
private let syncSpaceScalars: Set<Unicode.Scalar> = {
    var scalars: Set<Unicode.Scalar> = ["\t", "\n", "\u{0B}", "\u{0C}", "\r", " ",
                                        "\u{85}", "\u{A0}", "\u{1680}", "\u{2028}", "\u{2029}",
                                        "\u{202F}", "\u{205F}", "\u{3000}"]
    for value in 0x2000...0x200A {
        if let scalar = Unicode.Scalar(value) { scalars.insert(scalar) }
    }
    return scalars
}()

/// Trims, collapses inner whitespace runs to one space, and lowercases a title or query one code
/// point at a time. Go's `unicode.ToLower` maps one rune to one rune, so a multi-scalar lowercase
/// mapping keeps only its first scalar: "\u{130}" becomes "i", not "i\u{307}".
///
/// 去掉首尾空白, 将内部连续空白合并为一个空格, 再逐码点将标题或搜索词转为小写. Go 的
/// `unicode.ToLower` 是逐码点一对一映射, 所以多码点的小写映射只保留第一个码点: "\u{130}"
/// 变为 "i", 而不是 "i\u{307}".
func normalizeSyncKey(_ value: String) -> String {
    var result = String.UnicodeScalarView()
    var pendingSpace = false
    for scalar in value.unicodeScalars {
        if syncSpaceScalars.contains(scalar) {
            pendingSpace = !result.isEmpty
            continue
        }
        if pendingSpace {
            result.append(" ")
            pendingSpace = false
        }
        result.append(scalar.properties.lowercaseMapping.unicodeScalars.first ?? scalar)
    }
    return String(result)
}

/// Removes leading and trailing sync whitespace and keeps the inside unchanged.
///
/// 去掉首尾的同步空白字符, 内部内容保持不变.
func trimSyncText(_ value: String) -> String {
    let scalars = value.unicodeScalars
    guard let start = scalars.firstIndex(where: { !syncSpaceScalars.contains($0) }),
          let end = scalars.lastIndex(where: { !syncSpaceScalars.contains($0) }) else { return "" }
    return String(String.UnicodeScalarView(scalars[start...end]))
}

/// Field limits in code points, matching `server/internal/model/sync.go`.
///
/// 字段长度上限 (以码点计), 与 `server/internal/model/sync.go` 一致.
enum SyncFieldLimit {
    static let title = 512
    static let id = 1024
    static let cover = 8192
    static let short = 64
    static let desc = 2048
}

/// Trims sync whitespace and cuts the text to `limit` code points, so a long title or URL never
/// gets a change rejected by the server.
///
/// 去掉首尾同步空白并截断到 `limit` 个码点, 过长的标题或 URL 不会导致变更被服务端拒绝.
func clampSyncText(_ value: String, limit: Int) -> String {
    let trimmed = trimSyncText(value)
    guard trimmed.unicodeScalars.count > limit else { return trimmed }
    return trimSyncText(String(String.UnicodeScalarView(trimmed.unicodeScalars.prefix(limit))))
}
