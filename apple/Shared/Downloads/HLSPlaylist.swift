import Foundation

/// A variant stream of a master playlist.
///
/// master playlist 中的一个变体流.
struct HLSVariant: Equatable, Sendable {
    let uri: URL
    let bandwidth: Int
    let audioGroup: String?
}

/// An `EXT-X-MEDIA` rendition; `uri` is nil when the rendition is muxed into the variant.
///
/// 一个 `EXT-X-MEDIA` rendition; 已混入变体流时 `uri` 为 nil.
struct HLSRendition: Equatable, Sendable {
    let type: String
    let groupID: String
    let uri: URL?
}

/// A parsed master playlist.
///
/// 解析后的 master playlist.
struct HLSMasterPlaylist: Equatable, Sendable {
    let variants: [HLSVariant]
    let renditions: [HLSRendition]
}

/// Encryption in effect for a segment.
///
/// 对某个分片生效的加密方式.
enum HLSKey: Equatable, Sendable {
    case none
    case aes128(uri: URL, iv: Data?)
}

/// One media segment with the key, map, and sequence number in effect for it.
///
/// 一个媒体分片, 附带对它生效的 key, map 与序号.
struct HLSSegment: Equatable, Sendable {
    let uri: URL
    let duration: Double
    let key: HLSKey
    let map: URL?
    let discontinuity: Bool
    let mediaSequence: Int
}

/// A parsed VOD media playlist.
///
/// 解析后的 VOD media playlist.
struct HLSMediaPlaylist: Equatable, Sendable {
    let version: Int
    let targetDuration: Int
    let mediaSequence: Int
    let segments: [HLSSegment]
}

/// Either kind of playlist.
///
/// 两种 playlist 之一.
enum HLSPlaylist: Equatable, Sendable {
    case master(HLSMasterPlaylist)
    case media(HLSMediaPlaylist)
}

/// Why a playlist cannot be downloaded.
///
/// playlist 无法下载的原因.
enum HLSParseError: Error, Equatable, Sendable {
    case notHLS
    case live
    case unsupportedKey(String)
    case byteRange
    case separateAudio
    case noSegments
    case noVariants
}

/// Parses the HLS subset that downloads support: VOD media playlists with AES-128 or no
/// encryption, init maps, and discontinuities, and master playlists with muxed audio.
///
/// 解析下载所支持的 HLS 子集: 使用 AES-128 或不加密, 带 init map 与 discontinuity 的 VOD media
/// playlist, 以及音频已混流的 master playlist.
enum HLSParser {
    /// Parses playlist text; relative URIs resolve against `baseURL`.
    ///
    /// 解析 playlist 文本; 相对 URI 基于 `baseURL` 解析.
    static func parse(_ text: String, baseURL: URL) throws -> HLSPlaylist {
        let lines = text.replacingOccurrences(of: "\u{FEFF}", with: "")
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard lines.first == "#EXTM3U" else { throw HLSParseError.notHLS }
        if lines.contains(where: { $0.hasPrefix("#EXT-X-STREAM-INF:") }) {
            return .master(try parseMaster(lines, baseURL: baseURL))
        }
        return .media(try parseMedia(lines, baseURL: baseURL))
    }

    /// The highest-bandwidth variant; throws when its audio group has a separate rendition URI.
    ///
    /// 码率最高的变体; 若其音频组带有独立的 rendition URI 则抛出错误.
    static func bestVariant(_ master: HLSMasterPlaylist) throws -> HLSVariant {
        guard let best = master.variants.max(by: { $0.bandwidth < $1.bandwidth }) else {
            throw HLSParseError.noVariants
        }
        if let group = best.audioGroup,
           master.renditions.contains(where: { $0.type == "AUDIO" && $0.groupID == group && $0.uri != nil }) {
            throw HLSParseError.separateAudio
        }
        return best
    }

    private static func parseMaster(_ lines: [String], baseURL: URL) throws -> HLSMasterPlaylist {
        var variants: [HLSVariant] = []
        var renditions: [HLSRendition] = []
        var pending: [String: String]?
        for line in lines {
            if line.hasPrefix("#EXT-X-MEDIA:") {
                let attrs = attributes(line.dropFirst("#EXT-X-MEDIA:".count))
                renditions.append(HLSRendition(type: attrs["TYPE"] ?? "", groupID: attrs["GROUP-ID"] ?? "",
                                               uri: attrs["URI"].flatMap { resolve($0, baseURL) }))
            } else if line.hasPrefix("#EXT-X-STREAM-INF:") {
                pending = attributes(line.dropFirst("#EXT-X-STREAM-INF:".count))
            } else if !line.hasPrefix("#"), let attrs = pending {
                pending = nil
                guard let uri = resolve(line, baseURL) else { continue }
                variants.append(HLSVariant(uri: uri, bandwidth: Int(attrs["BANDWIDTH"] ?? "") ?? 0,
                                           audioGroup: attrs["AUDIO"]))
            }
        }
        guard !variants.isEmpty else { throw HLSParseError.noVariants }
        return HLSMasterPlaylist(variants: variants, renditions: renditions)
    }

