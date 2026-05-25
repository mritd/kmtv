import Foundation

enum VersionCompatibility {
    static let minimumServerVersion = "v1.0.0"

    /// Returns true when a server version satisfies the client minimum version.
    /// 当服务端版本满足客户端最低版本要求时返回 true.
    static func isCompatible(_ version: String, minimum: String = minimumServerVersion) -> Bool {
        if isDevelopmentVersion(version) {
            return true
        }

        guard let versionParts = parse(version), let minimumParts = parse(minimum) else {
            return false
        }

        for index in 0..<3 {
            if versionParts[index] > minimumParts[index] {
                return true
            }
            if versionParts[index] < minimumParts[index] {
                return false
            }
        }
        return true
    }

    private static func parse(_ version: String) -> [Int]? {
        let normalized = version.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "v"))
        let core = normalized.split(separator: "-", maxSplits: 1).first ?? ""
        let parts = core.split(separator: ".")
        guard parts.count == 3 else {
            return nil
        }

        let parsed = parts.compactMap { Int($0) }
        return parsed.count == 3 ? parsed : nil
    }

    private static func isDevelopmentVersion(_ version: String) -> Bool {
        version.trimmingCharacters(in: .whitespacesAndNewlines) == "v0.0.0-dev"
    }
}
