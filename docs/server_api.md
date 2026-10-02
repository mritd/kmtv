# KMTV Server API Reference

This document is the current `/api/v1` server API contract, derived from `server/internal/handler/handler.go` and the handler implementations.

## Conventions

- Base path: `/api/v1`.
- JSON error shape: `{"code": number, "error": string}`.
- Authentication uses `Authorization: Bearer <access_token>`.
- Cookie sessions are not supported.
- Protected routes require a valid bearer token unless `anonymous_access` allows anonymous user access.
- Admin routes require a valid bearer token and `role == "admin"`.
- Media proxy endpoints require URL-bound media tokens through the `mt` query parameter.
- Request bodies are JSON unless an endpoint says otherwise.
- Global request body limit is 10 MB.

## Error Codes

| Code | Name                   | Default Message                       |
|------|------------------------|---------------------------------------|
| 1000 | `InvalidRequest`       | `invalid request body`                |
| 1001 | `InvalidCredentials`   | `invalid username or password`        |
| 1002 | `NotLoggedIn`          | `not logged in`                       |
| 1003 | `UserNotFound`         | `user not found`                      |
| 1004 | `UsernameTaken`        | `username already taken`              |
| 1005 | `IncorrectPassword`    | `incorrect old password`              |
| 1100 | `MissingAvatar`        | `missing avatar file`                 |
| 1101 | `FileTooLarge`         | `file too large, max 256KB`           |
| 1102 | `UnsupportedImageType` | `unsupported image type`              |
| 1103 | `NoAvatar`            | `no avatar`                           |
| 1104 | `InvalidData`          | `invalid avatar data`                 |
| 1200 | `InvalidID`            | `invalid id`                          |
| 1201 | `MissingFields`        | `required fields missing`             |
| 1202 | `InvalidURL`           | `invalid URL`                         |
| 1203 | `InvalidRole`          | `role must be 'admin' or 'user'`      |
| 1204 | `NotFound`             | `resource not found`                  |
| 1205 | `UnknownSetting`       | `unknown setting`                     |
| 1206 | `LastAdmin`            | `cannot remove the last admin`        |
| 1207 | `SelfDelete`           | `cannot delete your own account`      |
| 1209 | `EpochMismatch`        | `sync epoch mismatch`                 |
| 1210 | `SyncCursorAhead`      | `sync cursor ahead of server`         |
| 1300 | `ServerError`          | `internal server error`               |
| 1301 | `MissingParam`         | `missing required parameter`          |
| 1302 | `Blocked`              | `request blocked`                     |
| 1303 | `GatewayError`         | `external service unavailable`        |

Handlers may override the default message while preserving the same code.

## Auth

### `POST /auth/login`

Public. Verifies credentials and returns an opaque bearer token.

Request:

```json
{
  "username": "admin",
  "password": "admin"
}
```

Success `200`:

```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "access_token": "base58-token",
  "expires_at": "2026-05-23T12:00:00Z",
  "avatar": "/api/v1/avatar/admin"
}
```

`avatar` is omitted when no avatar is stored.

Common errors: `400 InvalidRequest`, `401 InvalidCredentials`, `500 ServerError`.

### `POST /auth/logout`

Protected. Revokes the current bearer token when `Authorization` is provided.

Success `200`:

```json
{"message": "logged out"}
```

### `GET /auth/me`

Public. Returns the current bearer-token user. If no valid bearer token exists and `anonymous_access == "true"`, returns an anonymous user.

Success `200`:

```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "avatar": "/api/v1/avatar/admin"
}
```

Anonymous success `200`:

```json
{
  "id": 0,
  "username": "anonymous",
  "role": "user"
}
```

Common errors: `401 NotLoggedIn`.

### `PUT /auth/profile`

Protected. Updates the current user's username.

Request:

```json
{"username": "new_name"}
```

Success `200`:

```json
{
  "id": 1,
  "username": "new_name",
  "role": "admin",
  "avatar": "/api/v1/avatar/new_name"
}
```

