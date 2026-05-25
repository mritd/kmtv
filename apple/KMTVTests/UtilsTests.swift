import XCTest
@testable import KMTV

final class UtilsTests: XCTestCase {
    func testHTTPURLValidationAcceptsOnlyHTTPHosts() {
        XCTAssertTrue(isValidHTTPURL("https://kmtv.example.com"))
        XCTAssertTrue(isValidHTTPURL("http://192.0.2.1:8080"))
        XCTAssertFalse(isValidHTTPURL("ftp://example.com"))
        XCTAssertFalse(isValidHTTPURL("https://"))
        XCTAssertFalse(isValidHTTPURL("not a url"))
    }

    func testSafeSubscriptHandlesOutOfBounds() {
        let values = [1, 2, 3]
        XCTAssertEqual(values[safe: 1], 2)
        XCTAssertNil(values[safe: -1])
        XCTAssertNil(values[safe: 3])
    }

    func testDisplayFormatters() {
        XCTAssertEqual(DisplayFormatters.latency(250), "250ms")
        XCTAssertEqual(DisplayFormatters.latency(1500), "1.5s")
        XCTAssertEqual(DisplayFormatters.cleanSourceName("🎬 Source A"), "Source A")
        XCTAssertEqual(DisplayFormatters.bestDescription(title: "Movie", desc: "Movie"), nil)
    }

    func testSearchRowIdentitySeparatesSkeletonAndResultRows() {
        XCTAssertNotEqual(SearchRowIdentity.skeleton(0), SearchRowIdentity.result(0))
        XCTAssertEqual(SearchRowIdentity.result(2), SearchRowIdentity.result(2))
    }

    func testFlowLayoutCanBeConstructed() {
        let layout = FlowLayout(spacing: 12)
        XCTAssertEqual(layout.spacing, 12)
    }

    func testVersionCompatibilityAcceptsEqualAndNewerVersions() {
        XCTAssertTrue(VersionCompatibility.isCompatible("v1.0.0", minimum: "v1.0.0"))
        XCTAssertTrue(VersionCompatibility.isCompatible("v1.2.0", minimum: "v1.0.0"))
        XCTAssertTrue(VersionCompatibility.isCompatible("v1.0.0-1-gabcdef0", minimum: "v1.0.0"))
        XCTAssertTrue(VersionCompatibility.isCompatible("v1.0.0-dirty", minimum: "v1.0.0"))
    }

    func testVersionCompatibilityRejectsOlderVersions() {
        XCTAssertFalse(VersionCompatibility.isCompatible("v0.9.9", minimum: "v1.0.0"))
        XCTAssertFalse(VersionCompatibility.isCompatible("v0.9.9-1-gabcdef0", minimum: "v1.0.0"))
    }

    func testVersionCompatibilityAcceptsDevelopmentVersion() {
        XCTAssertTrue(VersionCompatibility.isCompatible("v0.0.0-dev", minimum: "v1.0.0"))
    }

    func testVersionCompatibilityRejectsMalformedVersions() {
        XCTAssertFalse(VersionCompatibility.isCompatible("dev", minimum: "v1.0.0"))
        XCTAssertFalse(VersionCompatibility.isCompatible("v1.0", minimum: "v1.0.0"))
    }
}
