# M4 MoviePilot 完成回调验收

> 完成日期：2026-07-30
> 实施范围：`TransferComplete` 安全回调、事件幂等、订阅完成与申请人通知

## 1. 数据与安全边界

- 家庭级 MoviePilot 连接保存独立回调密钥的 SHA-256 哈希、允许来源 IP 和轮换时间；明文只在生成响应中出现一次。
- `integration_events` 按连接与载荷哈希唯一，记录已处理、忽略或失败状态及关联的本地订阅请求。
- 审计载荷只保留片名、年份、类型、TMDB ID 和季数，不保存整理路径、下载信息或连接凭据。
- 回调限制为 64 KiB，只接受配置来源 IP；反向代理部署必须通过 `TRUST_PROXY_HOPS` 明确可信代理层数。
- 未识别事件直接成功忽略且不落库，避免通用 Webhook 插件把所有 MoviePilot 事件灌入审计表。

## 2. API 与匹配

```text
POST /media/connector-settings/moviepilot/webhook
POST /media/webhooks/moviepilot/:integrationId/:secret
```

- 生成与轮换仅允许家庭 `owner/admin`，且要求已经保存家庭级 MoviePilot 连接设置。
- `TransferComplete` 只按同一家庭、`moviepilot` 连接、进行中状态、TMDB ID 和季数匹配。
- 电影匹配季数 `0`；剧集必须与 `meta.begin_season` 完全一致，不使用片名推测。
- 匹配后订阅转为 `completed`，只向原申请人创建一条 `media_ready` 通知。
- 未匹配事件保持可审计，但不会修改片单、订阅或其他家庭的数据。

## 3. 客户端

- 观影设置的 MoviePilot 卡片支持填写允许来源 IP、生成或轮换回调、一键复制地址。
- 已生成地址离开页面后不再显示；需要重新配置插件时必须轮换，旧地址立即失效。
- 通知中心新增“观影”类型；影片就绪通知点击后标记已读并打开对应片单详情。
- 所有操作可通过鼠标或触控完成，不依赖键盘快捷键。

## 4. MoviePilot 配置

- 在 MoviePilot 通用 Webhook 插件中添加生成的完整回调地址。
- 事件来源使用运行 MoviePilot 的主机 IP；Docker Desktop 或反向代理改变来源地址时，应填写 API 实际看到的可信来源，并正确配置代理层数。
- 小管家不自动安装插件、不写入 NAS 配置，也不与 MoviePilot 管理 API Key 共用回调密钥。

## 5. 自动验收

- API 回归覆盖管理员权限、哈希落库、错误密钥、错误来源、请求体上限、未知事件、幂等、严格匹配、申请人通知、载荷脱敏和跨家庭隔离。
- Playwright 覆盖生成、复制、移动/桌面无横向溢出，以及通知直达片单详情。
- API 构建与完整 API 回归、移动端 TypeScript、Expo Lint 和 `git diff --check` 必须通过。