Common errors: `400 InvalidRequest`, `401 NotLoggedIn`, `409 UsernameTaken`, `500 ServerError`.

### `PUT /auth/password`

Protected. Changes the current user's password.

Request:

```json
{
  "old_password": "old-password",
  "new_password": "new-password"
}
```

Success `200`:

```json
{"message": "password updated"}
```

Common errors: `400 InvalidRequest`, `401 NotLoggedIn`, `401 IncorrectPassword`, `500 ServerError`.

### `PUT /auth/avatar`

Protected. Multipart upload. Field name: `avatar`.

Accepted content types after byte sniffing: `image/jpeg`, `image/png`, `image/gif`, `image/webp`.

Maximum avatar size: 256 KB.

Success `200`:

```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "avatar": "/api/v1/avatar/admin"
}
```

Common errors: `400 MissingAvatar`, `400 FileTooLarge`, `400 UnsupportedImageType`, `500 ServerError`.

### `DELETE /auth/avatar`

Protected. Removes the current user's avatar.

Success `200`:

```json
{
  "id": 1,
  "username": "admin",
  "role": "admin"
}
```

Common errors: `401 NotLoggedIn`, `500 ServerError`.

### `GET /avatar/{username}`

Protected. Returns the avatar image bytes for `username`.

Success `200`: image body with the stored content type and `Cache-Control: public, max-age=3600`.

Common errors: `400 InvalidRequest`, `404 NoAvatar`, `500 ServerError`, `500 InvalidData`.

## Settings

### `GET /settings`

Public with optional auth. Anonymous and normal users receive public settings only. Admin users receive all allowed settings.

Success `200`:

```json
{
  "settings": {
    "version": "v0.0.0-dev"
  }
}
```

Admin-visible setting keys:

- `site_name`
- `anonymous_access`
- `health_check_interval`
- `nsfw_filter_enabled`
- `douban_image_proxy`
- `search_concurrency`
- `probe_concurrency`
- `probe_timeout`
- `search_timeout`
- `public_base_url`
- `access_token_ttl`
- `media_token_ttl`
- `playback_mode`
- `version`

`public_base_url` configures the external base URL used when rewriting M3U8 proxy links. `KMTV_PUBLIC_BASE_URL` has higher priority than this DB setting. If neither is configured, KMTV keeps the current forwarded-header fallback behavior.

`media_token_ttl` defaults to 21600 seconds so URL-bound proxy playback tokens stay valid across long episodes.

Common errors: `500 ServerError`.

### `PUT /admin/settings`

Admin. Updates settings from a key-value map.

Request:

```json
{
  "site_name": "KMTV",
  "anonymous_access": "false"
}
```

Success `200`:

```json
{"message": "settings updated"}
```

Common errors: `400 InvalidRequest`, `400 UnknownSetting`, `500 ServerError`.

## Search And Detail

### `GET /search`

Protected. Aggregates search results across enabled and healthy video sources.

Results are merged only when `title` and `year` match after trimming leading and trailing whitespace. Internal whitespace, punctuation, symbols, and letter case remain significant, so textually different titles stay in separate result cards. Within one result, `sources` contains at most one entry for each `source_key`.

Query parameters:

| Name   | Required | Default | Description        |
|--------|----------|---------|--------------------|
| `q`    | Yes      | -       | Search keyword     |
| `page` | No       | `1`     | Positive page num  |

Success `200`:

```json
{
  "results": [
    {
      "title": "Movie",
      "type": "Movie",
      "year": "2026",
      "cover": "https://example.com/cover.jpg",
      "desc": "Description",
      "sources": [
        {
          "source_key": "source.example",
          "source_name": "Source",
          "video_id": "123",
          "duration_ms": 12,
          "episodes": [
            {
              "name": "Episode 1",
              "url": "https://example.com/1.m3u8"
            }
          ]
        }
      ]
    }
  ]
}
```

