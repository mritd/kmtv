import XCTest
@testable import KMTV

/// Covers lenient payload decoding, coercion, keys, and wire encoding.
///
/// 覆盖宽松的 payload 解码, 规整, key 以及传输格式编码.
final class SyncModelsTests: XCTestCase {
    func testLenientPayloadDecoding() throws {
        let json = #"""
        {"kind":"watch","key":"demo","event_time_ms":5,"deleted":false,"rev":2,
         "payload":{"title":7,"cover":null,"source_key":" s1 ","group_index":-2,"episode_index":2.7,
                    "progress_sec":"12","duration_sec":30,"completed":"yes"}}
        """#
        let record = try JSONDecoder().decode(SyncRecordWire.self, from: Data(json.utf8))
        XCTAssertEqual(record.kind, .watch)
        XCTAssertEqual(record.payload?.watch, WatchPayload(
            title: "", cover: "", sourceKey: "s1", videoId: "", episode: "",
            groupIndex: 0, episodeIndex: 2, progressSec: 0, durationSec: 30, completed: false
        ))

        let favorite = try JSONDecoder().decode(SyncRecordWire.self, from: Data(#"{"kind":"favorite","key":"x","payload":null,"event_time_ms":1,"deleted":false,"rev":1}"#.utf8))
        XCTAssertEqual(favorite.payload?.favorite, FavoritePayload(title: ""))
        let search = try JSONDecoder().decode(SyncRecordWire.self, from: Data(#"{"kind":"search","key":"x","payload":["x"],"event_time_ms":1,"deleted":false,"rev":1}"#.utf8))
        XCTAssertEqual(search.payload?.search, SearchPayload(query: ""))
    }

    func testUnknownKindIsSkipped() throws {
        let json = #"{"epoch":"e","server_time_ms":1,"rev":3,"reset":false,"has_more":false,"clears":null,"records":[{"kind":"history","key":"x","payload":{},"event_time_ms":1,"deleted":false,"rev":3}]}"#
        let page = try JSONDecoder().decode(SyncPullResponse.self, from: Data(json.utf8))
        XCTAssertEqual(page.clears, [])
        XCTAssertNil(page.records.first?.kind)
        XCTAssertNil(page.records.first?.payload)
    }

    func testKeysAndCoercion() {
        XCTAssertEqual(SyncPayload.watch(WatchPayload(title: " Demo  Show ")).key, "demo show")
        XCTAssertEqual(SyncPayload.search(SearchPayload(query: "Alpha")).key, "alpha")
        let coerced = WatchPayload(title: " T ", groupIndex: -1, progressSec: .nan, durationSec: -3).coerced()
        XCTAssertEqual(coerced, WatchPayload(title: "T"))
        XCTAssertEqual(SyncKind.watch.cap, 200)
        XCTAssertEqual(SyncKind.search.cap, 50)
        XCTAssertNil(SyncKind.favorite.cap)
        XCTAssertEqual(SyncKind.allCases, [.favorite, .search, .watch])
    }

    func testChangeEncodingOmitsMissingFields() throws {
        let clear = SyncChangeWire(kind: .search, op: .clear, key: nil, payload: nil, eventTimeMs: 9)
        let upsert = SyncChangeWire(kind: .search, op: .upsert, key: nil, payload: .search(SearchPayload(query: "q")), eventTimeMs: 10)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        XCTAssertEqual(String(decoding: try encoder.encode(clear), as: UTF8.self), #"{"event_time_ms":9,"kind":"search","op":"clear"}"#)
        XCTAssertEqual(String(decoding: try encoder.encode(upsert), as: UTF8.self), #"{"event_time_ms":10,"kind":"search","op":"upsert","payload":{"query":"q"}}"#)
    }

    func testStoredPayloadRoundTrip() {
        let payload = SyncPayload.favorite(FavoritePayload(title: "Show", cover: "c", type: "Drama", year: "2025", rate: "8.1", desc: "d", sourceKey: "s", videoId: "v"))
        XCTAssertEqual(SyncPayload.decode(.favorite, from: payload.encodedData()), payload)
        XCTAssertEqual(SyncPayload.decode(.watch, from: Data("garbage".utf8)), .watch(WatchPayload(title: "")))
    }
}
