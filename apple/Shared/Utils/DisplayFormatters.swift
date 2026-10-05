import Foundation

enum DisplayFormatters {
    /// Formats backend latency milliseconds for compact UI badges.
    ///
    /// 将后端延迟毫秒格式化为紧凑的 UI 标记文本.
    static func latency(_ ms: Double) -> String {
        if ms < 1000 { return "\(Int(ms))ms" }
        return String(format: "%.1fs", ms / 1000)
    }

    /// Removes source decoration prefixes while preserving the source name.
    ///
    /// 移除播放源装饰前缀, 同时保留源名称.
    static func cleanSourceName(_ name: String) -> String {
        name.replacingOccurrences(of: "^(🎬|🔞)\\s?", with: "", options: .regularExpression)
    }

    /// Joins the non-empty parts of a metadata line, so a missing type, year, or area leaves no
    /// stray separator.
    ///
    /// 拼接元数据行中的非空部分, 缺少类型, 年份或地区时不会留下多余的分隔符.
    static func metaLine(_ parts: [String?], separator: String = " | ") -> String {
        parts
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: separator)
    }

    /// Returns a useful description or nil when upstream text is empty or duplicate.
    ///
    /// 当上游简介为空或与标题重复时返回 nil.
    static func bestDescription(title: String, desc: String) -> String? {
        let trimmed = desc.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != title else { return nil }
        return trimmed
    }
}
