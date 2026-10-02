# KMTV Server API 中文参考

本文档是当前 `/api/v1` 服务端 API 契约的中文版本, 内容根据 `server/internal/handler/handler.go` 和 handler 实现整理.

## 约定

- 基础路径: `/api/v1`.
- JSON 错误格式: `{"code": number, "error": string}`.
- 认证使用 `Authorization: Bearer <access_token>`.
- 不支持 Cookie session.
- 受保护接口需要有效 bearer token, 除非 `anonymous_access` 允许匿名用户访问.
- Admin 接口需要有效 bearer token 且 `role == "admin"`.
- 媒体代理接口需要通过 `mt` 查询参数携带 URL 绑定的 media token.
- 除非接口单独说明, 请求体均为 JSON.
- 全局请求体大小限制为 10 MB.

## 错误码

| Code | Name                   | 默认消息                                |
|------|------------------------|-----------------------------------------|
| 1000 | `InvalidRequest`       | `invalid request body`                  |
| 1001 | `InvalidCredentials`   | `invalid username or password`          |
| 1002 | `NotLoggedIn`          | `not logged in`                         |
| 1003 | `UserNotFound`         | `user not found`                        |
| 1004 | `UsernameTaken`        | `username already taken`                |
| 1005 | `IncorrectPassword`    | `incorrect old password`                |
| 1100 | `MissingAvatar`        | `missing avatar file`                   |
| 1101 | `FileTooLarge`         | `file too large, max 256KB`             |
| 1102 | `UnsupportedImageType` | `unsupported image type`                |
| 1103 | `NoAvatar`            | `no avatar`                             |
| 1104 | `InvalidData`          | `invalid avatar data`                   |
| 1200 | `InvalidID`            | `invalid id`                            |
| 1201 | `MissingFields`        | `required fields missing`               |
| 1202 | `InvalidURL`           | `invalid URL`                           |
| 1203 | `InvalidRole`          | `role must be 'admin' or 'user'`        |
| 1204 | `NotFound`             | `resource not found`                    |
| 1205 | `UnknownSetting`       | `unknown setting`                       |
| 1206 | `LastAdmin`            | `cannot remove the last admin`          |
| 1207 | `SelfDelete`           | `cannot delete your own account`        |
| 1209 | `EpochMismatch`        | `sync epoch mismatch`                   |
| 1210 | `SyncCursorAhead`      | `sync cursor ahead of server`           |
| 1300 | `ServerError`          | `internal server error`                 |
| 1301 | `MissingParam`         | `missing required parameter`            |
| 1302 | `Blocked`              | `request blocked`                       |
| 1303 | `GatewayError`         | `external service unavailable`          |

Handler 可以覆盖默认错误消息, 但错误码语义保持不变.

## Auth

### `POST /auth/login`

公开接口. 校验用户名和密码, 成功后返回 opaque bearer token.

请求:

```json
{
  "username": "admin",
  "password": "admin"
}
```

成功 `200`:

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

如果用户没有头像, `avatar` 字段会省略.

常见错误: `400 InvalidRequest`, `401 InvalidCredentials`, `500 ServerError`.

### `POST /auth/logout`

受保护接口. 请求包含 `Authorization` 时注销当前 bearer token.

成功 `200`:

```json
{"message": "logged out"}
```

### `GET /auth/me`

公开接口. 返回当前 bearer token 用户. 如果没有有效 bearer token 且 `anonymous_access == "true"`, 返回匿名用户.

成功 `200`:

```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "avatar": "/api/v1/avatar/admin"
}
```

匿名成功 `200`:

```json
{
  "id": 0,
  "username": "anonymous",
  "role": "user"
}
```

常见错误: `401 NotLoggedIn`.

### `PUT /auth/profile`

受保护接口. 更新当前用户的用户名.

请求:

```json
{"username": "new_name"}
```

成功 `200`:

```json
{
  "id": 1,
  "username": "new_name",
  "role": "admin",
  "avatar": "/api/v1/avatar/new_name"
}
```

