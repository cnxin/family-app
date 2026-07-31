# 小管家 · family-app

面向家庭成员的生活协作平台。当前已完成点菜、菜单、菜谱、购物库存、统一日历、家庭任务、家庭投票、可配置提醒、家庭观影片单、三源在线搜索、排期、媒体连接器及独立访客来访流程，后续将扩展访客网络与家庭资产等模块。

> 当前可用流程：家人提前安排菜单、家庭事件和周期任务 -> 发起家庭决策并投票 -> 为事项设置多人提醒 -> 指定本餐主厨或分别认领菜品 -> 生成购物清单 -> 在统一日历、提醒中心和通知中心跟进家庭安排

完整的产品边界、数据模型、MoviePilot/Plex/Emby 连接方式、访客系统、网络设备接入和实施路线见 [家庭管理平台总体方案](docs/family-platform-plan.md)。

## 当前功能

- **点菜**：按日期选择早餐、午餐或晚餐，分类与搜索菜品，填写口味备注并提交菜单。
- **统一日历**：按月查看菜单与家庭事件；支持事件新建、编辑、删除，点菜日期显示有效菜品数量。
- **家庭任务**：安排一次性、每日、每周或每月任务，支持负责人、认领、改派、完成、跳过、恢复和停用；任务会进入首页与统一日历。
- **家庭投票**：为家庭决定、点菜、活动、观影或采购发起单选/多选投票；支持截止时间、改票、撤票、结束、重开和透明成员结果。
- **家庭观影**：维护连接器无关的电影/剧集片单、状态和月份排期；可从片单发起关联投票，并在片单与投票之间直接跳转。
- **在线影视搜索**：并行查询豆瓣兼容桥接、TMDB 和 Bangumi，显示逐源状态并谨慎合并候选；任一来源离线时仍可搜索其他来源或手动录入。
- **媒体连接器**：Plex 与 Emby 可独立或同时启用，按 TMDB/IMDb ID 检查入库并提供无凭据播放入口；MoviePilot 使用官方 `X-API-KEY` 契约检测健康状态并支持后续订阅流程。
- **可配置提醒**：为菜单、任务发生日、家庭事件和投票设置精确时间及多个接收人；支持编辑、取消、来源跳转和失效自动取消，到点后写入各成员通知中心。
- **通知中心**：汇总任务指派、任务完成和菜单变化，支持逐条或全部标记已读，并在桌面与移动端显示未读入口。
- **厨房协作**：每餐可指定主厨，每道菜可由不同成员认领；支持制作进度、划掉原因、点菜人提醒、操作历史、恢复和完成锁定。
- **成员边界**：家庭权限使用 `owner/admin/member`，经常掌勺是可独立修改的成员偏好，不再决定厨房权限。
- **家庭账号**：登录账号与家庭成员档案独立保存；支持首户安全初始化、密码更新和限时成员邀请。
- **独立菜谱**：统一管理家庭菜品，并按菜品或成员浏览；每道菜可同时查看家庭默认做法和各成员的图文做法、食材及参考链接。
- **成员厨艺**：成员从菜谱标记“我会做”、熟练度和自己的常用做法；全家可互相参考，个人做法仅作者或管理员维护。
- **菜单做法**：点菜默认使用家庭做法，认领后优先采用认领人的常用做法，也可手动切换；菜单保存做法快照，历史采购不受后续编辑影响。
- **购物清单**：菜单食材自动合并，也可手动填写物品、数量和单位；支持勾选与删除。
- **家庭库存**：维护调料、主食、饮料、零食和日用品余量，低库存提示并一键加入采购。
- **Web 移动端模拟**：在桌面浏览器中以移动端布局完成全部常用流程，无需键盘快捷键。
- **原生基础**：Expo 项目仍可通过 Expo Go 在手机上运行。

## 规划模块