Common errors: `400 MissingParam`, `401 NotLoggedIn`, `500 ServerError`.

### `GET /search/stream`

Protected. Server-Sent Events version of search.

Query parameters are the same as `GET /search`.

Events:

```text
event: progress
data: {"phase":"searching","completed":1,"total":3}

event: progress
data: {"phase":"probing","completed":1,"total":3}

event: result
data: {"results":[...]}
```

On search failure:

```text
event: error
data: {"message":"search failed"}
```

Common errors before streaming starts: `400 MissingParam`, `401 NotLoggedIn`, `500 ServerError`.

### `GET /search/suggestions`

Protected. Currently returns an empty suggestion list.

Query parameters:

| Name | Required | Description    |
|------|----------|----------------|
| `q`  | No       | Ignored today  |

Success `200`:

```json
{"suggestions": []}
```

### `GET /detail`

Protected. Fetches detail from a specific video source and probes playable CDN lines.

Query parameters:

| Name     | Required | Description                     |
|----------|----------|---------------------------------|
| `source` | Yes      | Source key from search results  |
| `id`     | Yes      | Video ID from search results    |

Success `200`:

```json
{
  "id": "123",
  "title": "Movie",
  "type": "Movie",
  "year": "2026",
  "cover": "https://example.com/cover.jpg",
  "desc": "Description",
  "director": "Director",
  "actor": "Actor",
  "area": "Area",
  "episodes": [
    [
      {
        "name": "Episode 1",
        "url": "https://example.com/1.m3u8"
      }
    ]
  ]
}
```

Common errors: `400 MissingParam`, `404 NotFound`, `500 ServerError`.

## Sync

Sync endpoints require a real logged-in user. When `anonymous_access == "true"`, anonymous
viewers may still browse and play, but these endpoints return `401 NotLoggedIn`; clients keep
anonymous data local and must not treat this 401 as a session expiry.

Every synchronized item is a record identified by `(kind, key)`:

| kind       | key                         | payload fields | cap |
|------------|-----------------------------|----------------|-----|
| `watch`    | normalized `title`          | `title, cover, source_key, video_id, episode, group_index, episode_index, progress_sec, duration_sec, completed` | 200 newest kept |
| `favorite` | normalized `title`          | `title, cover, type, year, rate, desc, source_key, video_id` | 1000; new keys beyond it get `limit` |
| `search`   | normalized `query`          | `query` | 50 newest kept |

Key normalization splits on whitespace (`\t \n \v \f \r`, space, U+0085, U+00A0, U+1680,
U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000), joins the parts with one space, and
lowercases the result. The server's key is canonical. `testdata/sync-key-vectors.json` lists the
reference cases.

Payload limits (in Unicode code points): `title`, `episode`, and `query` 512; `source_key` and
`video_id` 1024; `cover` 8192; `type`, `year`, and `rate` 64; `desc` 2048. `group_index` and
`episode_index` are non-negative integers; `progress_sec` and `duration_sec` are finite and
non-negative. Unknown payload fields are dropped and text is trimmed.

A write with event time `t` wins only if `t` is strictly greater than the stored record's event time
and greater than the kind's clear time. Event times more than one second ahead of the server clock
are clamped to the server clock (when a push has such a time, its times from `now` on are renumbered `now, now+1, ...` in their original order). Deletes leave a tombstone that is kept for 90 days. When `watch` or
`search` exceeds its cap, the oldest rows become tombstones with a new `rev`.

### `POST /sync/push`

Protected. Applies up to 200 changes in one transaction. Body limit 256 KiB.

```json
{
  "epoch": "QJ4D...",
  "cursor": 41,
  "changes": [
    {"kind": "watch", "op": "upsert", "event_time_ms": 1790000000000,
     "payload": {"title": "Movie", "episode_index": 1, "progress_sec": 42, "duration_sec": 1800}},
    {"kind": "favorite", "op": "delete", "key": "movie", "event_time_ms": 1790000000001},
    {"kind": "search", "op": "clear", "event_time_ms": 1790000000002}
  ]
}
```