常见错误: `400 InvalidRequest`, `401 NotLoggedIn`, `409 UsernameTaken`, `500 ServerError`.

### `PUT /auth/password`

受保护接口. 修改当前用户密码.

请求:

```json
{
  "old_password": "old-password",
  "new_password": "new-password"
}
```

成功 `200`:

```json
{"message": "password updated"}
```

常见错误: `400 InvalidRequest`, `401 NotLoggedIn`, `401 IncorrectPassword`, `500 ServerError`.

### `PUT /auth/avatar`

受保护接口. Multipart 上传, 字段名为 `avatar`.

服务端通过文件头嗅探支持以下类型: `image/jpeg`, `image/png`, `image/gif`, `image/webp`.

头像最大 256 KB.

成功 `200`:

```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "avatar": "/api/v1/avatar/admin"
}
```

常见错误: `400 MissingAvatar`, `400 FileTooLarge`, `400 UnsupportedImageType`, `500 ServerError`.

### `DELETE /auth/avatar`

受保护接口. 删除当前用户头像.

成功 `200`:

```json
{
  "id": 1,
  "username": "admin",
  "role": "admin"
}
```

常见错误: `401 NotLoggedIn`, `500 ServerError`.

### `GET /avatar/{username}`

受保护接口. 返回指定用户的头像图片字节.

成功 `200`: 图片 body, 使用存储的 content type, 并返回 `Cache-Control: public, max-age=3600`.

常见错误: `400 InvalidRequest`, `404 NoAvatar`, `500 ServerError`, `500 InvalidData`.

## Settings

### `GET /settings`

公开接口, 可选登录态. 匿名用户和普通用户只返回公开设置. Admin 用户返回所有允许暴露的设置.

成功 `200`:

```json
{
  "settings": {
    "version": "v0.0.0-dev"
  }
}
```

Admin 可见设置键:

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

`public_base_url` 用于配置重写 M3U8 代理链接时使用的外部访问根地址. `KMTV_PUBLIC_BASE_URL` 的优先级高于这个 DB 设置. 两者都没有配置时, KMTV 保持当前的 forwarded header 回退逻辑.

`media_token_ttl` 默认值为 21600 秒, 用于保证 URL 绑定的代理播放 token 能覆盖长剧集播放.

常见错误: `500 ServerError`.

### `PUT /admin/settings`

Admin 接口. 通过 key-value map 更新设置.

请求:

```json
{
  "site_name": "KMTV",
  "anonymous_access": "false"
}
```

成功 `200`:

```json
{"message": "settings updated"}
```

常见错误: `400 InvalidRequest`, `400 UnknownSetting`, `500 ServerError`.

## Search And Detail

### `GET /search`

受保护接口. 聚合所有已启用且健康的视频源搜索结果.

仅当 `title` 和 `year` 在去除首尾空白后完全相同时才合并结果. 中间空白, 标点, 符号和字母大小写都有意义, 文本不同的标题会保留为独立结果卡. 单个结果的 `sources` 中, 每个 `source_key` 最多保留一项.

查询参数:

| Name   | Required | Default | 说明        |
|--------|----------|---------|-------------|
| `q`    | Yes      | -       | 搜索关键词  |
| `page` | No       | `1`     | 正整数页码  |

成功 `200`:

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

常见错误: `400 MissingParam`, `401 NotLoggedIn`, `500 ServerError`.

### `GET /search/stream`

受保护接口. SSE 版本搜索接口.

查询参数同 `GET /search`.

事件:

```text
event: progress
data: {"phase":"searching","completed":1,"total":3}

event: progress
data: {"phase":"probing","completed":1,"total":3}

event: result
data: {"results":[...]}
```

搜索失败事件:

```text
event: error
data: {"message":"search failed"}
```

开始流式响应前的常见错误: `400 MissingParam`, `401 NotLoggedIn`, `500 ServerError`.

### `GET /search/suggestions`