- 家庭、成员、权限、数据库迁移和备份恢复
- 活动记录、成员管理、积分与奖励
- 结构化多片候选投票
- MoviePilot 订阅状态持久化、媒体就绪通知和 Plex/Emby 播放进度
- MoviePilot 后台自动对账、遗漏回调恢复和部分整理失败识别
- 访客邀请、临时权限和访客 Wi-Fi
- 中兴或其他家庭网络设备连接器
- 家庭资产、维护周期和知识资料
- 按真实家庭阶段增加儿童能力，不提前建设空模块

## 技术栈

| 端 | 技术 |
| --- | --- |
| 客户端 | Expo SDK 57、React Native、Expo Router、React Query、Lucide |
| Web | Expo Web / React Native Web，响应式移动与桌面布局 |
| API | NestJS 10、TypeORM、短时 JWT 与可撤销会话 |
| 数据库 | PostgreSQL 16 |
| 本地环境 | Docker Compose + pnpm monorepo |

## 本地 Web 演示

前置环境：Docker Desktop、Node.js 20+。仓库根目录执行：

```bash
# 安装工作区依赖（首次运行或依赖变更后）
npx pnpm install

# 启动 PostgreSQL、种子任务和 API
docker compose -f docker-compose.dev.yml up --build

# 另开终端启动 Expo Web
cd apps/mobile
npx expo start --web --port 8081
```

浏览器访问：

- Web：<http://localhost:8081>
- API：<http://localhost:3100>
- API 存活检查：<http://localhost:3100/health/live>
- API 就绪检查：<http://localhost:3100/health/ready>

需要连接 NAS 或在线元数据时，先复制 `.env.example` 为 `.env`。Plex、Emby、MoviePilot 可以独立启用；影视搜索支持 TMDB、豆瓣兼容桥接和 Bangumi，配置契约见 [M4-E 三源影视搜索验收](docs/m4-media-search-acceptance.md)。`MEDIA_PRIMARY_LIBRARY` 只控制多个媒体库播放入口的默认排序。凭据只进入本地 `.env` 或密钥文件，不得提交到 Git。

同一局域网的其他电脑可以将 `localhost` 换为运行项目电脑的局域网 IP。Web 客户端会根据当前页面主机名连接同一主机的 `3100` 端口。

`docker-compose.dev.yml` 中的密码和 JWT 密钥只用于本地开发，不应直接用于长期家庭部署。

全新开发卷会创建账号“爸爸”和“妈妈”，开发密码均为 `family1234`。已有开发卷升级后，账号名沿用成员名，原 PIN 作为账号密码；原来没有 PIN 的账号第一次登录可留空密码，进入“我的 -> 账号安全”后应立即补设至少 8 位密码。

API 安全相关配置：

| 环境变量 | 本地默认值 | 作用 |
| --- | --- | --- |
| `JWT_SECRET` | 仅 Docker 演示密钥 | JWT 签名；生产环境必须显式配置 |
| `JWT_SECRET_FILE` | 无 | JWT 密钥文件；配置时优先于 `JWT_SECRET` |
| `BOOTSTRAP_SECRET_FILE` | 无 | 首户初始化密钥文件；生产环境必须配置 |
| `DB_PASSWORD_FILE` | 无 | 数据库密码文件；配置时优先于 `DB_PASSWORD` |
| `JWT_EXPIRES_SECONDS` | `900` | 访问令牌有效期，默认 15 分钟 |
| `REFRESH_TOKEN_EXPIRES_SECONDS` | `2592000` | 刷新会话有效期，默认 30 天并在每次续期时轮换 |
| `LOGIN_RATE_LIMIT` | `5` | 单个来源在窗口内允许的登录次数 |
| `LOGIN_RATE_WINDOW_MS` | `60000` | 登录限流窗口，默认 1 分钟 |
| `REMINDER_POLL_INTERVAL_MS` | `15000` | 到期提醒扫描间隔，限制在 100 毫秒至 5 分钟 |
| `CORS_ORIGINS` | 开发环境自动允许本机和私有局域网 | 逗号分隔的 Web 客户端来源白名单 |
| `TRUST_PROXY_HOPS` | `0` | 可信反向代理层数；生产 Caddy 部署为 `1` |