`epoch` is empty on a client's first sync. `cursor` is the client's pull cursor (`0` if it has not
pulled). A non-empty `epoch` that differs from the server's fails the whole request with `409`:

```json
{"code": 1209, "error": "sync epoch mismatch", "epoch": "<current epoch>"}
```

With a matching `epoch`, a `cursor` greater than the user's current revision means the server was
restored from an older copy. The request fails before anything is applied:

```json
{"code": 1210, "error": "sync cursor ahead of server", "epoch": "<current epoch>"}
```

Clients resolve both `409` responses by pulling, which returns `reset: true` (see `GET /sync/pull`).

Success `200`:

```json
{
  "epoch": "QJ4D...",
  "rev": 42,
  "server_time_ms": 1790000000100,
  "results": [
    {"index": 0, "status": "applied", "record": {"kind": "watch", "key": "movie", "payload": {}, "event_time_ms": 1790000000000, "deleted": false, "rev": 41}},
    {"index": 1, "status": "stale", "record": {"kind": "favorite", "key": "movie", "payload": {}, "event_time_ms": 1790000000050, "deleted": false, "rev": 39}},
    {"index": 2, "status": "applied", "record": null, "clear": {"kind": "search", "cleared_at_ms": 1790000000002, "rev": 42}}
  ]
}
```

| status    | meaning |
|-----------|---------|
| `applied` | Stored. `record` is the stored row with the canonical key and stored event time. |
| `stale`   | Newer server state won. `record` is the current row (possibly a tombstone, including one created by trimming this write), or `null` when none exists. For a clear, `clear` is the current watermark. |
| `invalid` | Failed validation or could not be decoded; `reason` explains why. Other changes in the batch still apply. |
| `limit`   | The favorite cap is reached and the key has no live row (this includes reviving a tombstoned key). |

Common errors: `400 InvalidRequest`, `401 NotLoggedIn`, `409 EpochMismatch`, `409 SyncCursorAhead`, `500 ServerError`.

### `GET /sync/pull`

Protected. Returns changes after a revision cursor.

| Name    | Required | Default | Description |
|---------|----------|---------|-------------|
| `since` | No       | `0`     | Last `rev` the client applied |
| `epoch` | No       | empty   | Epoch the client last saw |
| `limit` | No       | `500`   | Items per page, capped at `1000` |
| `full`  | No       | `false` | Boolean (`1` or `true`); set on every page of a chain that started at `since=0` |

Success `200`:

```json
{
  "epoch": "QJ4D...",
  "server_time_ms": 1790000000100,
  "rev": 42,
  "reset": false,
  "has_more": false,
  "clears": [{"kind": "search", "cleared_at_ms": 1790000000002, "rev": 42}],
  "records": [{"kind": "watch", "key": "movie", "payload": {}, "event_time_ms": 1790000000000, "deleted": false, "rev": 41}]
}
```

Records and clears are ordered by `rev`. While `has_more` is true, `rev` is the highest rev on the
page. On the last page (`has_more: false`) it is the user's current revision, which can be above the
page's last item when the newest revisions belonged to purged tombstones; the page is read from one
snapshot that holds every row up to that revision, so nothing is skipped. Send `rev` back as the next
`since` and keep paging while `has_more` is true. Apply a page's clears before its records.

`reset: true` comes with empty lists and `rev` set to the user's current revision. It is returned
when `epoch` differs from the server's (the database was reset), when `since` is greater than
`rev` (the database was restored from an older copy), or when `since > 0`, `full` is not set, and
`since` is below the GC floor (`min_rev`, the highest rev of purged tombstones). In the first two
cases the server lost data the client has, so the client marks all local records for upload and
pulls again from `since=0`, unless the username stored for that scope differs from the current one,
in which case it drops that scope's local data instead (the user ID may now belong to another
account). In the last case the client runs a full resync: it pulls from `since=0` and drops synced
local records the server no longer has.

