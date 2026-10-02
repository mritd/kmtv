import XCTest
import SwiftData
@testable import KMTV

final class StorageTests: XCTestCase {
    @MainActor
    func testServerCRUD() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext

        let server = Server(url: "https://kmtv.example.com")
        context.insert(server)
        try context.save()

        let servers = try context.fetch(FetchDescriptor<Server>())
        XCTAssertEqual(servers.count, 1)
        XCTAssertEqual(servers[0].url, "https://kmtv.example.com")
    }

    @MainActor
    func testServerTrailingSlash() throws {
        let server = Server(url: "https://kmtv.example.com/")
        XCTAssertEqual(server.url, "https://kmtv.example.com")
    }

    @MainActor
    func testServerCurrent() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext

        XCTAssertNil(Server.current(in: context))

        let server = Server(url: "https://s1.com")
        context.insert(server)
        try context.save()

        XCTAssertEqual(Server.current(in: context)?.url, "https://s1.com")
    }

    @MainActor
    func testServerDeleteAll() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext

        context.insert(Server(url: "https://s1.com"))
        context.insert(Server(url: "https://s2.com"))
        try context.save()

        Server.deleteAll(in: context)
        let servers = try context.fetch(FetchDescriptor<Server>())
        XCTAssertEqual(servers.count, 0)
    }
}
