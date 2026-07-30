# M4-I 播放回调与观看记录验收

## 已交付

- Plex 原生 multipart Webhook，读取其中的 `payload` JSON，不保存附带缩略图。
- Emby 原生 JSON Webhook，兼容播放开始、进度、暂停和停止事件。
- 每个 Plex/Emby 家庭连接独立生成 32 字节随机回调密钥，数据库只保存 SHA-256 摘要。
- 精确来源 IP、64 KiB JSON 上限、事件白名单和规范化载荷幂等。
- `viewing_sessions`、`viewing_participants`、`viewing_progress` 三层数据。
- 观看记录 API、成员进度 API以及移动/桌面观看记录页面。

## 数据归属

事件只有同时满足以下条件才进入观看记录：

1. 回调密钥和来源 IP 有效。
2. 事件中的服务器 ID 等于生成回调时确认的当前服务器 ID。
3. 外部用户已在“观影设置 > 用户映射”显式关联到未停用家庭成员。
4. 电影或剧集已同步到家庭媒体库。

系统不根据用户名猜测家庭成员。未映射用户、旧服务器和未同步媒体只写入 `integration_events` 脱敏审计，审计中的账号引用为不可逆摘要，不保存外部用户名或外部用户 ID。

电影使用媒体项 ID 关联。Plex 剧集事件优先使用 `grandparentRatingKey`，Emby 剧集事件优先使用 `SeriesId` 关联已同步剧集，同时以具体分集 ID 保存观看进度。

## API

- `POST /media/connector-settings/:provider/playback-webhook`
- `POST /media/webhooks/playback/:provider/:integrationId/:secret`
- `GET /media/viewing-sessions`
- `GET /media/viewing-progress`

其中 `provider` 只接受 `plex` 或 `emby`。生成回调地址要求 `manage_integrations` 权限；接收地址公开但必须通过路径密钥和来源 IP；观看记录对当前家庭成员可读并强制家庭范围。

## NAS 实机配置

### 准备

1. 在家庭应用中先保存并测试 Plex 或 Emby 连接。
2. 在“用户映射”读取目录，把测试媒体账号显式关联到家庭成员。
3. 同步一次媒体库，确认测试电影或剧集已出现。
4. 在对应媒体服务卡填写 NAS 的来源 IP，点击“生成回调地址”，再点击“复制地址”。

回调地址只显示一次。NAS 必须能访问该地址中的 API 主机和 `3100` 端口。如果地址是 `localhost`，应通过 Mac 的局域网地址访问 Web 演示后重新生成，或只把回调 URL 的 origin 改为 NAS 可访问的 API 地址，不能修改后面的路径和密钥。

### Plex

在 Plex Web 的 Webhooks 设置中新增回调并粘贴地址，然后用已映射账号播放、暂停和停止一部已同步影视。若 Plex 管理界面没有 Webhooks 入口，需要先核对当前 Plex 版本、账号权限及 Webhook 功能可用条件。

### Emby

在 Emby 管理后台的 Webhook/通知插件中新增 JSON 回调，选择播放开始、进度和停止事件并粘贴地址。实际请求应包含 `Event`、`Server`、`User`、`Session` 和 `Item`；模板化成纯文本的通知不能生成观看会话。

### 预期结果

- “家庭观影 > 观看记录”出现成员、媒体服务、设备、时间和进度。
- 重复发送同一载荷不会增加记录。
- 未映射账号播放时页面不出现成员记录。
- 重新安装或切换媒体服务器后，旧服务器事件被忽略；管理员刷新用户目录、重新映射并重新生成回调后，新服务器开始记录。
- Plex/Emby 临时离线不会删除已有观看记录或成员映射。

## 自动验收

`corepack pnpm --filter api test:api` 覆盖：

- Plex multipart 与 Emby JSON 正常处理。
- 错误密钥、错误来源 IP 和超过 64 KiB 的 JSON。
- 重复、乱序开始/进度/停止与完成事件。
- 未映射用户、旧服务器和脱敏审计。
- 观看会话、参与成员和成员最新进度。

`corepack pnpm --filter mobile exec playwright test e2e/viewing-history.spec.ts e2e/moviepilot-webhook.spec.ts` 覆盖 390 x 844 移动视口及 1440 x 900 桌面视口的设置、生成、复制、观看记录、状态筛选和横向溢出。

## 边界

- 家庭应用不自动修改 Plex、Emby、MoviePilot 或 NAS 配置。
- 没有原生会话 ID 时，系统以账号、设备和媒体项构造播放键；带有效事件时间的离线乱序补报可合并。完全不带时间且跨多次重播的离线事件无法可靠还原顺序。
- 本批不自动改变家庭片单的“观看中/已看完”状态，避免个人播放行为覆盖家庭共同状态。
- 本批不安装媒体服务器插件，也不把回调密钥或媒体服务凭据写入日志、活动或仓库。
