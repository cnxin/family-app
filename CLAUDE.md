# 家庭管理 App「小管家」

家庭生活协作平台的 API + 客户端。长期蓝图见 `docs/family-platform-plan.md`，**当前正在按 `docs/refactor-plan.md` 做分片重建**，动手前先读它。

已实现的业务域（24 个后端模块、275 个端点，完整清单见 `docs/api-inventory.md`）：家庭账号与成员、点菜闭环（菜谱/点菜/厨房协作/购物/库存/智能菜单）、日历/任务/提醒/投票/通知/积分、观影与媒体连接器（TMDB/豆瓣/Bangumi/Plex/Emby/MoviePilot）、访客、资产维护、知识库、出行、回忆、家庭财务、备份运维、小管家智能体（Hermes + MCP）。每个域的业务规则以 `docs/m*-acceptance.md` 为准。

## 结构

- `apps/api` — NestJS 10 + TypeORM + PostgreSQL 16。每个模块目前是单文件 `xxx.module.ts`（DTO + Service + Controller），实体集中在 `src/entities/index.ts`，schema 由 `src/database/migrations` 管理（不用 synchronize）
- `apps/mobile` — Expo SDK 57 + expo-router + React Query；`lib/queries.ts` 是全部数据 hook，`lib/types.ts` 是手工维护的 API 类型
- `apps/api/scripts/*.mjs` — 黑盒 HTTP 测试，`run-api-tests.mjs` 自建临时库跑全套；`run-web-tests.mjs` 起隔离 API 跑 Playwright
- `packages/shared` — 框架无关的公共工具（`DomainError` 系列、日期、文本、`isUniqueViolation`、`isHouseholdManager`）；API 里不要再复制这些函数
- `packages/contracts` — 每个端点的 Zod 请求/响应契约 + `contractIndex`；API 在 `NODE_ENV=test` 下用 `ContractsInterceptor` 校验响应，客户端 `lib/types.ts` 从这里 re-export 类型。目前覆盖 tasks、polls、calendar、reminders、points、dishes、recipes、shopping、inventory、menus、notifications、activities（85/275）
- `scripts/api-inventory.mjs` — 从 Controller 生成端点清单（含"契约"列），CI 用 `--check` 保证不过期
- `.github/workflows/ci.yml` — typecheck → lint → 端点清单 → API 黑盒 → Playwright

## 约定

- pnpm 通过 `npx pnpm` 或 `corepack pnpm` 调用（不在 PATH）
- API 统一响应 `{data}` / `{error:{code,message}}`；请求日志不得包含请求体、姓名、IP、令牌
- **UI 开发遵循 `.claude/skills/` 的 emilkowalski 技能包**：`apple-design`、`emil-design-eng`；enter 动画 ease-out、确认操作配 haptics、暗色模式必须支持
- Git 提交信息用中文
- 新增或修改端点后运行 `node scripts/api-inventory.mjs` 重新生成清单并一起提交（需先 `corepack pnpm build:packages`，否则契约列为空）
- 改了 `packages/*` 后必须先重新构建再跑测试（`corepack pnpm build:packages`，即 `node scripts/build-packages.mjs`；`pnpm install` 的 postinstall 也会构建）——API 吃的是 `dist`，不重建就是在用旧 schema 测试
- `test:api -- --only <域>` 只用于迭代；提交前的验收必须全量跑，有些契约违规只在前面脚本的数据落库后才会出现

## 重构期约束（来自 docs/refactor-plan.md 第 6 节）

- 每个 PR 只碰一个业务域
- 新代码禁止直接 import 旧模块的 Service；跨域调用走接口或事件
- 任何业务规则必须能在不起数据库的情况下被单测覆盖（放 `packages/core`，不放 React 组件）
- 改 `packages/contracts` 或端点契约时，必须同步更新对应的 `apps/api/scripts/*.mjs` 黑盒脚本；给一个域补契约的标准动作是：写 schema → `defineEndpoint` 注册 → 跑 `test:api -- --only <域>` 看 `CONTRACT_VIOLATION` → 客户端 `types.ts` 改为 re-export
- 新文件不超过 400 行（API 侧 ESLint `max-lines` 会告警）
- 旧 Expo 端与 Hermes 在新实现跑通对应 Playwright / `agent*.mjs` 之前不删

## 常用命令

```bash
npx pnpm install                        # 安装工作区依赖
npx pnpm api                            # API dev (localhost:3100，依赖本机 PostgreSQL 5433)
npx pnpm seed                           # 灌种子数据
npx pnpm mobile                         # Expo dev server
npx pnpm typecheck                      # API + 客户端类型检查
npx pnpm lint                           # API + 客户端 lint
npx pnpm api:inventory                  # 重新生成 docs/api-inventory.md
npx pnpm --filter api test:api          # 全套 API 黑盒测试（需要本机 PostgreSQL）
npx pnpm --filter api test:api -- --only tasks,points   # 只跑指定脚本（--list 查看可用名）
npx pnpm test:web                       # Playwright 双视口回归
docker compose -f docker-compose.dev.yml up --build     # 本地 PostgreSQL + API
```
