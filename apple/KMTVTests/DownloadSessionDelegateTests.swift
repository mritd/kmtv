import XCTest
@testable import KMTV

/// Covers the session delegate's synchronous file handling for finished download tasks.
///
/// 覆盖 session delegate 对已完成下载任务的同步文件处理.
final class DownloadSessionDelegateTests: XCTestCase {
    private var root: URL!

    override func setUp() {
        root = FileManager.default.temporaryDirectory.appending(path: "dsd-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: root)
    }

    private func tempFile(_ data: Data) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "tmp-\(UUID().uuidString)")
        try data.write(to: url)
        return url
    }

    func testMovesBodyToIncomingAndReportsResponse() throws {
        let layout = DownloadLayout(root: root)
        let id = DownloadTaskID(scopeHash: "s", showDir: "h", episodeDir: "e", generation: 2, entryIndex: 5)
        let url = URL(string: "https://cdn.example/a.ts")!
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "video/mp2t"])
        let body = Data([0x47, 1, 2, 3])
        let event = DownloadSessionDelegate.handleFinished(description: id.description, requestURL: url,
                                                           response: response, location: try tempFile(body), layout: layout)
        let destination = layout.incomingFile(id)
        XCTAssertEqual(event, .finished(id, DownloadResponseInfo(url: url, status: 200, contentType: "video/mp2t",
                                                                 head: body, size: 4, file: destination)))
        XCTAssertEqual(try Data(contentsOf: destination), body)
    }

    func testErrorBodiesAreKeptForClassification() throws {
        let layout = DownloadLayout(root: root)
        let id = DownloadTaskID(scopeHash: "s", showDir: "h", episodeDir: "e", generation: 1, entryIndex: 0)
        let url = URL(string: "https://kmtv.example/api/v1/proxy/segment?mt=x")!
        let response = HTTPURLResponse(url: url, statusCode: 401, httpVersion: nil, headerFields: nil)
        let body = Data(#"{"error":"invalid or expired media token"}"#.utf8)
        guard case .finished(_, let info) = DownloadSessionDelegate.handleFinished(
            description: id.description, requestURL: url, response: response, location: try tempFile(body), layout: layout
        ) else { return XCTFail("expected finished") }
        XCTAssertEqual(info.status, 401)
        XCTAssertEqual(info.head, body)
    }

    func testTransportErrorsMapToEventsAndDiskFullPauses() {
        let id = DownloadTaskID(scopeHash: "s", showDir: "h", episodeDir: "e", generation: 1, entryIndex: 3)
        func event(_ error: Error?) -> DownloadTransportEvent? {
            DownloadSessionDelegate.completionEvent(description: id.description, error: error)
        }
        XCTAssertNil(event(nil))
        XCTAssertNil(event(URLError(.cancelled)))
        XCTAssertNil(DownloadSessionDelegate.completionEvent(description: "other", error: URLError(.timedOut)))
        XCTAssertEqual(event(URLError(.timedOut)), .failed(id, .timedOut))
        // nsurlsessiond reports a full disk through the task's completion, not through a file move.
        //
        // nsurlsessiond 通过任务完成回调报告磁盘已满, 而不是通过文件移动.
        XCTAssertEqual(event(URLError(.cannotWriteToFile)), .storageFull(id))
        XCTAssertEqual(event(URLError(.cannotCreateFile)), .storageFull(id))
        XCTAssertEqual(event(NSError(domain: NSURLErrorDomain, code: NSURLErrorCannotWriteToFile)), .storageFull(id))
        let enospc = NSError(domain: NSPOSIXErrorDomain, code: Int(ENOSPC))
        XCTAssertEqual(event(URLError(.unknown, userInfo: [NSUnderlyingErrorKey: enospc])), .storageFull(id))
    }

    func testForeignTasksAreIgnored() throws {
        XCTAssertNil(DownloadSessionDelegate.handleFinished(description: "other", requestURL: nil, response: nil,
                                                            location: try tempFile(Data()), layout: DownloadLayout(root: root)))
        XCTAssertNil(DownloadSessionDelegate.handleFinished(description: nil, requestURL: nil, response: nil,
                                                            location: try tempFile(Data()), layout: DownloadLayout(root: root)))
    }
}