原生 Expo 请求没有浏览器 `Origin`，不受 CORS 白名单影响。生产环境不配置 `CORS_ORIGINS` 时不会授权任何浏览器来源。

服务端只保存刷新令牌和成员邀请码的 SHA-256 哈希；退出、家庭角色变化或账号密码变化会立即撤销对应旧会话。启动续期和并发 `401` 共享单飞续期，并会跳过已被新令牌取代的过期响应。iOS/Android 使用 `SecureStore` 保存会话，当前 Web 演示使用 `localStorage`，因此 Web 端仍受同源脚本和 XSS 边界约束。正式外网部署必须使用 HTTPS、严格内容安全策略，并评估改为同站 `HttpOnly` Cookie 或可信反向代理会话。

API 会为每个请求回传 `X-Request-ID`。结构化日志只保留路由模板、状态、耗时和已认证的账号/家庭/成员 UUID，不记录请求体、查询值、姓名、IP、密码或令牌；错误响应体也包含同一个请求 ID，便于定位问题。

停止服务：

```bash
docker compose -f docker-compose.dev.yml down
```

命名卷保存数据库和上传文件；`down` 不会删除数据。不要执行 `down -v`，除非明确要删除本地数据。

## 数据迁移与备份

数据库结构由 TypeORM 迁移管理，API 和种子任务启动时自动运行待执行迁移，不再使用 `synchronize` 修改表结构。

```bash
# 创建数据库与上传文件的完整备份
./scripts/backup-dev.sh

# 只恢复到新的演练数据库，不覆盖当前数据
./scripts/restore-dev.sh backups/<备份时间> family_app_restore_test
```

完整的文件说明、异机备份建议和恢复演练流程见 [本地开发数据备份与恢复](docs/backup-restore.md)。

家庭长期运行使用固定 API/Web 镜像、Docker secrets、Caddy 自动 HTTPS 和不暴露数据库端口的独立 Compose。配置与更新步骤见 [家庭长期运行部署](docs/production-deployment.md)。生产编排不会自动执行演示种子数据。

## Expo Go

API 运行后，在仓库根目录执行：

```bash
npx pnpm --filter mobile start
```

手机安装 Expo Go，并与开发电脑连接同一 Wi-Fi。客户端会优先使用 `EXPO_PUBLIC_API_URL`，否则从 Expo 的 `hostUri` 推导 API 地址。

## 验证

```bash
# API、客户端和 Playwright 测试代码的类型检查
corepack pnpm typecheck

# Expo 官方规则静态检查
corepack pnpm lint

# Expo 依赖版本检查
(cd apps/mobile && ./node_modules/.bin/expo install --check)

# Compose 配置检查（仓库根目录）
docker compose -f docker-compose.dev.yml config --quiet

# 现有 API 冒烟流程（API 已启动）
node apps/api/scripts/smoke.mjs

# 三源元数据映射、合并、缓存与降级契约
corepack pnpm --filter api test:metadata

# 家庭数据隔离测试（API 已启动）
npx pnpm --filter api test:isolation

# 检查实体元数据与已执行迁移是否一致
npx pnpm --filter api test:schema

# 自动创建临时数据库和 API，验证首户初始化、账号迁移、邀请、CORS、权限、限流、
# 家庭隔离、统一日历、周期任务、通用通知、家庭投票、可配置提醒、多人菜谱、菜单做法快照、采购、菜单协作、审计、健康检查、请求日志、敏感信息保护、
# 唯一约束和事务回滚，结束后自动清理
docker compose -f docker-compose.dev.yml run --rm --no-deps api \
  pnpm --filter api test:api

# 固定 Chrome 回归：鼠标登录、390px 移动视口、1440px 桌面视口和核心导航
# 运行前保持 API/数据库健康；日历事件和任务在用例内创建、编辑并停用，不保留活动测试数据
corepack pnpm test:web
```