受保护接口. 当前返回空建议列表.

查询参数:

| Name | Required | 说明       |
|------|----------|------------|
| `q`  | No       | 当前忽略   |

成功 `200`:

```json
{"suggestions": []}
```

### `GET /detail`

受保护接口. 从指定视频源获取详情, 并探测可播放 CDN 线路.

查询参数:

| Name     | Required | 说明                         |
|----------|----------|------------------------------|
| `source` | Yes      | 搜索结果中的 source key      |
| `id`     | Yes      | 搜索结果中的 video ID        |

成功 `200`:

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

常见错误: `400 MissingParam`, `404 NotFound`, `500 ServerError`.

## Sync

同步接口要求真实的登录用户. 当 `anonymous_access == "true"` 时, 匿名用户仍可浏览和播放,
但这些接口返回 `401 NotLoggedIn`; 客户端将匿名数据保存在本地, 不得把这个 401 视为会话过期.

每个同步条目都是一条由 `(kind, key)` 标识的记录:

| kind       | key                 | payload 字段 | 上限 |
|------------|---------------------|--------------|------|
| `watch`    | 归一化后的 `title`  | `title, cover, source_key, video_id, episode, group_index, episode_index, progress_sec, duration_sec, completed` | 保留最新 200 条 |
| `favorite` | 归一化后的 `title`  | `title, cover, type, year, rate, desc, source_key, video_id` | 1000 条; 超出后新 key 返回 `limit` |
| `search`   | 归一化后的 `query`  | `query` | 保留最新 50 条 |

key 归一化: 按空白字符 (`\t \n \v \f \r`, 空格, U+0085, U+00A0, U+1680, U+2000-U+200A,
U+2028, U+2029, U+202F, U+205F, U+3000) 切分, 用一个空格连接, 再转为小写. 以服务端计算的 key
为准. 参考用例见 `testdata/sync-key-vectors.json`.

payload 长度限制 (按 Unicode 码点计): `title`, `episode` 和 `query` 512; `source_key` 和 `video_id`
1024; `cover` 8192; `type`, `year` 和 `rate` 64; `desc` 2048. `group_index` 和 `episode_index`
是非负整数; `progress_sec` 和 `duration_sec` 是非负有限数. 未知的 payload 字段会被丢弃, 文本会去掉首尾空白.

事件时间为 `t` 的写入, 只有当 `t` 严格大于已存记录的事件时间, 并且大于该类数据的清空时间时才会生效.
比服务器时钟快超过 1 秒的事件时间会被压回服务器时间 (一批中出现这样的时间时, 该批中从 `now` 起的时间按原有先后依次重排为 `now, now+1, ...`). 删除会留下删除标记, 保留 90 天. `watch` 或
`search` 超出上限时, 最旧的行会变成删除标记并分配新的 `rev`.

### `POST /sync/push`

受保护. 在一个事务中应用最多 200 条变更. 请求体上限 256 KiB.

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

客户端首次同步时 `epoch` 为空. `cursor` 是客户端的拉取游标 (尚未拉取时为 `0`). 非空且与服务端不一致的
`epoch` 会让整个请求返回 `409`:

```json
{"code": 1209, "error": "sync epoch mismatch", "epoch": "<当前 epoch>"}
```

`epoch` 一致时, `cursor` 大于该用户当前版本说明服务端从旧副本恢复. 请求在应用任何变更前失败:

```json
{"code": 1210, "error": "sync cursor ahead of server", "epoch": "<当前 epoch>"}
```

客户端通过拉取处理这两种 `409`, 拉取会返回 `reset: true` (见 `GET /sync/pull`).

成功 `200`:

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

| status    | 含义 |
|-----------|------|
| `applied` | 已保存. `record` 是保存后的记录, 带规范 key 和实际保存的事件时间. |
| `stale`   | 服务端已有更新的状态. `record` 是当前记录 (可能是删除标记, 包括本次写入被上限淘汰后生成的删除标记), 不存在时为 `null`. 清空操作则在 `clear` 中返回当前清空时间点. |
| `invalid` | 未通过校验或无法解码, `reason` 说明原因. 同批其他变更照常应用. |
| `limit`   | 收藏已达上限且该 key 是新的. |

