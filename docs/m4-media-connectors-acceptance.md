# M4-C 媒体连接器验收

> 完成日期：2026-07-30
> 实施范围：Plex、Emby、MoviePilot 提供方适配器、家庭级连接设置、连接状态、媒体匹配和播放入口

## 1. 连接器模型

- Plex 与 Emby 都实现 `MediaLibraryProvider`，可以独立启用或同时启用。
- MoviePilot v2 实现 `MediaAutomationProvider`，认证使用官方支持的 `X-API-KEY`。
- `MEDIA_PRIMARY_LIBRARY` 只影响多个媒体库匹配结果的排序，不会隐藏或禁用另一媒体库。
- 家庭片单继续以 `media_titles` 和 TMDB/IMDb 外部 ID 为主，不使用 Plex、Emby 或 MoviePilot 内部编号作为主键。

## 2. API

```text
GET  /media/connectors
POST /media/library-availability
GET  /media/connector-settings
PUT  /media/connector-settings/:kind
POST /media/connector-settings/:kind/test
DELETE /media/connector-settings/:kind
```

- 连接器状态区分未配置、缺少凭据、在线和离线。
- 媒体库匹配批量接收当前家庭片单 ID；服务端重新校验 `householdId`，不会读取其他家庭条目。
- Plex 使用 `tmdb://` / `imdb://` GUID 查询；Emby 使用 `ProviderIds` 查询。
- 匹配结果可以同时返回 Plex 和 Emby。播放 URL 不包含 Token 或 API Key。
- 健康结果缓存 30 秒、匹配结果缓存 60 秒；缓存键包含家庭与配置版本，单个连接器失败返回空匹配，不阻断家庭片单。
- 设置读取、修改、连接测试和恢复默认仅允许 `owner/admin`，连接状态和媒体播放入口对家庭成员开放。

## 3. MoviePilot 边界

- 按 MoviePilot v2 官方源码实现 `/api/v1/system/env`、`/api/v1/subscribe/`、订阅查询和取消契约。
- 电影订阅要求 TMDB ID；剧集还要求明确季号。
- 本批只在服务端启用健康检测并完成订阅适配器契约。请求状态表、家庭权限、界面订阅按钮和媒体就绪通知不在本批开放，避免把管理员级 API Key 直接等同于普通家庭成员权限。

## 4. 凭据与网络

- 开发环境使用被 Git 忽略的 `.env`；生产环境优先使用 `*_FILE` 和只读密钥目录。这些值作为所有家庭的服务器默认配置。
- 家庭管理员可建立家庭覆盖。连接记录保存在 `integrations`，凭据单独使用 `integration_secrets` 和 AES-256-GCM 密文保存；认证上下文绑定家庭与连接器类型。
- API 日志、公共响应、播放链接和测试输出均不包含连接器凭据。
- 生产 API 增加仅用于主动访问 NAS 的 `integrations` 网络；数据库仍只在 `internal` 后端网络中。
- 外部服务超时为 5 秒，认证失败只返回经过归一化的错误信息。

## 5. 客户端

- 家庭观影页显示三套连接器状态；管理员可从“观影设置 -> 媒体服务”分别启停、填写地址和凭据、选择 Plex/Emby 主媒体库并保存后测试。
- 匹配到媒体库后，影片卡显示带来源名称的播放按钮。
- 同一影片同时存在于 Plex 和 Emby 时保留两个入口，默认来源排在前面。
- 连接器未配置或离线时，片单搜索、编辑、投票和排期保持可用。

## 6. 自动验证

- Plex 契约测试覆盖版本、GUID 匹配、服务器深链和 Token 不进入 URL。
- Emby 契约测试覆盖版本、ProviderIds 匹配和无密钥深链。
- MoviePilot 契约测试覆盖 `X-API-KEY`、幂等检查、官方媒体类型、创建、查询和取消。
- API 集成测试覆盖未配置状态、响应脱敏和离线空匹配。
- 家庭设置回归覆盖管理员权限、家庭隔离、独立密钥表、主媒体库唯一、运行时解密、活动日志脱敏和级联恢复默认。
- API 构建、前后端 TypeScript、Expo Lint 和 `git diff --check` 通过。

## 7. 真实 NAS 验收条件

- 当前已确认 Plex `1.43.0.10467` 与 MoviePilot v2 API 从开发主机可达。
- Plex 媒体库读取需要轮换后的 Token；MoviePilot 健康与订阅需要 API Key。
- Emby 尚未提供实际部署地址，适配器先通过固定响应契约测试。

## 8. MoviePilot 插件市场调研

- 官方插件市场中的 Webhook 插件可把 MoviePilot 内部事件转发到第三方；`NotionMediaSync` 也验证了媒体整理完成事件为 `TransferComplete`，事件中包含媒体、整理和文件元数据。
- `MediaServerMsg` 验证了 Plex/Emby/Jellyfin Webhook 会统一形成 `WebhookMessage`，可覆盖入库、播放开始、播放停止和进度信息。
- 通用 Webhook 插件监听全部事件，且请求不带签名或自定义认证头。当前批次不安装、不自动配置该插件，也不开放无认证回调地址。
- 下一批若接入回调，只允许白名单事件；使用独立随机回调密钥、来源网段限制、事件哈希幂等、请求体上限和脱敏日志。MoviePilot 管理 API Key 与回调密钥必须分离。
- 订阅审批、家庭角色权限、请求状态和审计记录继续由小管家持有；插件只作为事件来源，不能绕过家庭权限直接代表成员订阅。
