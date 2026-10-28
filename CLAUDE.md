# 家庭管理 App「小管家」

家庭生活协作平台的 API + 客户端。长期蓝图见 `docs/family-platform-plan.md`；**当前主线进度与后续顺序以 `docs/architecture.md` 的进度表为准**。`docs/refactor-plan.md` 是 2026-09 的分片重建决策与历史基线，动手前仍需读其中的约束，但不要把它的阶段快照当成当前状态。

已实现家庭账号与成员、点菜闭环（菜谱/点菜/厨房协作/购物/库存/智能菜单）、日历/任务/提醒/投票/通知/积分、观影与媒体连接器（TMDB/豆瓣/Bangumi/Plex/Emby/MoviePilot）、访客、资产维护、知识库、出行、回忆、家庭财务、备份运维、小管家智能体等业务域。规模不要手工推算，以自动生成的 `docs/api-inventory.md` 为准；2026-10-21 清单为 29 个模块、340 个端点，契约 340/340。小管家以自研 `NativeAgentRuntime` 为主线，Hermes 兼容实现保留到 J4.6 验收后下线。每个域的业务规则以 `docs/m*-acceptance.md` 为准。

## 结构

- `apps/api` — NestJS 10 + TypeORM + PostgreSQL 16。J7.1/J7.2 已把主要业务模块按 module / controller / service / DTO 及子服务拆分，少量简单域仍保留合并文件；实体按域拆在 `src/entities/<域>.ts`（J7.4，2026-10-23），`src/entities/index.ts` 只做汇总导出与 `ALL_ENTITIES`，业务代码照旧 `from '../entities'`。schema 由 `src/database/migrations` 管理（不用 synchronize）
- `apps/web` — Vite + React 19 + TanStack Query + React Router + Tailwind 4；数据 hook 在 `src/lib/queries/`，类型一律从 `@family/contracts` 取。旧 Expo 客户端 `apps/mobile` 已在 H1（2026-09-28）删除
- `apps/api/scripts/*.mjs` — 黑盒 HTTP 测试，`run-api-tests.mjs` 自建临时库跑全套；`run-web-tests.mjs` 起隔离 API 跑 Playwright
- `packages/shared` — 框架无关的公共工具（`DomainError` 系列、日期、文本、`isUniqueViolation`、`isHouseholdManager`）；API 里不要再复制这些函数。**依赖 `node:` 的公共函数不要放这里**（shared 要保持纯 TS，客户端将来可能直接吃它），放 `apps/api/src/common/`，比如 `fingerprint.ts`（幂等指纹，注意有规范化/非规范化两种算法，改算法会让落库指纹作废）
- `packages/contracts` — 每个端点的 Zod 请求/响应契约 + `contractIndex`；API 在 `NODE_ENV=test` 下用 `ContractsInterceptor` 校验响应、`ContractsRequestInterceptor` 校验请求（只判 API 已经接受了的请求；`CONTRACT_REQUEST_CHECK=report` 可只记日志不拦截，用来一次性收集全部不一致）。端点覆盖数以 `docs/api-inventory.md` 为准，当前为 **340/340**；客户端 `lib/types.ts` 不再手写任何类型，只从这里 re-export。新增端点必须同时加契约，否则清单的"契约"列会出现空缺
- `scripts/api-inventory.mjs` — 从 Controller 生成端点清单（含"契约"列），CI 用 `--check` 保证不过期
- `.github/workflows/ci.yml` — typecheck → lint → 端点清单 → API 黑盒 → Playwright

## 约定