常见错误: `400 InvalidRequest`, `401 NotLoggedIn`, `409 EpochMismatch`, `409 SyncCursorAhead`, `500 ServerError`.

### `GET /sync/pull`

受保护. 返回某个版本游标之后的变更.

| 名称    | 必填 | 默认值 | 说明 |
|---------|------|--------|------|
| `since` | 否   | `0`    | 客户端已应用的最后一个 `rev` |
| `epoch` | 否   | 空     | 客户端上次看到的 epoch |
| `limit` | 否   | `500`  | 每页条数, 最大 `1000` |

成功 `200`:

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

记录和清空事件按 `rev` 排序. `rev` 是本页最大的 rev (空页时等于 `since`); 下次请求把它作为 `since`
传回, `has_more` 为 true 时继续翻页. 同一页内先应用清空事件, 再应用记录.

`reset: true` 时列表为空, `rev` 为该用户当前版本. 以下情况会返回它: `epoch` 与服务端不一致 (数据库被重置),
`since` 大于 `rev` (数据库从旧副本恢复), 或 `since` 低于仍保留的最旧删除标记版本. 前两种情况下服务端丢失了
客户端已有的数据, 客户端把所有本地记录标记为待上传, 再从 `since=0` 重新拉取. 最后一种情况下客户端全量重同步:
从 `since=0` 拉取, 并删除服务端已不存在的已同步本地记录.

常见错误: `400 InvalidRequest`, `401 NotLoggedIn`, `500 ServerError`.

## Douban

### `GET /douban/categories`

受保护接口. 返回用于浏览的分类组.

成功 `200`:

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

受保护接口. 返回分页豆瓣列表.

查询参数:

| Name       | Required | Default | 说明                         |
|------------|----------|---------|------------------------------|
| `category` | No       | -       | 豆瓣分类                     |
| `type`     | Yes      | -       | `movie` 或 `tv`              |
| `start`    | No       | `0`     | 从 0 开始的偏移量            |
| `count`    | No       | `20`    | 每页数量, 最大 `50`          |

成功 `200`:

```json
{
  "items": [
    {"id": "1", "title": "Movie", "cover": "https://...", "rate": "8.0", "year": "2026"}
  ]
}
```

常见错误: `400 InvalidRequest`, `502 GatewayError`.

### `GET /douban/recommend`

受保护接口. 返回豆瓣推荐内容.

成功 `200`:

```json
{
  "items": [
    {"id": "1", "title": "Movie", "cover": "https://...", "rate": "8.0", "year": "2026"}
  ]
}
```

常见错误: `502 GatewayError`.

### `GET /douban/recommend/filter`

受保护接口. 按 kind, tag, format, region 过滤豆瓣条目.

查询参数:

| Name     | Required | Default | 说明                            |
|----------|----------|---------|---------------------------------|
| `kind`   | Yes      | -       | 豆瓣 kind, 如 `movie` 或 `tv`   |
| `tag`    | No       | -       | 排名或分类 tag                  |
| `format` | No       | -       | 展示格式过滤条件                |
| `region` | No       | -       | 地区过滤条件                    |
| `start`  | No       | `0`     | 从 0 开始的偏移量               |
| `count`  | No       | `20`    | 每页数量, 最大 `50`             |

成功 `200`:

```json
{
  "items": [
    {"id": "1", "title": "Movie", "cover": "https://...", "rate": "8.0", "year": "2026"}
  ]
}
```

常见错误: `400 MissingParam`, `502 GatewayError`.

### `GET /douban/home`

受保护接口. 返回预取的首页 sections.

成功 `200`:

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

受保护接口. 按当前播放模式返回可播放 URL.

请求:

