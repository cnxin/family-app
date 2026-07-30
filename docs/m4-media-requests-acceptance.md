# M4-D MoviePilot 订阅请求验收

> 完成日期：2026-07-30
> 实施范围：订阅请求持久化、家庭权限、状态同步、取消与 Web 操作界面

## 1. 数据模型

- 新增 `media_requests`，家庭片单与 MoviePilot 外部状态分开保存。
- 状态为 `pending`、`processing`、`completed`、`failed`、`cancelled`。
- 电影使用季号 `0`；剧集必须提交 `1` 到 `999` 的明确季号。
- 同一家庭片单、连接器和季号只能存在一个进行中的请求。
- MoviePilot 外部请求编号按连接器唯一，不作为家庭片单主键。
- 请求人、取消人、最近同步时间和失败原因均保留在本地。

## 2. API

```text
GET    /media/requests
POST   /media/:mediaId/requests
POST   /media/requests/:requestId/refresh
DELETE /media/requests/:requestId
```

- 所有查询和修改同时校验 `householdId`。
- 正式家庭成员可以提交和刷新订阅。
- 只有请求人或 `owner/admin` 可以取消进行中的订阅。
- 缺少有效数字 TMDB ID 时不能提交；剧集缺少季号时不能提交。
- 存在进行中订阅时，影片不能直接移出家庭片单。

## 3. 外部调用边界

- 先在短事务中保存家庭请求，再在事务外调用 MoviePilot，避免 NAS 响应时间占用数据库锁。
- MoviePilot 离线、未配置或返回错误时，请求转为 `failed` 并保留原因，家庭片单不变。
- 状态刷新失败只记录同步错误，不会把未知的外部状态误判为完成或取消。
- 取消以 MoviePilot 成功响应为前提；外部取消失败时本地请求仍保持进行中。
- 提交、MoviePilot 接收、失败、完成和取消均写入不可变家庭活动。

## 4. 客户端

- 家庭片单卡片显示最新订阅、请求人、剧集季号、状态和失败原因。
- 电影可以直接确认订阅；剧集通过弹窗输入季号。
- 刷新、取消和重新订阅均可通过鼠标或触控完成，不依赖快捷键。
- 取消前显示确认弹窗；普通成员看不到取消他人请求的可用操作。
- MoviePilot 不可用或影片缺少 TMDB ID 时，订阅按钮明确禁用，播放、投票、排期和片单编辑继续可用。

## 5. 自动验收

- API 回归覆盖未配置失败持久化、家庭活动、取消权限和移出片单保护。
- 家庭隔离覆盖订阅列表、刷新和取消不能跨家庭访问。
- 连接器契约覆盖 MoviePilot API Key 认证、创建、查询和取消。
- Playwright 覆盖提交、取消、重新订阅和刷新完成，移动与桌面视口均无横向溢出。
- `corepack pnpm --filter api test:api`、`corepack pnpm typecheck`、`corepack pnpm lint` 和 `corepack pnpm test:web` 全部通过。

## 6. 后续边界

- 当前状态刷新由家庭成员手动触发；后台轮询和 Webhook 尚未启用。
- `TransferComplete` 媒体就绪通知、Plex/Emby 入库同步和观看记录属于 M4 后续批次。
- 真实 NAS 验收仍需要轮换后的限权 Plex Token 与 MoviePilot API Key；凭据不得提交到仓库。