    private static func parseMedia(_ lines: [String], baseURL: URL) throws -> HLSMediaPlaylist {
        var version = 3
        var targetDuration = 0
        var firstSequence = 0
        var key = HLSKey.none
        var map: URL?
        var duration: Double?
        var discontinuity = false
        var hasEndList = false
        var segments: [HLSSegment] = []
        for line in lines.dropFirst() {
            if line.hasPrefix("#EXT-X-VERSION:") {
                version = Int(line.dropFirst("#EXT-X-VERSION:".count)) ?? version
            } else if line.hasPrefix("#EXT-X-TARGETDURATION:") {
                targetDuration = Int(line.dropFirst("#EXT-X-TARGETDURATION:".count)) ?? targetDuration
            } else if line.hasPrefix("#EXT-X-MEDIA-SEQUENCE:") {
                firstSequence = Int(line.dropFirst("#EXT-X-MEDIA-SEQUENCE:".count)) ?? 0
            } else if line.hasPrefix("#EXT-X-KEY:") {
                key = try parseKey(attributes(line.dropFirst("#EXT-X-KEY:".count)), baseURL: baseURL)
            } else if line.hasPrefix("#EXT-X-MAP:") {
                let attrs = attributes(line.dropFirst("#EXT-X-MAP:".count))
                if attrs["BYTERANGE"] != nil { throw HLSParseError.byteRange }
                map = attrs["URI"].flatMap { resolve($0, baseURL) }
            } else if line.hasPrefix("#EXT-X-BYTERANGE") {
                throw HLSParseError.byteRange
            } else if line.hasPrefix("#EXTINF:") {
                let value = line.dropFirst("#EXTINF:".count).split(separator: ",", maxSplits: 1).first ?? ""
                duration = Double(value.trimmingCharacters(in: .whitespaces)) ?? 0
            } else if line == "#EXT-X-DISCONTINUITY" {
                discontinuity = true
            } else if line == "#EXT-X-ENDLIST" {
                hasEndList = true
            } else if !line.hasPrefix("#"), let segmentDuration = duration {
                guard let uri = resolve(line, baseURL) else { throw HLSParseError.notHLS }
                segments.append(HLSSegment(uri: uri, duration: segmentDuration, key: key, map: map,
                                           discontinuity: discontinuity,
                                           mediaSequence: firstSequence + segments.count))
                duration = nil
                discontinuity = false
            }
        }
        guard hasEndList else { throw segments.isEmpty ? HLSParseError.noSegments : HLSParseError.live }
        guard !segments.isEmpty else { throw HLSParseError.noSegments }
        if targetDuration == 0 { targetDuration = Int((segments.map(\.duration).max() ?? 1).rounded(.up)) }
        return HLSMediaPlaylist(version: version, targetDuration: targetDuration, mediaSequence: firstSequence,
                                segments: segments)
    }

    private static func parseKey(_ attrs: [String: String], baseURL: URL) throws -> HLSKey {
        let method = attrs["METHOD"] ?? "NONE"
        switch method {
        case "NONE":
            return .none
        case "AES-128":
            guard let uri = attrs["URI"].flatMap({ resolve($0, baseURL) }) else { throw HLSParseError.notHLS }
            return .aes128(uri: uri, iv: attrs["IV"].flatMap(parseIV))
        default:
            throw HLSParseError.unsupportedKey(method)
        }
    }

    /// Splits an attribute list on commas outside quotes; quoted values lose their quotes.
    ///
    /// 在引号之外按逗号拆分属性列表; 带引号的值会去掉引号.
    static func attributes(_ list: Substring) -> [String: String] {
        var result: [String: String] = [:]
        var key = ""
        var value = ""
        var readingKey = true
        var quoted = false
        func flush() {
            let name = key.trimmingCharacters(in: .whitespaces)
            if !name.isEmpty { result[name] = value }
            key = ""
            value = ""
            readingKey = true
        }
        for character in list {
            if readingKey {
                if character == "=" { readingKey = false } else if character == "," { flush() } else { key.append(character) }
            } else if character == "\"" {
                quoted.toggle()
            } else if character == "," && !quoted {
                flush()
            } else {
                value.append(character)
            }
        }
        flush()
        return result
    }

    /// Parses a `0x` hex IV into 16 bytes, left-padded with zeros; nil when invalid or too long.
    ///
    /// 将 `0x` 十六进制 IV 解析为 16 字节, 左侧补零; 非法或过长时返回 nil.
    static func parseIV(_ hex: String) -> Data? {
        var digits = hex
        if digits.lowercased().hasPrefix("0x") { digits.removeFirst(2) }
        guard !digits.isEmpty, digits.count <= 32, digits.allSatisfy(\.isHexDigit) else { return nil }
        digits = String(repeating: "0", count: 32 - digits.count) + digits
        var bytes: [UInt8] = []
        var index = digits.startIndex
        while index < digits.endIndex {
            let next = digits.index(index, offsetBy: 2)
            bytes.append(UInt8(digits[index..<next], radix: 16) ?? 0)
            index = next
        }
        return Data(bytes)
    }

    private static func resolve(_ reference: String, _ baseURL: URL) -> URL? {
        URL(string: reference, relativeTo: baseURL)?.absoluteURL
    }
}