Playwright 默认依次兼容全新开发卷密码 `family1234` 和旧库迁移出的空密码。账号已经补设其他密码时，使用 `E2E_ACCOUNT_PASSWORD='<测试密码>' corepack pnpm test:web`；也可通过 `E2E_LOGIN_NAME` 指定测试账号。它直接使用本机安装的 Google Chrome，不会额外下载浏览器。失败时的截图、录像和 trace 保存在 `apps/mobile/test-results/`，该目录不会提交到 Git。

## 项目结构

```text
apps/
├── api/
│   ├── src/auth/          # JWT 登录与全局守卫
│   ├── src/calendar/      # 统一日历聚合与家庭事件
│   ├── src/dishes/        # 菜品基础资料与旧接口兼容
│   ├── src/inventory/     # 家庭库存
│   ├── src/menus/         # 菜单、点菜状态和日期汇总
│   ├── src/media/         # 家庭片单、排期与媒体连接器契约
│   ├── src/notifications/ # 跨业务站内通知与已读状态
│   ├── src/polls/         # 通用家庭投票、改票与结果
│   ├── src/recipes/       # 多成员做法、厨艺关联与菜单快照
│   ├── src/reminders/     # 跨模块定时提醒与幂等投递
│   ├── src/shopping/      # 购物清单
│   ├── src/tasks/         # 家庭任务、周期实例和权限
│   ├── src/upload/        # 图片上传
│   └── src/entities/      # 当前 TypeORM 实体
└── mobile/
    ├── e2e/               # Playwright 登录与双视口 Web 回归
    ├── playwright.config.ts
    └── src/
        ├── app/           # Expo Router 页面
        ├── components/    # 应用外壳、日历、库存和通用 UI
        └── lib/           # API、查询、会话、菜篮、日期和主题

docs/
├── family-platform-plan.md       # 家庭管理平台总体方案
├── m3-reminders-acceptance.md    # 可配置提醒验收约定
├── m3-polls-acceptance.md        # 通用家庭投票验收约定
├── m4-media-polls-acceptance.md  # 片单来源投票验收约定
├── m4-media-connectors-acceptance.md # 媒体连接器验收约定
├── m4-media-search-acceptance.md # 三源影视搜索验收约定
├── m4-moviepilot-reconciliation-acceptance.md # MoviePilot 后台对账验收约定
├── m4-series-availability-acceptance.md # 剧集季入库核验验收约定
├── m5-guest-visits-acceptance.md # 访客与来访计划验收约定
├── m5-guest-wifi-acceptance.md   # 手动访客 Wi-Fi 二维码验收约定
├── m5-guest-movie-voting-acceptance.md # 访客观影投票验收约定
├── m5-guest-meal-requests-acceptance.md # 访客点菜请求验收约定
├── m3-tasks-acceptance.md        # 家庭任务与通用通知验收约定
└── recipe-variants-acceptance.md # 独立菜谱与多人做法验收约定
```

## 路线图

- [x] M1：点菜本地演示版
- [x] M2：家庭数据边界、账号、迁移、备份、安全和自动化测试
- [x] M3：家庭公共能力（日历、任务、通知、投票、提醒、成员与活动）
- [ ] M4：观影 MVP、在线搜索、MoviePilot/Plex/Emby 连接器与观看记录
- [ ] M5：访客与家庭网络
- [ ] M6：库存采购闭环、家庭资产和积分
- [ ] M7：按真实需求扩展儿童、健康、出行等模块

详细范围与验收标准见 [总体方案的分阶段路线图](docs/family-platform-plan.md#21-分阶段路线图)。
