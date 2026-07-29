# M4-A 家庭观影片单验收

> 完成日期：2026-07-30  
> 实施范围：连接器无关的影视元数据、家庭片单、状态、排期、日历、活动与 Web 双视口界面

## 1. 数据边界

- `media_titles` 保存与 Plex、Emby、MoviePilot 无关的影视元数据快照。
- `media_external_refs` 保存外部编号；TMDB 按影视类型和 ID 去重，IMDb 按全局 ID 去重；Plex、Emby 和 MoviePilot 必须带连接器命名空间，只在对应实例内唯一。
- `household_media` 保存家庭片单状态、观影日期、家庭备注和创建成员。
- 家庭片单唯一约束包含 `householdId`；所有查询、更新和删除均同时校验资源 ID 与 `householdId`，跨家庭访问返回 `404`。
- 同一外部编号的并发创建使用事务级 advisory lock 串行去重，不使用 Plex 或 Emby 内部 ID 作为本系统主键。

## 2. 状态与排期

状态为：

```text
watchlist -> voting / scheduled / watching / completed / dropped
voting    -> watchlist / scheduled / dropped
scheduled -> watchlist / watching / completed / dropped
watching  -> completed / dropped / watchlist
completed -> watchlist / watching
dropped   -> watchlist
```

`scheduled` 必须有 `scheduledFor`。进入观看中或已完成后保留原排期，便于日历保留家庭历史；退回想看、投票中或不再观看时默认清除排期。

## 3. API 与公共能力

```text
GET    /media
POST   /media
PATCH  /media/:id
DELETE /media/:id
```

- 列表支持状态筛选和名称搜索。
- 手动添加支持电影/剧集、名称、原名、年份、简介、海报 URL、TMDB/IMDb ID、状态、排期和家庭备注。
- 有观影日期的条目由 `GET /calendar` 聚合为 `module=media`，目标页面为 `/media?mediaId=...`。
- 加入、状态变化、排期变化和移除写入不可变家庭活动记录。
- 观影尚未加入通用提醒来源；进入连接器与通知批次后再根据实际媒体就绪事件设计提醒，避免提前绑定错误语义。

## 4. 连接器边界

`apps/api/src/media/providers.ts` 已定义：

- `MediaMetadataProvider`
- `MediaAutomationProvider`
- `MediaLibraryProvider`

本批没有保存外部系统凭据，也没有实现在线提供方。家庭片单在所有连接器离线时仍完整可读写。Plex/Emby 主播放来源、MoviePilot API 和元数据凭据确认后，再实现提供方适配器。

## 5. 客户端验收

- 移动端从首页进入，提供鼠标可点击的返回按钮，不增加第 7 个底部标签。
- 桌面端侧栏提供“家庭观影”入口。
- 页面支持搜索、状态筛选、手动添加、状态与排期编辑和移除确认。
- 排期使用完整月份日历；海报使用 `expo-image`，缺失或加载失败时保持固定尺寸回退。
- 390 x 844 与 1440 x 900 两个 Chrome 视口均无横向溢出，按钮、表单和状态文字无重叠。

## 6. 自动验证

- 全新临时数据库运行 13 次迁移并完成结构漂移检查。
- API 集成测试覆盖连接器离线、外部 ID 去重、冲突编号、状态机、排期、日历、活动与移除后复用元数据。
- 家庭隔离测试覆盖片单列表、修改、删除和日历聚合。
- `corepack pnpm lint` 通过。
- `corepack pnpm typecheck` 通过。
- API 构建与完整 API 集成套件通过。
- Playwright 双视口套件通过 `4/4`，观影页面使用只读拦截样例验证卡片布局，不向开发数据库写入影视记录。

## 7. 后续批次

1. 确认 Plex 或 Emby 的主播放来源，实现第一个 `MediaLibraryProvider`。
2. 接入元数据搜索，保留手动录入作为离线回退。
3. 复用通用投票的来源关联，加入从片单发起投票的快捷流程。
4. 确认 MoviePilot API 后实现请求、订阅状态、失败重试与媒体就绪通知。