```json
{
  "url": "https://media.example/index.m3u8",
  "source": "source-key"
}
```

代理模式成功 `200`:

```json
{
  "mode": "proxy",
  "url": "https://kmtv.example/api/v1/proxy/m3u8?url=...&source=source-key&mt=..."
}
```

直连模式成功 `200`:

```json
{
  "mode": "direct",
  "url": "https://media.example/index.m3u8"
}
```

常见错误: `400 InvalidRequest`, `401 NotLoggedIn`, `403 Blocked`, `500 ServerError`.

### `GET /proxy/image`

公开接口. 代理豆瓣图片, 并使用域名白名单.

查询参数:

| Name  | Required | 说明                           |
|-------|----------|--------------------------------|
| `url` | Yes      | `http` 或 `https` 豆瓣图片 URL |

允许的图片 host: `doubanio.com` 和 `*.doubanio.com`.

成功 `200`: 图片 body, 如上游返回 content type 则透传, 并返回 `Cache-Control: public, max-age=15720000`.

常见错误: `400 MissingParam`, `400 InvalidURL`, `403 Blocked`, `404 NotFound`, `502 ServerError`.

### `GET /proxy/m3u8`

公开媒体接口. 获取上游 M3U8, 并把 segment/key URL 改写回 KMTV 代理接口. 需要携带为精确 M3U8 URL 签发的 media token.

查询参数:

| Name     | Required | 说明                           |
|----------|----------|--------------------------------|
| `url`    | Yes      | 上游 `http` 或 `https` M3U8 URL |
| `source` | No       | 添加到改写后 URL 的 source key |
| `mt`     | Yes      | URL 绑定的 media token          |

成功 `200`: `application/vnd.apple.mpegurl` body.

常见错误: `400 MissingParam`, `401 NotLoggedIn`, `403 Blocked`, `404 NotFound`.

### `GET /proxy/segment`

公开媒体接口. 流式代理上游媒体 segment. 需要携带为精确 segment URL 签发的 media token.

查询参数:

| Name  | Required | 说明                              |
|-------|----------|-----------------------------------|
| `url` | Yes      | 上游 `http` 或 `https` segment URL |
| `mt`  | Yes      | URL 绑定的 media token             |

成功: 流式透传上游状态码, 部分 header 和 body.

常见错误: `400 MissingParam`, `401 NotLoggedIn`, `403 Blocked`, `502 GatewayError`.

### `GET /proxy/key`

公开媒体接口. 流式代理上游加密 key. 查询参数和行为与 `/proxy/segment` 相同, 但 token 需要按 media kind `key` 签发.

## Admin Sources

### `GET /admin/sources`

Admin 接口. 返回全部视频源.

成功 `200`:

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

Admin 接口. 创建视频源.

请求:

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

成功 `201`: 创建后的视频源对象.

常见错误: `400 InvalidRequest`, `400 MissingFields`, `400 InvalidURL`, `500 ServerError`.

### `PUT /admin/sources/{id}`

Admin 接口. 更新视频源.

请求体使用 source 字段. `api` 非空时会校验 URL.

成功 `200`:

```json
{"message": "source updated"}
```

常见错误: `400 InvalidID`, `400 InvalidRequest`, `400 InvalidURL`, `404 NotFound`, `500 ServerError`.

### `DELETE /admin/sources/{id}`

Admin 接口. 删除视频源.

成功 `200`:

```json
{"message": "source deleted"}
```

常见错误: `400 InvalidID`, `404 NotFound`, `500 ServerError`.

### `POST /admin/sources/{id}/check`

Admin 接口. 检查单个视频源健康状态.

成功 `200`:

```json
{"health": "healthy"}
```

常见错误: `400 InvalidID`, `500 ServerError`.

### `POST /admin/sources/check-all`

Admin 接口. 异步启动全部已启用视频源的健康检查.

成功 `200`:

```json
{"message": "health check started"}
```

### `POST /admin/sources/bulk-enabled`

