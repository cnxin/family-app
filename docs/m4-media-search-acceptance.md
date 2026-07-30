# M4-E 三源影视搜索验收

> 实施范围：TMDB、豆瓣兼容桥接与 Bangumi 并行搜索，来源状态、谨慎去重、本地快照和双视口 Web 流程

## 1. 来源边界

- TMDB 使用官方 API，默认请求 `zh-CN`，过滤成人内容；支持 v4 Read Access Token，兼容 v3 API Key。
- Bangumi 使用官方 v0 `POST /v0/search/subjects`，只查询条目类型 `2`（动画），根据平台区分剧场版和剧集；匿名查询可用，也可配置个人 Access Token。
- 豆瓣目前没有稳定的官方公共影视搜索 API。本项目不复制 MoviePilot 的 GPL 实现、不内置非官方 Frodo 参数，也不抓取网页；通过私有、限权的兼容桥接服务接入。
- 三个来源并行请求并独立降级。某一来源未配置、超时、限流或返回错误时，另外两源和手动录入仍可使用。
- TMDB、豆瓣和 Bangumi 只提供外部元数据。本系统的 `media_titles`、`media_external_refs` 与 `household_media` 仍是家庭片单事实来源。

## 2. 统一搜索

- 已登录成员使用 `GET /media/search?query=名称&type=movie|series` 搜索；关键词最长 120 个字符，可选 `year=YYYY`。
- 每次响应固定返回 `douban`、`tmdb`、`bangumi` 三个来源状态；只包含来源名、状态、结果数和脱敏错误，不返回服务地址或凭据。
- 服务端缓存相同关键词、类型和年份 5 分钟，最多保留 100 组查询，降低外部 API 压力。
- 只在外部编号相同，或“类型、标准化名称、明确年份”完全一致时跨源合并。缺年份、同名不同年份或存在冲突匹配时保留为独立候选。
- 合并结果保留所有来源标识与外部编号，简介选择信息更完整的快照，海报和其他基础字段按来源优先级补齐。

## 3. 豆瓣桥接契约

配置 `DOUBAN_API_BASE_URL` 后，API 请求：

```http
GET {baseUrl}/search?query=流浪地球&type=movie&year=2019&limit=12
Accept: application/json
Authorization: Bearer {DOUBAN_API_TOKEN}  # 配置时才发送
```

推荐响应：

```json
{
  "results": [
    {
      "id": "26266893",
      "type": "movie",
      "title": "流浪地球",
      "originalTitle": "The Wandering Earth",
      "year": 2019,
      "overview": "剧情简介",
      "posterUrl": "https://example.test/poster.jpg",
      "rating": { "average": 7.9 },
      "externalRefs": [
        { "provider": "tmdb", "externalId": "535167" }
      ]
    }
  ]
}
```

兼容层也接受顶层数组、`subjects`、`original_title`、`summary`、`images.large` 等常见字段。`GET {baseUrl}/subjects/{id}` 和 `GET {baseUrl}/health` 预留给详情与健康检查；当前片单添加流程只依赖搜索端点。桥接 Token 应只授予搜索权限，不应复用 MoviePilot 管理 API Key。

## 4. 本地快照与唯一性

- 选择候选后，名称、原名、年份、简介和海报 URL 进入现有确认表单，成员仍可在加入片单前修正。
- `media_external_refs` 新增 `douban` 与 `bangumi`；二者按来源与 ID 全局唯一，TMDB 继续按媒体类型与 ID 唯一。
- 同一候选合并得到的 TMDB、IMDb、豆瓣和 Bangumi 编号会一并持久化，后续外部来源下线不影响家庭片单读取。
- 手动录入保留，并可填写四类外部编号；所有创建、家庭隔离、投票、排期和 MoviePilot 订阅规则继续复用现有服务端约束。

## 5. 配置

| 环境变量 | 必需 | 说明 |
| --- | --- | --- |
| `TMDB_API_TOKEN` / `_FILE` | 二选一 | 推荐的 TMDB v4 Read Access Token |
| `TMDB_API_KEY` / `_FILE` | 二选一 | 兼容 TMDB v3 API Key |
| `DOUBAN_API_BASE_URL` | 否 | 私有豆瓣兼容桥接根地址 |
| `DOUBAN_API_TOKEN` / `_FILE` | 否 | 桥接服务限权 Bearer Token |
| `BANGUMI_API_BASE_URL` | 否 | 默认 `https://api.bgm.tv` |
| `BANGUMI_ACCESS_TOKEN` / `_FILE` | 否 | Bangumi 个人 Token；匿名搜索不要求 |
| `BANGUMI_USER_AGENT` | 否 | 标识自托管客户端，默认使用项目名与版本 |

凭据只从环境变量或只读密钥文件注入，不保存到数据库、活动日志或前端。国内部署可将三个 `*_BASE_URL` 指向自有合规出口或缓存代理。

## 6. 自动验收

- 提供方契约使用固定模拟响应覆盖 TMDB Bearer 认证、豆瓣桥接 Token、Bangumi `User-Agent` 与动画类型过滤。
- 契约测试覆盖三源合并、5 分钟缓存、单源失败和未配置状态，并断言响应不包含 Token 或服务地址。
- API 回归覆盖登录要求、空关键词、无配置/离线降级和来源配置脱敏。
- Playwright 在 390 x 844 与 1440 x 900 视口覆盖鼠标打开搜索、三源状态、选择候选、返回搜索和手动录入。
