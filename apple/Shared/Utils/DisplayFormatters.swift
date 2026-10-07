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

    /// Cleans a source description for display: collapses whitespace inside each line, keeps one
    /// line break between non-empty lines, and keeps one copy of a paragraph some sources send twice
    /// ("ABCABC", "ABC ABC", or the copy on its own line). Both halves must match, so a text that
    /// merely starts with a repeated character stays whole.
    ///
    /// 清洗视频源简介以便显示: 合并每行内的空白, 非空行之间保留一个换行, 并在部分源把同一段落重复两次
    /// ("ABCABC", "ABC ABC", 或另起一行重复) 时只保留一份. 前后两半必须完全相同, 因此仅以重复字符开头的
    /// 文本会保持完整.
    static func cleanDescription(_ desc: String) -> String {
        let lines = desc.components(separatedBy: .newlines)
            .map { $0.components(separatedBy: .whitespaces).filter { !$0.isEmpty }.joined(separator: " ") }
            .filter { !$0.isEmpty }
        let text = lines.joined(separator: "\n")
        guard !text.isEmpty else { return text }
        // A repeat splits the text at its middle, or one character off it when a space or a line
        // break separates the copies, into two equal halves. Line breaks compare like spaces, and
        // both are one character, so a split of the flat text is a split of `text`.
        //
        // 重复文本可在中点 (两份之间有空格或换行时为中点前后一个字符处) 拆成相同的两半. 换行与空格按相同
        // 处理, 且两者都是一个字符, 因此在扁平文本上的拆分位置同样适用于 `text`.
        let flat = lines.joined(separator: " ")
        let len = flat.count
        for half in [len / 2, len / 2 + 1, len / 2 - 1] where half > 0 && half < len {
            let first = flat.prefix(half).trimmingCharacters(in: .whitespaces)
            let second = flat.dropFirst(half).trimmingCharacters(in: .whitespaces)
            if !first.isEmpty, first == second {
                return text.prefix(half).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return text
    }

    /// The description to show for a title: the cleaned text (see `cleanDescription`), or nil when
    /// it is empty or only repeats the title.
    ///
    /// 某个标题要显示的简介: 清洗后的文本 (见 `cleanDescription`); 为空或只是重复标题时返回 nil.
    static func bestDescription(title: String, desc: String) -> String? {
        let cleaned = cleanDescription(desc)
        guard !cleaned.isEmpty, cleaned != title else { return nil }
        return cleaned
    }
}