- pnpm 用 `corepack pnpm` 调用（不在 PATH）。**不要用 `npx pnpm`**：它会拉最新版 pnpm，和 `packageManager` 钉的 10.34.5 对不上，脚本里再 spawn 一次 pnpm 时会直接 `ERR_PNPM_BAD_PM_VERSION`
- API 统一响应 `{data}` / `{error:{code,message}}`；请求日志不得包含请求体、姓名、IP、令牌
- **UI 开发遵循 `.claude/skills/` 的 emilkowalski 技能包**：`apple-design`、`emil-design-eng`；enter 动画 ease-out、确认操作配 haptics、暗色模式必须支持
- Git 提交信息用中文
- 新增或修改端点后运行 `node scripts/api-inventory.mjs` 重新生成清单并一起提交（需先 `corepack pnpm build:packages`，否则契约列为空）
- 新增业务域或修改插件 manifest 前先读 `docs/plugin-development.md`；当前插件是仓库内编译期接入，Nest 模块、Web 路由、助理工具、实体迁移及测试仍可能需要显式登记，不能只提交一份 manifest
- 请求校验正在从 class-validator DTO 换成契约 schema：新端点直接用 `@ZodBody(schema)` / `@ZodQuery(schema)` / `@ZodParam(name, schema)`（`src/common/zod.ts`），不要再写 DTO 类。**换旧域时逐条对照 DTO 的装饰器**——契约里缺的约束要补进契约（不是在管道上开口子），并给黑盒脚本补一条断言；目前只有 polls 换完
- 改了 `packages/*` 后必须先重新构建再跑测试（`corepack pnpm build:packages`，即 `node scripts/build-packages.mjs`；`pnpm install` 的 postinstall 也会构建）——API 吃的是 `dist`，不重建就是在用旧 schema 测试
- `test:api -- --only <域>` 只用于迭代；提交前的验收必须全量跑，有些契约违规只在前面脚本的数据落库后才会出现

## 重构期约束（来自 docs/refactor-plan.md 第 6 节）

- 每个 PR 只碰一个业务域
- 新代码禁止直接 import 旧模块的 Service；跨域调用走接口或事件
- 任何业务规则必须能在不起数据库的情况下被单测覆盖（放 `packages/core`，不放 React 组件）
- 改 `packages/contracts` 或端点契约时，必须同步更新对应的 `apps/api/scripts/*.mjs` 黑盒脚本；给一个域补契约的标准动作是：写 schema → `defineEndpoint` 注册 → 跑 `test:api -- --only <域>` 看 `CONTRACT_VIOLATION` → 客户端 `types.ts` 改为 re-export
- 新文件不超过 400 行（API 侧 ESLint `max-lines` 会告警）
- 旧 Expo 端已在 H1 删除；自研 agent loop 与外围回归已经跑通，Hermes 仍须按 J4.6 收集连续一周 Native 实测证据后再下线，不能只因自动化通过就删除

## 当前主线顺序（2026-10-21）

1. 收集 Native 小管家连续一周实测证据；满足后执行 J4.6，下线 Hermes 兼容路径。
2. J4.6 后重新统计 `apps/api/src/agent` 超长文件并执行 J7.3（J7.4 实体拆分已于 2026-10-23 完成）。
3. J6 已于 2026-10-23 收口（插件指南、清单生成器修复、lint 老警告清零、升级脚本自动修剪回滚标签、依赖升级评估 `docs/dependency-upgrade-assessment.md`）。依赖升级第 1、2 步已于 2026-10-26 做完；第 3～5 步的改动清单见该文档第四节（2026-10-28），顺序改为 TS 6 → NestJS 12 → TypeORM 1.1，TS 7 暂缓，不再等 J7.3。
4. J3 仅在试用满两周、原话不少于 100 条、覆盖不少于 5 个域三项同时满足后启动；2026-10-15～2026-10-28 只是暂定试用窗口，不代表实际试用已经开始。J5 尚未启动。

## 常用命令

```bash
corepack pnpm install                        # 安装工作区依赖
corepack pnpm api                            # API dev (localhost:3100，依赖本机 PostgreSQL 5433)
corepack pnpm seed                           # 灌种子数据
API_URL=http://localhost:8088/api corepack pnpm demo   # 再造一套演示数据（走 HTTP，幂等）
corepack pnpm --filter web dev          # Web 客户端（:5180，/api 默认代理到 8088）
corepack pnpm typecheck                      # API + 客户端类型检查
corepack pnpm lint                           # API + 客户端 lint
corepack pnpm api:inventory                  # 重新生成 docs/api-inventory.md
corepack pnpm --filter api test:api          # 全套 API 黑盒测试（需要本机 PostgreSQL）
corepack pnpm --filter api test:api -- --only tasks,points   # 只跑指定脚本（--list 查看可用名）
corepack pnpm test:web                       # Playwright 双视口回归
docker compose -f docker-compose.dev.yml up --build     # 本地 PostgreSQL + API
```