Admin 接口. 在单次请求中原子地批量启用或禁用多个视频源. 设计目的是替代管理端的散列 PUT 请求 (例如 "启用全部 NSFW 源"), 这些散列请求过去会撞到 SQLite 写锁并返回 `SQLITE_BUSY`.

请求:

```json
{
  "ids": [1, 2, 3],
  "enabled": true
}
```

成功 `200`:

```json
{"message": "sources updated", "count": 3}
```

常见错误: `400 InvalidRequest`, `400 MissingFields` (`ids` 为空时), `404 NotFound` (任一 id 不存在时), `500 ServerError`.

### `POST /admin/sources/import`

Admin 接口. 从兼容的视频源配置 JSON 请求体导入视频源.

成功 `200`:

```json
{"imported": 3}
```

常见错误: `400 InvalidRequest`, `500 ServerError`.

## Admin Subscriptions

### `GET /admin/subscriptions`

Admin 接口. 返回全部视频源订阅.

成功 `200`:

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

Admin 接口. 创建订阅.

请求:

```json
{
  "url": "https://example.com/config.json",
  "auto_update": true,
  "interval": 3600
}
```

成功 `201`: 创建后的订阅对象.

常见错误: `400 InvalidRequest`, `400 MissingFields`, `400 InvalidURL`, `500 ServerError`.

### `PUT /admin/subscriptions/{id}`

Admin 接口. 更新订阅.

成功 `200`:

```json
{"message": "subscription updated"}
```

常见错误: `400 InvalidID`, `400 InvalidRequest`, `400 InvalidURL`, `404 NotFound`, `500 ServerError`.

### `DELETE /admin/subscriptions/{id}`

Admin 接口. 删除订阅.

成功 `200`:

```json
{"message": "subscription deleted"}
```

常见错误: `400 InvalidID`, `404 NotFound`, `500 ServerError`.

### `POST /admin/subscriptions/{id}/sync`

Admin 接口. 立即同步一个订阅.

成功 `200`:

```json
{"message": "subscription synced"}
```

常见错误: `400 InvalidID`, `500 ServerError`.

## Admin Users

### `GET /admin/users`

Admin 接口. 返回全部用户, 不包含密码和头像数据.

成功 `200`:

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

Admin 接口. 创建用户.

请求:

```json
{
  "username": "user",
  "password": "password",
  "role": "user"
}
```

成功 `201`:

```json
{
  "id": 2,
  "username": "user",
  "role": "user"
}
```

常见错误: `400 InvalidRequest`, `400 InvalidRole`, `400 MissingFields`, `500 ServerError`.

### `PUT /admin/users/{id}`

Admin 接口. 更新用户名, 角色, 可选更新密码.

请求:

```json
{
  "username": "user",
  "password": "new-password",
  "role": "user"
}
```

`password` 可以为空, 表示保留已有密码.

成功 `200`:

```json
{"message": "user updated"}
```

常见错误: `400 InvalidID`, `400 InvalidRequest`, `400 InvalidRole`, `403 LastAdmin`, `404 NotFound`, `500 ServerError`.

### `DELETE /admin/users/{id}`

Admin 接口. 删除用户.

当前用户不能删除自己的账号. 最后一个 admin 不能被删除.

成功 `200`:

```json
{"message": "user deleted"}
```

常见错误: `400 InvalidID`, `403 SelfDelete`, `403 LastAdmin`, `404 NotFound`, `500 ServerError`.

## 兼容性说明

- `/api/v1/proxy/m3u8`, `/api/v1/proxy/segment`, `/api/v1/proxy/key` 是公开媒体接口, 但必须携带 URL 绑定的 `mt` media token.
- KMTV API 边界上的搜索和详情 ID 是字符串, 即使上游视频源 ID 是数字.
- 上游视频源响应必须按不可信且不稳定处理.
- `GET /settings` 始终包含 `version`.
- 当前路由注册没有记录 `/api/v1` 之外的 route alias.