A client sends `full=1` on every page of a chain that started at `since=0` (a first sync or a full
resync). Such a chain rebuilds the client's state from scratch, so the server skips the GC floor
check for it: a tombstone purged mid-chain only hides a record that the client then drops as unseen
when the full resync ends. The `since > rev` check and the epoch check still apply.

Common errors: `400 InvalidRequest`, `401 NotLoggedIn`, `500 ServerError`.

## Douban

### `GET /douban/categories`

Protected. Returns category groups for browsing.

Success `200`:

```json
{
  "categories": [
    {
      "key": "movie",
      "name": "电影",
      "douban_kind": "movie",
      "format": "",
      "subcategories": [
        {"name": "全部", "tag": ""}
      ],
      "regions": [
        {"name": "全部", "value": ""}
      ]
    }
  ]
}
```

### `GET /douban/list`

Protected. Returns a paginated Douban list.

Query parameters:

| Name       | Required | Default | Description                      |
|------------|----------|---------|----------------------------------|
| `category` | No       | -       | Douban category                  |
| `type`     | Yes      | -       | `movie` or `tv`                  |
| `start`    | No       | `0`     | Zero-based offset                |
| `count`    | No       | `20`    | Page size, capped at `50`        |

Success `200`:

```json
{
  "items": [
    {"id": "1", "title": "Movie", "cover": "https://...", "rate": "8.0", "year": "2026"}
  ]
}
```

Common errors: `400 InvalidRequest`, `502 GatewayError`.

### `GET /douban/recommend`

Protected. Returns Douban recommendations.

Success `200`:

```json
{
  "items": [
    {"id": "1", "title": "Movie", "cover": "https://...", "rate": "8.0", "year": "2026"}
  ]
}
```

Common errors: `502 GatewayError`.

### `GET /douban/recommend/filter`

Protected. Returns Douban items filtered by kind, tag, format, and region.

Query parameters:

| Name     | Required | Default | Description                         |
|----------|----------|---------|-------------------------------------|
| `kind`   | Yes      | -       | Douban kind, such as `movie` or `tv` |
| `tag`    | No       | -       | Ranking or category tag             |
| `format` | No       | -       | Display format filter               |
| `region` | No       | -       | Region filter                       |
| `start`  | No       | `0`     | Zero-based offset                   |
| `count`  | No       | `20`    | Page size, capped at `50`           |

Success `200`:

```json
{
  "items": [
    {"id": "1", "title": "Movie", "cover": "https://...", "rate": "8.0", "year": "2026"}
  ]
}
```

Common errors: `400 MissingParam`, `502 GatewayError`.

### `GET /douban/home`

Protected. Returns pre-fetched home sections.

Success `200`:

```json
{
  "sections": [
    {
      "name": "热门电影",
      "tag": "热门",
      "type": "movie",
      "items": [
        {"id": "1", "title": "Movie", "cover": "https://...", "rate": "8.0", "year": "2026"}
      ]
    }
  ]
}
```

## Proxy

### `POST /playback/url`

Protected. Returns the playable URL for the configured playback mode.

Request:

```json
{
  "url": "https://media.example/index.m3u8",
  "source": "source-key"
}
```

Proxy mode success `200`:

```json
{
  "mode": "proxy",
  "url": "https://kmtv.example/api/v1/proxy/m3u8?url=...&source=source-key&mt=..."
}
```

Direct mode success `200`:

```json
{
  "mode": "direct",
  "url": "https://media.example/index.m3u8"
}
```

Common errors: `400 InvalidRequest`, `401 NotLoggedIn`, `403 Blocked`, `500 ServerError`.

### `GET /proxy/image`

Public. Proxies Douban images with a domain whitelist.

Query parameters:

| Name  | Required | Description                        |
|-------|----------|------------------------------------|
| `url` | Yes      | `http` or `https` Douban image URL |

Allowed image hosts: `doubanio.com` and `*.doubanio.com`.

