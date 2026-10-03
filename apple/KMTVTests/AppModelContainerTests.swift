import SwiftData
import XCTest
@testable import KMTV

/// Covers removal of the pre-sync SwiftData store files.
///
/// 覆盖同步改造前 SwiftData 存储文件的删除.
final class AppModelContainerTests: XCTestCase {
    func testRemovesOnlyLegacyStoreFiles() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        for name in ["default.store", "default.store-shm", "default.store-wal", "KMTV-sync-v1.store"] {
            FileManager.default.createFile(atPath: directory.appending(path: name).path, contents: Data())
        }

        AppModelContainer.removeLegacyStore(in: directory)

        let remaining = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertEqual(remaining, ["KMTV-sync-v1.store"])
    }

    func testLegacyStoreDirectoryIsWhereSwiftDataPutsTheDefaultStore() {
        XCTAssertEqual(ModelConfiguration().url.lastPathComponent, "default.store")
    }
}
