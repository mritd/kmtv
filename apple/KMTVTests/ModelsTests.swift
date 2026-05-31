import XCTest
@testable import KMTV

final class ModelsTests: XCTestCase {

    func testDecodeSearchResponse() throws {
        let json = """
        {
            "results": [{
                "title": "Test Movie",
                "type": "电影",
                "year": "2024",
                "cover": "https://img.example.com/cover.jpg",
                "desc": "A test movie",
                "sources": [{
                    "source_key": "example.com",
                    "source_name": "Example",
                    "is_adult": true,
                    "video_id": "123",
                    "duration_ms": 450,
                    "episodes": [{"name": "HD", "url": "https://example.com/video.m3u8"}]
                }]
            }]
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(SearchResponse.self, from: json)
        XCTAssertEqual(response.results.count, 1)
        XCTAssertEqual(response.results[0].title, "Test Movie")
        XCTAssertEqual(response.results[0].sources[0].sourceKey, "example.com")
        XCTAssertTrue(response.results[0].sources[0].isAdult)
        XCTAssertEqual(response.results[0].sources[0].durationMs, 450)
        XCTAssertEqual(response.results[0].sources[0].episodes[0].name, "HD")
    }

    func testDecodeVideoDetail() throws {
        let json = """
        {
            "id": "456",
            "title": "Test",
            "type": "电影",
            "year": "2024",
            "cover": "https://img.example.com/cover.jpg",
            "desc": "desc",
            "director": "Director",
            "actor": "Actor",
            "area": "CN",
            "episodes": [
                [{"name": "EP1", "url": "https://cdn1.com/ep1.m3u8"}],
                [{"name": "EP1", "url": "https://cdn2.com/ep1.m3u8"}]
            ]
        }
        """.data(using: .utf8)!

        let detail = try JSONDecoder().decode(VideoDetail.self, from: json)
        XCTAssertEqual(detail.id, "456")
        XCTAssertEqual(detail.episodes.count, 2)
        XCTAssertEqual(detail.episodes[0][0].url, "https://cdn1.com/ep1.m3u8")
        XCTAssertEqual(detail.episodes[1][0].url, "https://cdn2.com/ep1.m3u8")
    }

    func testDecodeDoubanHome() throws {
        let json = """
        {
            "sections": [{
                "name": "热门电影",
                "tag": "热门",
                "type": "movie",
                "items": [{"id": "1", "title": "Movie", "cover": "https://img.example.com/1.jpg", "rate": "8.5", "year": "2024"}]
            }]
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(DoubanHomeResponse.self, from: json)
        XCTAssertEqual(response.sections.count, 1)
        XCTAssertEqual(response.sections[0].name, "热门电影")
        XCTAssertEqual(response.sections[0].items[0].rate, "8.5")
    }

    func testDecodeUserWithAvatar() throws {
        let json = """
        {"id": 1, "username": "admin", "role": "admin", "allow_adult_content": true, "avatar": "/api/avatar/admin"}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(User.self, from: json)
        XCTAssertEqual(user.id, 1)
        XCTAssertEqual(user.role, "admin")
        XCTAssertTrue(user.allowAdultContent)
        XCTAssertEqual(user.avatar, "/api/avatar/admin")
    }

    func testDecodeUserWithoutAvatar() throws {
        let json = """
        {"id": 2, "username": "user1", "role": "user"}
        """.data(using: .utf8)!

        let user = try JSONDecoder().decode(User.self, from: json)
        XCTAssertNil(user.avatar)
        XCTAssertFalse(user.allowAdultContent)
    }

    func testDecodeLoginResponseWithToken() throws {
        let json = """
        {
            "id": 1,
            "username": "admin",
            "role": "admin",
            "allow_adult_content": true,
            "access_token": "Base58AccessToken",
            "expires_at": "2026-05-23T12:00:00Z",
            "avatar": "/api/v1/avatar/admin"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let response = try decoder.decode(LoginResponse.self, from: json)

        XCTAssertEqual(response.user.id, 1)
        XCTAssertEqual(response.user.username, "admin")
        XCTAssertTrue(response.user.allowAdultContent)
        XCTAssertEqual(response.accessToken, "Base58AccessToken")
        XCTAssertEqual(response.user.avatar, "/api/v1/avatar/admin")
    }

    func testDecodePlaybackURLResponse() throws {
        let json = """
        {
            "mode": "proxy",
            "url": "https://kmtv.example/api/v1/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Fv.m3u8&source=source-a&mt=Base58MediaToken"
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(PlaybackURLResponse.self, from: json)

        XCTAssertEqual(response.mode, "proxy")
        XCTAssertTrue(response.url.contains("/api/v1/proxy/m3u8"))
        XCTAssertTrue(response.url.contains("mt=Base58MediaToken"))
    }

    func testDecodeAdminSources() throws {
        let json = """
        {
            "sources": [{
                "id": 1, "key": "source-a", "name": "Source A", "api": "https://source-a.example/api",
                "detail": "", "enabled": true, "is_adult": true, "searchable": true, "comment": "",
                "health": "healthy", "last_check": "2026-03-28T10:00:00Z",
                "created_at": "2026-03-28T00:00:00Z", "updated_at": "2026-03-28T10:00:00Z"
            }]
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let response = try decoder.decode(SourcesResponse.self, from: json)
        XCTAssertEqual(response.sources[0].key, "source-a")
        XCTAssertEqual(response.sources[0].health, "healthy")
        XCTAssertTrue(response.sources[0].enabled)
        XCTAssertTrue(response.sources[0].isAdult)
    }

    func testDecodeAdminSettings() throws {
        let json = """
        {
            "settings": {
                "site_name": "KMTV",
                "anonymous_access": "false",
                "nsfw_filter_enabled": "true",
                "douban_image_proxy": "server",
                "access_token_ttl": "604800",
                "media_token_ttl": "21600",
                "playback_mode": "proxy"
            }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(SettingsResponse.self, from: json)
        XCTAssertEqual(response.settings["site_name"], "KMTV")
        XCTAssertEqual(response.settings["nsfw_filter_enabled"], "true")
        XCTAssertEqual(response.settings["douban_image_proxy"], "server")
        XCTAssertEqual(response.settings["access_token_ttl"], "604800")
        XCTAssertEqual(response.settings["media_token_ttl"], "21600")
        XCTAssertEqual(response.settings["playback_mode"], "proxy")
    }

    func testDecodeSubscriptions() throws {
        let json = """
        {
            "subscriptions": [{
                "id": 1, "url": "https://example.com/config.json",
                "auto_update": true, "interval": 86400,
                "last_sync": "2026-03-28T10:00:00Z", "updated_at": "2026-03-28T10:00:00Z"
            }]
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let response = try decoder.decode(SubscriptionsResponse.self, from: json)
        XCTAssertEqual(response.subscriptions[0].interval, 86400)
        XCTAssertTrue(response.subscriptions[0].autoUpdate)
    }
}