Success `200`: image body, upstream content type when present, and `Cache-Control: public, max-age=15720000`.

Common errors: `400 MissingParam`, `400 InvalidURL`, `403 Blocked`, `404 NotFound`, `502 ServerError`.

### `GET /proxy/m3u8`

Public media endpoint. Fetches an upstream M3U8 and rewrites segment/key URLs back through KMTV proxy endpoints. Requires a valid media token issued for the exact M3U8 URL.

Query parameters:

| Name     | Required | Description                        |
|----------|----------|------------------------------------|
| `url`    | Yes      | Upstream `http` or `https` M3U8 URL |
| `source` | No       | Source key added to rewritten URLs |
| `mt`     | Yes      | URL-bound media token               |

Success `200`: `application/vnd.apple.mpegurl` body.

Common errors: `400 MissingParam`, `401 NotLoggedIn`, `403 Blocked`, `404 NotFound`.

### `GET /proxy/segment`

Public media endpoint. Streams an upstream media segment. Requires a valid media token issued for the exact segment URL.

Query parameters:

| Name  | Required | Description                            |
|-------|----------|----------------------------------------|
| `url` | Yes      | Upstream `http` or `https` segment URL |
| `mt`  | Yes      | URL-bound media token                  |

Success: streams upstream status, selected headers, and body.

Common errors: `400 MissingParam`, `401 NotLoggedIn`, `403 Blocked`, `502 GatewayError`.

### `GET /proxy/key`

Public media endpoint. Streams an upstream encryption key. Query parameters and behavior match `/proxy/segment`, with a token issued for media kind `key`.

## Admin Sources

### `GET /admin/sources`

Admin. Returns all video sources.

Success `200`:

```json
{
  "sources": [
    {
      "id": 1,
      "key": "source.example",
      "name": "Source",
      "api": "https://source.example/api.php/provide/vod/",
      "detail": "https://source.example",
      "enabled": true,
      "searchable": true,
      "comment": "",
      "health": "unknown",
      "last_check": "2026-05-16T00:00:00Z",
      "created_at": "2026-05-16T00:00:00Z",
      "updated_at": "2026-05-16T00:00:00Z"
    }
  ]
}
```

### `POST /admin/sources`

Admin. Creates a video source.

Request:

```json
{
  "key": "source.example",
  "name": "Source",
  "api": "https://source.example/api.php/provide/vod/",
  "detail": "https://source.example",
  "enabled": true,
  "searchable": true,
  "comment": ""
}
```

Success `201`: created source object.

Common errors: `400 InvalidRequest`, `400 MissingFields`, `400 InvalidURL`, `500 ServerError`.

### `PUT /admin/sources/{id}`

Admin. Updates a video source.

Request body uses source fields. `api` is validated when non-empty.

Success `200`:

```json
{"message": "source updated"}
```

Common errors: `400 InvalidID`, `400 InvalidRequest`, `400 InvalidURL`, `404 NotFound`, `500 ServerError`.

### `DELETE /admin/sources/{id}`

Admin. Deletes a video source.

Success `200`:

```json
{"message": "source deleted"}
```

Common errors: `400 InvalidID`, `404 NotFound`, `500 ServerError`.

### `POST /admin/sources/{id}/check`

Admin. Checks a single source's health.

Success `200`:

```json
{"health": "healthy"}
```

Common errors: `400 InvalidID`, `500 ServerError`.

### `POST /admin/sources/check-all`

Admin. Starts an async health check for all enabled sources.

Success `200`:

```json
{"message": "health check started"}
```

### `POST /admin/sources/bulk-enabled`

Admin. Atomically toggles the `enabled` flag for many sources at once. Designed
to replace fan-out PUTs from admin UIs (e.g. "Enable all NSFW sources"), which
previously raced against the SQLite writer lock and failed with `SQLITE_BUSY`.

Request:

```json
{
  "ids": [1, 2, 3],
  "enabled": true
}
```

