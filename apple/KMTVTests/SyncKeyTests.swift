import XCTest
@testable import KMTV

/// Pins Swift key normalization to the vectors shared with the Go server and the TypeScript clients.
///
/// 将 Swift 的 key 归一化固定到与 Go 服务端和 TypeScript 客户端共享的用例.
final class SyncKeyTests: XCTestCase {
    private struct Vectors: Decodable {
        struct Vector: Decodable { let input: String; let key: String }
        let vectors: [Vector]
    }

    func testMatchesSharedVectors() throws {
        // The simulator reads the repository checkout directly.
        //
        // 模拟器可以直接读取仓库中的文件.
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appending(path: "../../testdata/sync-key-vectors.json")
        let vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url)).vectors
        XCTAssertGreaterThanOrEqual(vectors.count, 10)
        for vector in vectors {
            XCTAssertEqual(normalizeSyncKey(vector.input), vector.key, "input: \(vector.input.debugDescription)")
        }
    }

    func testTrimKeepsInnerSpacing() {
        XCTAssertEqual(trimSyncText("\u{3000} Demo  Show \n"), "Demo  Show")
    }
}