Success `200`:

```json
{"message": "sources updated", "count": 3}
```

Common errors: `400 InvalidRequest`, `400 MissingFields` (when `ids` is empty), `404 NotFound` (when any id is missing), `500 ServerError`.

### `POST /admin/sources/import`

Admin. Imports sources from a compatible source config JSON body.

Success `200`:

```json
{"imported": 3}
```

Common errors: `400 InvalidRequest`, `500 ServerError`.

## Admin Subscriptions

### `GET /admin/subscriptions`

Admin. Returns all source subscriptions.

Success `200`:

```json
{
  "subscriptions": [
    {
      "id": 1,
      "url": "https://example.com/config.json",
      "auto_update": true,
      "interval": 3600,
      "last_sync": "2026-05-16T00:00:00Z",
      "updated_at": "2026-05-16T00:00:00Z"
    }
  ]
}
```

### `POST /admin/subscriptions`

Admin. Creates a subscription.

Request:

```json
{
  "url": "https://example.com/config.json",
  "auto_update": true,
  "interval": 3600
}
```

Success `201`: created subscription object.

Common errors: `400 InvalidRequest`, `400 MissingFields`, `400 InvalidURL`, `500 ServerError`.

### `PUT /admin/subscriptions/{id}`

Admin. Updates a subscription.

Success `200`:

```json
{"message": "subscription updated"}
```

Common errors: `400 InvalidID`, `400 InvalidRequest`, `400 InvalidURL`, `404 NotFound`, `500 ServerError`.

### `DELETE /admin/subscriptions/{id}`

Admin. Deletes a subscription.

Success `200`:

```json
{"message": "subscription deleted"}
```

Common errors: `400 InvalidID`, `404 NotFound`, `500 ServerError`.

### `POST /admin/subscriptions/{id}/sync`

Admin. Immediately syncs one subscription.

Success `200`:

```json
{"message": "subscription synced"}
```

Common errors: `400 InvalidID`, `500 ServerError`.

## Admin Users

### `GET /admin/users`

Admin. Returns all users without password or avatar data.

Success `200`:

```json
{
  "users": [
    {
      "id": 1,
      "username": "admin",
      "role": "admin",
      "created_at": "2026-05-16T00:00:00Z",
      "updated_at": "2026-05-16T00:00:00Z"
    }
  ]
}
```

### `POST /admin/users`

Admin. Creates a user.

Request:

```json
{
  "username": "user",
  "password": "password",
  "role": "user"
}
```

Success `201`:

```json
{
  "id": 2,
  "username": "user",
  "role": "user"
}
```

Common errors: `400 InvalidRequest`, `400 InvalidRole`, `400 MissingFields`, `500 ServerError`.

### `PUT /admin/users/{id}`

Admin. Updates username, role, and optionally password.

Request:

```json
{
  "username": "user",
  "password": "new-password",
  "role": "user"
}
```

`password` may be empty to keep the existing password.

Success `200`:

```json
{"message": "user updated"}
```

Common errors: `400 InvalidID`, `400 InvalidRequest`, `400 InvalidRole`, `403 LastAdmin`, `404 NotFound`, `500 ServerError`.

### `DELETE /admin/users/{id}`

Admin. Deletes a user.

The current user cannot delete their own account. The last admin cannot be deleted.

Success `200`:

```json
{"message": "user deleted"}
```

Common errors: `400 InvalidID`, `403 SelfDelete`, `403 LastAdmin`, `404 NotFound`, `500 ServerError`.

## Compatibility Notes

- `/api/v1/proxy/m3u8`, `/api/v1/proxy/segment`, and `/api/v1/proxy/key` are public media endpoints but require URL-bound `mt` media tokens.
- Search and detail IDs are strings at the KMTV API boundary, even when upstream source IDs are numbers.
- Upstream source responses are treated as untrusted and inconsistent.
- `GET /settings` always includes `version`.
- Current route registration has no documented route aliases outside `/api/v1`.
