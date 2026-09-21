# 小管家 · 功能分析与重构（换栈/重写）计划

> 基于 `main` 分支 `2127c70` 的代码通读整理（2026-09-15，同日补入已确认决策）。数据均来自仓库实际统计，可用文末命令复核。
> 本文目的：先说清楚现在有什么、问题在哪，再回答"要不要换栈重写、怎么换才不翻车"。

---

## 0. 一句话结论

**不建议一次性推倒重写；建议"保留数据库与 HTTP 契约，按业务切片逐个重建"，换栈与否放到试点切片之后再决定。**

理由：项目功能面非常宽（24 个后端模块、99 个实体、275 个端点、约 9.5 万行业务代码），业务规则大多经过验收文档和黑盒测试固化。真正的问题不在技术栈本身，而在代码组织方式（单文件巨模块、手工同步的类型、无单元测试与 CI）。这些问题用"分片重建 + 共享契约"就能解决，同时保留随时切换技术栈的自由；而大爆炸式重写会把已经跑通的 275 个端点和几十条状态机重新暴露在回归风险里，且中途没有可交付物。

---

## 1. 项目现状总览

### 1.1 技术栈与规模

| 端 | 技术 | 规模 |
| --- | --- | --- |
| API | NestJS 10 + TypeORM 0.3 + PostgreSQL 16，Zod、class-validator 并存 | `apps/api/src` 51,149 行 TS；24 个 Nest 模块；99 个实体；61 个迁移；275 个 HTTP 端点（POST 116 / GET 86 / PATCH 41 / DELETE 24 / PUT 8）；6 个后台轮询器 |
| 客户端 | Expo SDK 57 + expo-router + React Query 5 + React Native Web | `apps/mobile/src` 43,936 行；32 个 tab 路由页 + 6 个独立页面；`lib/queries.ts` 3,747 行含 229 个 hook；`lib/types.ts` 2,140 行手工维护类型 |
| 智能体 | Hermes Agent（`nousresearch/hermes-agent` 镜像）通过 MCP 调 API 内部端点 `/internal/agent/mcp`，暴露 28 个工具（21 个读取/记忆 + 7 个 `propose_*`） | `apps/api/src/agent` 17 个文件 8,110 行 |
| 测试 | 无单元测试框架；`apps/api/scripts/` 黑盒 HTTP 测试 17,174 行（`run-api-tests.mjs` 自建临时库 + 临时 API 进程，串行跑 40 余个脚本）；Playwright Web 回归 7,763 行 / 51 个用例；5 个 contract 测试 | 无 CI（无 `.github/`），API 无 lint 配置 |
| 开发节奏 | 全部 155 次提交集中在 2026-07-27 → 08-12（17 天），提交信息显示大量由 Codex / Claude 生成 | 说明"重写"的边际成本对这个项目来说远低于传统团队，但**验证成本不会同比下降**——这正是本计划把安全网放在第一步的原因 |
| 部署 | Docker Compose（db / api / web / backup-worker）+ Caddy 自动 HTTPS；独立 `docker-compose.agent.yml` 跑 Hermes | 5 个 Dockerfile（api 开发 / api 生产 / web / backup-worker） |

### 1.2 功能地图（按业务域）

| 域 | 模块（后端目录） | 主要能力 | 端点数 |
| --- | --- | --- | --- |
| 家庭账号与成员 | `auth` `activities` | 账号与成员档案分离、首户安全初始化、短时 JWT + 可撤销刷新会话、登录限流、限时成员邀请、`owner/admin/member` 三角色 + 15 项 capability、家庭活动审计流水 | 17 |
| 点菜闭环 | `dishes` `recipes` `menus` `shopping` `inventory` `smart-menu` | 菜品库、多成员做法变体与厨艺标记、按日期点菜与做法快照、厨房协作（主厨/认领/进度/划掉）、购物差额计算、库存批次与不可变流水、食材批次智能菜单 | 43 |
| 家庭公共能力 | `calendar` `tasks` `reminders` `polls` `notifications` `points` | 统一日历聚合 7 类来源、周期任务实例与积分发放、跨模块定时提醒、单/多选投票、站内通知 + 加密 Webhook/ntfy 外部渠道（指数退避重试）、积分行锁余额与奖励兑换状态机 | 45 |
| 观影与媒体 | `media` | 片单/状态/月份排期、TMDB + 豆瓣桥接 + Bangumi 三源并行搜索、Plex/Emby 入库检查与播放入口、用户映射与观看进度、MoviePilot 订阅/回调/后台对账、片单发起投票 | 32 |
| 访客 | `guests` | 访客档案、来访计划、限时邀请令牌、Wi-Fi 二维码限时展示、访客观影投票、访客点菜请求、匿名化 | 21 |
| 家庭运营 | `assets` `knowledge` `travel` `memories` `finance` `system` `upload` | 资产档案/保修/维护周期/耗材联动库存/私有附件签名访问、知识库版本历史与并发保护、出行清单与模板、家庭回忆与照片、家庭财务（账户/交易/过账/预算，反向流水撤销）、订阅续费提醒、备份策略与恢复演练 | 77 |
| 小管家智能体 | `agent` | 会话/运行/工具事件、动作提案与多步骤提案组（确认式执行）、个人记忆（候选/确认/共享/纠正/遗忘）、成员画像、例行任务与家庭周报、外部渠道配对、页面上下文注入、保留期清理、MCP 服务端 | 40 |

客户端按角色分两套信息架构：`member` 角色走"今天/厨房/日历/通知/我的"消费者视图；`owner/admin` 桌面端走 `app-shell.tsx` 的侧栏管理台。四类业务页面已铺开"小管家上下文入口"。

### 1.3 值得肯定、必须保留的资产

- **数据模型与迁移**：61 个迁移按时间戳线性演进，`test:schema` 能检查实体与迁移漂移；财务/积分/库存都用不可变流水 + 反向冲销，家庭隔离（`household_id`）贯穿全部表。这是整个项目最值钱的部分，任何重写都应**原样保留数据库 schema**。
- **黑盒测试体系**：`run-api-tests.mjs` 自建临时库 + 临时 API 进程串行跑 40 余个脚本（含种子迁移与旧 PIN 迁移验证）；Playwright 用随机库和随机密码隔离。它们只依赖 HTTP 契约，不依赖实现，**天然就是换栈时的回归安全网**。
- **验收文档**：`docs/m*-acceptance.md` 共 30 余篇，把每个模块的业务规则写成了验收约定，可直接当重建时的需求说明。
- **安全基线**：请求 ID、结构化日志脱敏、CORS 白名单、Docker secrets、私有附件短时签名、刷新令牌轮换。
- **智能体工具契约**：28 个 MCP 工具名与 Hermes 配置（`deploy/hermes/config.yaml`）是外部依赖面，重建时保持不变即可继续用现有 Hermes 镜像。

---

## 2. 问题诊断（为什么感觉"该重写了"）

### 2.1 后端：单文件巨模块

每个业务模块是**一个** `xxx.module.ts`，DTO、工具函数、多个 Service、Controller、Module 定义全部塞在一起：

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `entities/index.ts` | 7,812 | 99 个实体全在一个文件 |
| `assets/assets.module.ts` | 2,001 | DTO + 资产/维护/耗材/附件多个 Service + Controller |
| `media/media.module.ts` | 1,904 | 同上，另有 10 个 media 子服务文件 |
| `travel/travel.module.ts` | 1,725 | |
| `guests/guests.module.ts` | 1,416 | |
| `auth/auth.module.ts` | 1,249 | `AuthService`/`MemberManagementService`/`InvitationService` 三个类未导出 |
| `agent/agent-tools.service.ts` | 1,328 | 28 个工具的实现集中在一个类 |

直接后果：无法按类做单元测试；一个 PR 改动几乎必然碰到千行文件；AI 编码工具每次都要加载整份文件，token 成本高、误改概率大（提交历史里"修复/收紧/加固"类提交占比很高，与此相关）。

### 2.2 后端：横向重复与模块耦合

- 同名工具函数在各模块里复制粘贴：`isUniqueViolation` ×12、`isAdmin` ×8、`fingerprint` ×5、`parseDateOnly`/`today`/`addDays`/`normalizedText` 各 ×4。没有 `common/` 层承接。
- `agent` 模块直接 import 了 13 个业务模块（assets/calendar/finance/inventory/knowledge/media/memories/menus/polls/reminders/shopping/tasks/travel），是全项目耦合中心；`smart-menu` 依赖 `menus`+`polls`，`reminders` 依赖 `calendar`+`tasks`，`tasks` 依赖 `points`。这些依赖都是"直接注入对方 Service"，没有事件或接口隔离。
- 校验层并存 class-validator（DTO 装饰器）与 Zod（agent、部分连接器），两套错误格式要靠 `AllExceptionsFilter` 统一。
- 6 个 `setInterval` 轮询器（提醒、通知投递、备份调度、agent 例行任务、agent 清理、MoviePilot 对账）散落在各自 Service 里，没有统一的任务调度抽象，多实例部署会重复执行。

### 2.3 客户端：类型手工同步、查询层巨石、页面巨石

- `lib/types.ts` 2,140 行是**手工**照着后端实体和 DTO 抄的，没有任何生成或共享机制；后端字段一改，前端只能靠肉眼对。
- `lib/queries.ts` 3,747 行、229 个 hook、**300 处 `invalidateQueries`**，其中 `['activities']` 被 38 处失效、`['calendar']` 15 处；缓存失效策略是"每个 mutation 手写一串 key"，漏一处就出现脏数据。
- 页面文件极大：`media/watchlist.tsx` 3,103 行（48 个 `useState`，12 个内联组件），`assets.tsx` 2,036 行（51 个 `useState`），`assistant.tsx` 1,789 行，`polls.tsx` 1,705 行。表单、对话框、列表项全部在页面内定义，无法复用也无法单测。
- 同名组件/函数重复：`firstParam` ×12、`Field` ×5、`errorMessage` ×4、`dateLabel` ×4，`Sheet`/`StatusBadge`/`FormField`/`PlanForm` 各在两处独立实现。`components/ui.tsx` 1,217 行装着 16 个基础组件，`AdaptiveDialog` 一个组件 350 行。
- 9 处 `refetchInterval` 轮询（2s～30s）叠加在一起，通知、agent 运行、提案组、备份状态各自轮询，Web 端常驻多路定时请求。
- 32 个页面全部挂在 `(tabs)` 组下，用 `href: null` 隐藏 22 个，路由层已经不能表达真实信息架构。

### 2.4 工程化缺口

- 没有 CI：`typecheck`、`lint`、`test:api`、`test:web` 都靠手动跑。
- API 侧没有 ESLint 配置；客户端只有 `eslint-config-expo` 默认规则。
- 没有单元测试框架，所有测试都要起 PostgreSQL + API 进程，单次全量约需分钟级，无法在改一个函数时快速验证。
- 根目录同时存在 4 个 Dockerfile 和 5 份 compose 文件，命名看不出用途（`Dockerfile.backup` 实际是备份 worker 镜像）；README 与 CLAUDE.md 描述已经落后于代码（CLAUDE.md 仍说"当前已实现模块：点菜与家庭库存"）。
- 项目根 `test-screenshots/` 是 A7.4a 阶段的人工验收截图，只被一份操作指令文档引用。

---

## 3. 换栈 / 重写评估

### 3.1 三条路线对比

| | A. 原地结构重构 | **B. 分片重建（推荐）** | C. 全量重写 |
| --- | --- | --- | --- |
| 做法 | 技术栈不变，拆文件、抽公共层、补测试 | 保留 PostgreSQL schema 与 HTTP 契约，新建 `apps/api-next`（技术栈可换），按业务域逐个迁移端点，Caddy/网关按路径前缀分流；客户端按 feature 目录逐页重建 | 新仓库/新栈从零实现全部功能，完成后一次切换 |
| 换栈自由度 | 无 | 有（每个切片都可选新栈，试点后统一） | 有 |
| 中途可交付 | 每周都可合并 | 每完成一个域即可上线 | 数月内无可用版本 |
| 回归风险 | 低 | 中，可被现有黑盒测试覆盖 | 高，275 端点 + 几十条状态机需全部重验 |
| 预估周期（按当前 AI 辅助节奏，瓶颈在验证而非写代码） | 2～3 周 | 2～3 个月（可停可续） | 3 个月以上，且中途需求冻结 |
| 主要风险 | 巨石文件拆完仍是 NestJS/Expo 的老约束 | 双栈并行期的运维复杂度；跨域事务（如任务完成→积分发放）在切片边界处需要暂时走 HTTP 或共用 DB | 需求冻结不现实（最近一批提交仍在加财务、订阅、周报）；隐性规则（验收文档未写全的）会丢 |

### 3.2 技术栈候选与建议

**后端**

| 选项 | 评价 |
| --- | --- |
| 保留 NestJS，重组目录 | 成本最低。NestJS 本身没有阻碍，问题是"一模块一文件"。适合作为路线 B 的保底选择。 |
| Hono / Fastify + Drizzle ORM + Zod（TypeScript） | **推荐试点**。理由：项目已经在用 Zod；Drizzle 可以从现有 PostgreSQL 直接 `introspect` 出 schema，不必重写 61 个迁移；无装饰器、无 DI 容器，文件天然按 route/service/schema 分层，对 AI 编码工具更友好；MCP SDK、测试脚本都是 Node 生态，零迁移。代价：要自己搭 DI 与模块边界约定，多实例调度需引入 pg-boss 之类。 |
| 换语言（Go / Rust / Python） | 不建议。会失去与客户端共享 TS 类型的可能，17k 行测试脚本与 MCP 集成也要重来，收益不足以抵消。 |

**客户端（已确认：先纯 Web，后续再迁 App / 小程序）**

| 选项 | 评价 |
| --- | --- |
| 保留 Expo + expo-router，按 feature 重组 | 不再采用。原生能力（haptics、SecureStore、glass-effect、图片选择）在 25 个文件里使用，纯 Web 全部有等价替代（Vibration API、HttpOnly Cookie、CSS backdrop-filter、`<input type=file>`）。 |
| **纯 Web（Vite + React 19 + TanStack Router/Query + PWA）** | **采用**。去掉 RN Web 这一整层兼容成本（`Platform.OS` 分支、RN 样式限制、`AdaptiveDialog` 双端适配）。会话改为同站 HttpOnly Cookie，顺手解决 README 里自己标注的 Web `localStorage` 存令牌的 XSS 边界问题。 |
| Taro / uni-app 一套代码多端 | **不建议现在上**。为了将来的小程序把今天的 Web 绑在跨端框架上，会把 RN Web 的兼容税换成另一种兼容税（组件受限、调试困难、生态滞后）。 |

后续迁 App / 小程序的路径（本次不做，但架构上现在就为它留位置）：

- **App**：PWA 先在手机上直接"添加到主屏幕"用起来；确有需要时用 Capacitor 把同一份 Web 打成 iOS/Android 壳，推送、相机等走 Capacitor 插件，代码复用率接近 100%。
- **小程序**：微信小程序的运行时与 DOM 不兼容，注定是一个**独立的薄 UI 层**。为此，本次 Web 重建要把"业务逻辑"和"UI"严格分开：`packages/contracts`（端点 schema）、`packages/core`（纯 TS 的表单校验、日期、差额计算、状态机判断）、`packages/api-client`（基于 fetch 的类型化客户端，不依赖浏览器 API）。小程序阶段只需重写 UI 层，且用 Taro（React 语法）可以直接复用上述三个包。
- 反过来说，本次 Web 重建里**任何**放进 React 组件的业务规则，将来都要在小程序里再写一遍——这是评审每个 PR 时的硬标准。

**智能体（已确认：Hermes 换成自研 agent loop）**

现有代码已经留好了插槽：`agent.types.ts` 定义了 `AgentRuntime { health, chat, cancel }` 接口，`FakeAgentRuntime` 与 `HermesAgentRuntime` 是它的两个实现；28 个工具的实现在 `AgentToolsService`，MCP Controller 只是它的一层 HTTP 包装；提案/提案组的"模型只能提案、成员确认才执行"机制在 `AgentProposalsService.executeWithinTransaction` 里。自研 loop 就是**第三个 `AgentRuntime` 实现**，不需要动会话、记忆、提案、例行任务这些外围。

建议的形态：

- 新建 `packages/agent-core`：纯 TS，不依赖 Nest 和 HTTP。内容是 `runLoop(model, tools, input) → AsyncIterable<AgentEvent>`，事件包括 `text_delta / tool_call / tool_result / proposal / done / error`。模型访问走 OpenAI-compatible `chat/completions`（现在 LongCat 就是这么接的），用一个 `ModelProvider` 接口隔离，方便换模型。
- 工具注册表从 `AgentToolsService` 抽成 `packages/agent-core` 里的 `ToolRegistry`：每个工具 = Zod 参数 schema + 描述 + `execute(ctx, args)`；MCP Controller 保留为可选的对外暴露（未来接别的客户端），不再是必经之路。
- 安全边界沿用现有设计并写成代码约束：读工具直接执行；`propose_*` 工具只落 `AgentActionProposal`，不做任何写；页面上下文与检索结果统一标 `untrustedContent`，进入提示词时加围栏；循环上限（步数、工具调用次数、token）作为参数而不是散落的常量（现在 `f0fae68`、`e43d0df` 两次修复都是在补这类上限）。
- 运行方式：先在 API 进程内以 job 形式跑（单家庭够用），事件写入现有 `AgentRun / AgentToolEvent`，客户端用 SSE 订阅 `/agent/runs/:id/events` 替代现在 2 秒一次的轮询。
- 保留 `FakeAgentRuntime` 与现有 `agent*.mjs` 黑盒脚本作为回归；`agent-runtime.contract.ts` 改成对 `packages/agent-core` 的单元测试（用录制的模型响应回放，不打真模型）。
- 可选依赖：如果不想自己写 tool-calling 解析与重试，Vercel AI SDK 的 `generateText/streamText` + `tool()` 能覆盖 80%，且同样是 provider 无关的；但它的抽象层次比"自己 200 行 loop"高，是否引入在 Phase 2 试点时决定。

**必须新增的共享层（无论选哪条路线）**

- `packages/contracts`：用 Zod 定义每个端点的请求/响应 schema，API 用它做校验，客户端用 `z.infer` 得到类型，替代手工维护的 `types.ts`。这是整个计划里投入产出比最高的一项。
- `packages/shared`（或拆为 `core` + `api-client`）：日期（`parseDateOnly`/`addDays`/上海时区）、文本规范化、幂等键、错误码枚举、类型化 fetch 客户端。消灭上面统计的重复函数，并为将来的小程序留出可直接复用的纯逻辑层。

### 3.3 推荐决策

采用路线 **B**。客户端换纯 Web、智能体换自研 loop 已定；**后端是否换栈**变成一个**有证据的决定**，而且排在最后：

1. Phase 0～1 先把安全网和共享契约搭起来（这两步对任何路线都是必需的，不会浪费）。
2. Phase 4 纯 Web 客户端先行——它只依赖 HTTP 契约，不依赖后端实现，是用户最先能看到收益、也最不受后端决策影响的一层。
3. Phase 2 用候选新栈（Hono + Drizzle + Zod）重建两个边界清晰的模块（建议 `polls` 和 `tasks`），跑通现有黑盒测试；在决策门比较代码量、测试耗时、AI 生成/修改一个端点的平均往返次数、部署复杂度。
4. 满意就按 Phase 3 继续迁移剩余域；不满意就退回"保留 NestJS 重组目录"（路线 A），Phase 0～1、Phase 4 的成果照样有效。

---

## 4. 分阶段实施计划

周期按"一人 + AI 编码工具、延续当前提交节奏"估算；每个阶段的时间大头是跑测试与人工验收，不是写代码。

### Phase 0 · 安全网与基线（3～5 天）

目标：在动任何业务代码之前，让"改坏了"这件事能被自动发现。

- 新增 GitHub Actions：`typecheck` → `lint` → `test:api`（用 services 起 PostgreSQL）→ `test:web`（headless Chrome）→ `test:schema`。
- 给 `apps/api` 补 ESLint + Prettier（与 mobile 共用 root 配置）。
- 从现有 Controller 自动导出**端点清单**（方法、路径、capability、请求/响应示例），存为 `docs/api-inventory.md`。这是切片迁移时"迁完没有"的对照表。
- 对每个黑盒测试脚本加上可单独运行的入口（现在必须整套跑），并记录基线耗时。
- 清理：`Dockerfile.backup` 更名为 `Dockerfile.backup-worker`，compose 文件用途写进 README；`test-screenshots/` 是否归档由你决定；更新 CLAUDE.md 的"当前已实现模块"与重构期约束。

验收：PR 必须绿才能合并；端点清单与 `grep @Get/@Post` 数量一致（275）。

### Phase 1 · 共享契约与公共层（1～2 周）

目标：切断"后端改字段、前端靠眼看"的链路，为任何后续路线打地基。

- 建 `packages/contracts`：按域拆 `auth.ts` / `tasks.ts` / `polls.ts` …，每个端点一组 `{ params, body, query, response }` Zod schema。先从 `types.ts` 逆向出来，再用 `test:api` 的真实响应做 `safeParse` 校验，直到全部通过。
- 客户端 `lib/types.ts` 改为从 contracts 重导出，逐步删空。
- 建 `packages/shared`：迁入重复的日期、文本、幂等、错误码函数；两端替换调用。
- API 侧引入一个 Zod 校验管道（Nest 里可写 `ZodValidationPipe`），新代码不再用 class-validator；旧 DTO 暂不动。

验收：`types.ts` 行数归零；`grep -c "function isUniqueViolation"` 全仓为 1；contracts 对 275 个端点覆盖率 100%。

验收结果（2026-09-16）：三条都达成。`types.ts` 只剩 import + re-export，手写类型声明为 0；`isUniqueViolation` 全仓单一定义在 `packages/shared`；契约覆盖 275/275。

进度（2026-09-16）：**Phase 1 的契约部分已完成**。`packages/shared` 与 `packages/contracts` 已建立；9 个重复工具函数（42 处定义）已合并；24 个域 275 个端点全部有契约并在测试模式下自动校验响应（`docs/api-inventory.md` 的"契约"列全满）；客户端 `types.ts` 从 2,140 行手写类型降到 444 行纯 re-export，**已无任何手写类型声明**。剩余：Zod 校验管道替换 class-validator——请求侧契约守卫已先行接上并跑通（见下方第 10 条），管道与三个装饰器已落地、**polls 域已作为试点换完**（见下方第 11 条），剩 23 个域、约 160 个 DTO 类按域逐个搬。（`fingerprint` 已下沉，见下方第 9 条。）

本地全量验收（临时 PostgreSQL + `test:api` 725 个断言 + 三步 `docker build`）已绿；GitHub Actions 因账户层面原因（run 0 秒 `startup_failure`、0 job）尚未跑起来，恢复前以本地全量为准。

契约落地过程中记下的经验：

1. **契约会逼出没人写下来的事实。** `ReminderSource.status` 在 API 和客户端都声明为 `string`，"提醒挂在已结束投票上时 status 是 `closed`"这个事实哪里都没写，直到 `GET /reminders` 触发 `CONTRACT_VIOLATION`。修法是给 reminders 单独的状态枚举，不放宽 `/calendar`。以后遇到契约违规，先判断是"契约推窄了"还是"API 行为错了"，再决定改哪边。
2. **`--only` 用来迭代，验收必须全量。** 单跑 `--only travel` 是绿的，因为临时库里没有 polls 脚本留下的已关闭投票；只有全量串行跑、前面脚本的数据落进同一个库，那条才会被撞出来。
3. **改了 `packages/*` 必须重建再测。** `apps/api` 通过 workspace 链接吃的是 `packages/contracts/dist`，不跑 `node scripts/build-packages.mjs` 就是在拿旧 schema 测试，绿了也是假绿。同理，任何依赖 `scripts/` 或 `packages/` 的构建步骤（如 Dockerfile 的 postinstall）都要检查复制顺序。
4. **共享数据库的两个派发器必须把归属划清楚。** `agent-routines.mjs` 自己 `new` 了一个喂 stub 数据的 `AgentRoutineService`，而测试运行器起的 API 进程里还有一个每 100 毫秒轮询的同类服务；两者用 `FOR UPDATE SKIP LOCKED` 抢同一批到期例行任务，谁先拿到谁生成周报，API 拿到就按真实库数据生成、断言文案对不上——单跑必绿、全量约三分之一概率红。修法是测试在一个事务里"置为到期 + 派发"，事务持有行锁让轮询器跳过。Phase 3 抽 `jobs/` 调度层时新旧调度器会并存一段时间，同样的竞争会再出现，届时用同样的办法：要么锁行，要么让其中一个明确退出。
5. **响应形状取决于加载路径，不是实体定义。** 同一个实体在不同端点里长得不一样，目前撞到三种成因：
   - `find({ relations })` 显式指定关系：eager 递归在指定层之下只走一层，再深就缺席。同一条 `Dish → ingredients → ingredient` 链，`/menus` 的 relations 到 `items` 为止，`items.dish` 有、`dish.ingredients` 没有；`/smart-menu-plans` 的 relations 到 `candidates.dish` 为止，`dish.ingredients` 有、`ingredients[].ingredient` 没有——起点差一层，断点就差一层。写契约前先看 relations 写到哪一层，能吃到的 eager 只到下一层；
   - QueryBuilder：完全无视 eager，只有显式 join 的才有（`GET /finance/transactions` 嵌套的 `createdBy`）；
   - `save()` / `create()` 的返回值：不触发任何 eager，一层都没有（`POST /finance/accounts`、`POST /finance/categories` 的 `createdBy`）。这一种只出现在**写端点**上，把读端点核得再仔细也覆盖不到；而 `findOneBy` 再 `save` 的 PATCH 返回的是加载过的实体，形状又和 GET 一致。

   补契约时要按端点逐个看 Service 的加载方式，写端点专门看 `return save(...)` 还是 `return findOne(...)`；必要时拆成"记录版 / 完整版 / 新建版"多个 schema（`xxxRecordSchema` / `xxxSchema` / `createdXxxSchema`），不要用 `.loose()` 糊过去——`.loose()` 会让 `z.infer` 变成带索引签名的类型，客户端类型立刻失去意义。Phase 1 只改契约不改 API；到 Phase 3 迁移时应让写端点统一回传重新加载的实体，把这些分裂收掉。

   反过来，guests 与 travel 两个域所有响应都经 `profile*()` / `planResponse()` 逐字段挑选，不直接回传实体，42 个端点只有 8 种响应形状，加载路径完全不会漏到响应里——这是"写端点回传重新加载的实体 + presenter 挑字段"两条都做对的样子，Phase 3 新代码照这个写。

   两类端点还有一种共存形态：二进制流端点（`/asset-documents/:id/content`、`/memories/:memoryId/photos/:photoId/content`）用 `@Res()` 直接写响应，处理函数返回 undefined，契约 response 写成 `z.undefined()`，拦截器照常放行；签名 URL（`contentUrl` / `access.url`）是响应里唯一每次都变的字段，用正则约束形状而不是比对值。

6. **外部依赖不改变响应的键集。** media 域的 Plex / Emby / MoviePilot 连接器与 TMDB / 豆瓣 / Bangumi 元数据源在测试环境里全是空配置。空配置不会让响应少字段，只会让值变成 null、数组变空、`state` 落到 `not_configured` / `needs_credential` / `disabled` / `offline` 这几个字面量上；真正依赖外部服务才能完成的端点（`/media/library/sync`、`playback-webhook`、三个 `requests` 端点、海报）在空配置下直接抛 502，根本不产生成功响应。所以每个端点写一份 schema 就够，但可空字段要写满、枚举要把"没配置"那几个字面量也列上。代价是：全量测试只验证了"未配置"分支，接上真实连接器后要回来复核"已配置"分支的取值范围——contracts 里 media.ts 的文件头记了这一条。

7. **契约能覆盖形状，覆盖不了"这一行有没有被跑到"。** 契约只在端点被真实调用时才校验，所以覆盖率 275/275 说的是"都写了"，不是"都验过了"。实测下来有三类端点在全量测试里基本没被触发：需要外部服务的（media 的 sync / webhook / requests / 海报，全量里只出现过 1 次 502）、异常分支（各种 409/502 的错误路径）、以及内部凭据端点。给这些端点写契约仍然有价值——它把当时读代码得到的结论固定下来了——但"绿"不等于"验过"，回头改这些端点时不能指望契约兜底。想真正覆盖，得给黑盒脚本补对应的调用。

8. **`@Res()` 端点的契约是 `z.undefined()`，且这是准确的而非将就。** 二进制流（资产资料、回忆照片、媒体海报）和内部渠道 / MCP 这类自己写响应体的端点，处理函数不返回值，拦截器拿到的就是 `undefined`。把它们注册成 `z.undefined()` 而不是留空，是为了让清单里"没有契约"只表示"还没做"；代价是这些端点的实际 wire 格式不受契约保护，要覆盖得另写黑盒断言。同样地，agent 域里依赖后台 worker 时机的字段（run 状态、消息数组）被刻意放宽，换来的是不再偶发失败、失去的是对这些字段的约束——Phase 3 把调度抽成测试可控之后应该收回来。

9. **依赖 node: 的工具不进 `packages/shared`，进 `apps/api/src/common/`。** `fingerprint` 在仓库里有 5 份副本、`canonical` 有 3 份，原计划下沉到 `packages/shared`，但 shared 的定位是「纯 TypeScript、不依赖任何框架」，而这些函数要 `node:crypto`；客户端现在只依赖 `@family/contracts` 不依赖 shared，将来迁小程序时 shared 里混进 node: 会直接炸打包。想保持 shared 纯净又暴露子路径（`@family/shared/node`）则要求 `moduleResolution: node16`，改动面远超收益。所以落在 `apps/api/src/common/fingerprint.ts`——它本来就是 API 级公共代码的位置。

   下沉时发现这 5 份副本**不是同一个算法**：finance 与 agent 提案先递归按键名排序再序列化（键顺序无关），knowledge / memories / travel 直接序列化（**键顺序敏感**）。指纹会落库（`TravelOperation.requestFingerprint` 等）并在幂等键重放时比对，所以统一算法等于让历史行作废——跨部署复用同一把键会从「重放」变成 409。因此这次只做零行为变更的合并：`fingerprint()` 保留规范化版、`rawFingerprint()` 保留非规范化版，两者都在同一个文件里带注释共存，把分歧从五个模块里的隐性差异变成一处显性记录。统一成一种算法是一次独立的、有数据影响的变更，留给 Phase 3。media 的 webhook 去重（`canonicalizeWebhookValue`）排序用默认 `Array.sort()` 而非 `localeCompare`，对非 ASCII 键名结果不同，也没有并进来。

10. **请求侧也要有契约守卫，而且只在请求被 API 接受之后才判。** 换 Zod 管道之前要先回答一个问题：现有的 `params` / `query` / `body` 契约，比真实 API **窄**到什么程度？窄了就意味着换上管道那天会开始拒掉本来合法的请求。做法是加一个和响应侧对称的 `ContractsRequestInterceptor`（`apps/api/src/common/contracts.ts`），两个设计点都是刻意的：

    - **在 `tap` 里、处理函数成功返回之后才校验。** 黑盒脚本里有大量故意发非法载荷、断言 400/409 的用例，它们本来就不该符合契约；只有"API 已经接受了、契约却拒绝"才是要找的东西。契约比 API 宽只会漏过，不会拒真，那个方向留给后面的管道本身去收。
    - **违规抛 500 `CONTRACT_REQUEST_VIOLATION` 而不是 400。** 400 会被那些期待校验失败的用例当成预期结果吞掉，契约错了反而显得是绿的。

    另外请求数据要在 `tap` 里读、不能在拦截器前置阶段拍快照：multipart 的 body 由路由级 `FileInterceptor`（multer）解析，全局拦截器的前置阶段跑在它之前，那时 body 还是空的——第一版就是这么误报了两个上传端点。用 `CONTRACT_REQUEST_CHECK=report` 先跑一遍全量收集全部不一致，再切回 enforce，比红一次修一次快得多。

    第一次跑出 10 条、去重后 2 个真问题，都是响应侧盖不到的：
    - `GET /asset-documents/:id/content` 的 `signature` 契约写成 `[0-9a-f]{64}`，实际 `signDocumentAccess()` 是 `digest('base64url')`（43 字符）。同为 HMAC-SHA256，memories 的照片签名是 `digest('hex')`（64 字符）——两个域的签名编码不一样，逆向时按 memories 抄了过来。`assetDocumentAccessSchema.url` 为了兼容外链只能是 `z.string()`，约束不到，所以响应侧一直没发现。
    - `POST /agent/conversations/:id/messages` 的 `pageContext.entityType`，API 对未知值（recipe / task / menu / media）是**静默忽略**而不是 400（老客户端发新页面类型时不至于整条消息失败），契约却是五值枚举。修法是 `agentPageEntityType.optional().catch(undefined)`：类型上客户端仍只该发这五种，运行时收到别的就当没传——把"容忍"写进契约本身，而不是靠管道以后网开一面。

    收尾状态：report 与 enforce 各跑一遍全量，725 个断言全绿、请求与响应违规均为 0。**换管道的前置风险到此清零**，剩下的是把 165 个 class-validator DTO 换成契约 schema 的机械工作。

11. **换 Zod 管道不是删 DTO，是逐条搬约束。** `ZodValidationPipe` 加 `@ZodBody` / `@ZodQuery` / `@ZodParam` 三个装饰器（`apps/api/src/common/zod.ts`）能平替 class-validator，前提是三件事对得上：全局 `ValidationPipe` 的 `whitelist: true` 丢未声明字段——`z.object` 默认同样丢；`@IsOptional()` 同时放过 undefined 和 null——对应 `.nullish()`；参数类型换成 `z.infer` 的类型别名后 metatype 是 Object，全局管道直接放行，不会校验两遍。错误形状也不用改：`BadRequestException(string)` 出来仍是 `{ error: { code: 'Bad Request', message } }`。

    真正的工作量在**契约不等于 DTO** 的地方。polls 试点就撞到一处：`VoteDto.optionIds` 有 `@ArrayUnique()`，契约 `voteBody` 没有——直接换过去，重复选项 ID 会从 400 变成被接受。这个方向第 10 条的请求侧守卫**照不到**（它只看 API 已接受的请求，而这类请求 API 本来就拒绝），只能逐个 DTO 和契约对读。所以每换一个域，标准动作是：把 DTO 的每条装饰器和契约字段逐条对照 → 缺的补进契约（补在契约侧，不是在管道上开口子）→ 给黑盒脚本补上验证这条约束的断言，否则换完没人知道它还在不在。

    polls（8 端点、5 个 DTO 类）换完：新增 3 条断言（选项下限、未知枚举、重复选项 ID），全量 728 个断言全绿。剩下 23 个域按同样方式逐个来，`CreatePollDto` 这种被别的域 import 的 DTO 顺带换成契约类型（agent 提案里那处）。

12. **点「新对话」不该清空正在输入的草稿。** 69 个 Playwright 用例第一次在 CI 里真正跑完（51 通过 / 1 失败 / 21 跳过，9.8 分钟），唯一的红是 `agent-ui.spec.ts` 里发送按钮永远禁用、180 秒超时。失败截图显示输入框是**空的**（还在显示占位符）——`fill()` 敲进去的字被清掉了。

    根因是 `newConversation()` 里的 `setDraft('')` 和用户输入抢顺序。RN Web 的 `onPress` 经 PressResponder 派发，可能比紧随其后的一次输入晚一两拍：点击 → 输入落在草稿里 → 处理函数这才执行 `setDraft('')` → 字没了，而发送按钮的 `disabled` 看的正是 `!draft.trim()`，于是永远灰着。第一版我把 `setDraft('')` 从 `await` 之后提到了之前，那只是把窗口挪了个位置，没有消掉——CI 第二轮同一处仍然红（只是从 180 秒超时变成 10 秒快速失败，因为补了 `expect(send).toBeEnabled()`）。**正确的修法是根本不清**：草稿属于输入框，不属于某一次会话，发送成功后由 `submit()` 清才是草稿真正用完的时刻。真实用户点完新对话立刻打字会踩同一个坑。

    这一轮还暴露出另外两个同类问题，都是**用 `isVisible()`（不等待）决定走哪个分支**：
    - `agent-ui` 用它判断运行时是否可用来决定跑不跑核心断言，快的机器跳过、慢的机器走进来，两边结论不一样；
    - `ui-quality` 的 `openAuthenticatedHome()` 用它判断是否已登录，首页还没渲染完就读到 false，于是走进登录分支去找永远不会出现的「欢迎回家」，10 秒后失败。

    规则：凡是"按当前状态决定跑不跑"的分支，前面必须有一条真正会等的断言——等目标状态（`expect(input).toBeEditable()`），或者用 `locator.or()` 等两种状态之一出现，再读 `isVisible()` 分支。

    还有一个数据层面的坑：三个 Playwright project 共用同一个隔离库，`family-navigation` 里写死的任务备注文案在第二、第三个 project 跑到时会匹配到 2～3 个元素，strict mode 直接判失败。夹具文案一律带 `fixtureSuffix`，和任务标题一样。

13. **搬一页之前先读旧页面，别照着契约凭空做。** 新客户端的点菜页我是照 `packages/contracts` 直接写的：选中即写库、备注事后 PATCH、进度和点菜混在一页。用户一句「你这个点菜功能做的不太好」之后去读旧客户端才发现，模型从根上就不一样：

    - 旧客户端有一个**全局购物车**（`lib/cart.tsx`）：选菜只进车、**备注在点菜当下就写**、最后「提交菜单」一次性提交。而契约里 `orderItemInput.note` 本来就是给这一刻用的——**接口早就把设计意图写在那儿了，是我没看**。
    - **点菜和厨房是两页**（`order.tsx` 622 行 / `kitchen.tsx` 1259 行）。点菜的人不关心谁接单，做饭的人不需要再看一遍菜品网格。混在一页怎么排都别扭。
    - 厨房的动作表 `actionsFor` **既改状态也改认领人，并且随「是不是我接的」变化**：「我来做」和「换我来做」是两个不同的动作。我那套「下一步按钮」只改状态，点完还要再去下拉里选人。
    - 还有两个我压根不知道存在的功能：结束本餐后的**确认扣库**（`/menus/:id/inventory-preview` → `confirm-consumption`）和**一键生成购物清单**。

    契约保证的是「形状对得上」，不是「流程对得上」。旧代码是几十轮真实使用迭代出来的，里面每个看着奇怪的分支通常都有原因。**规则：每搬一页，先把旧页面读完再动手**，包括它引用的 store 和组件。

14. **`viewTransition` 属性只在数据路由下生效。** React Router v7 的 `<NavLink viewTransition>`
    要配 `createBrowserRouter`；我们用的是 `<BrowserRouter>` + `<Routes>`，加了属性不报错也不生效，
    实测 `startViewTransition` 调用次数是 0。自己包一层（`soft-link.tsx`：在 `startViewTransition`
    回调里 `flushSync(() => navigate(to))`）才真的动起来。**这类"加了属性但没效果"的东西，
    肉眼分辨不出来，必须用脚本数一下它到底被调用了没有**——本次三项（预取、过渡、落地路径）
    都是这么验的，第一次就抓到了这个假绿。

15. **新客户端接上 Playwright 的第一轮就抓到一个手机上点不到「保存」的 bug。** `<main>` 带
    `view-transition-name`，这会创建层叠上下文；`Dialog` 渲染在 `main` 里，它的 `z-50` 只在 main
    内部算数，而手机底部标签栏（`z-30`，在根上下文）就盖住了对话框底部的按钮——`elementFromPoint`
    命中的是标签栏的图标。桌面上标签栏不显示，肉眼验收一直没发现。修法是 `createPortal` 挂到
    `document.body`，以后任何浮层都别放在 `main` 里。另外两条工程上的规矩也是这轮定下的：
    登录接口本机 5 次/分钟限流，整套只在 `auth.setup.ts` 登录（爸爸两次 UI、妈妈一次 API），
    令牌写到 `e2e/.auth/sessions.json` 给用例复用，用例里再登录就会 429 连环失败；
    `run-web-tests.mjs --client web` 复用旧客户端那套随机库隔离，Vite 用
    `FAMILY_API_STRIP_PREFIX=1` 自己剥 `/api` 前缀直连隔离 API，48 个用例 48 秒。
16. **前端的状态模型要照后端的唯一键来建，不是照界面上的分区。** 访客邀请页有两处点菜：
    菜单里「我要这道」和菜单外自己填。界面上是两块，后端却是一条记录——`submitMealRequest`
    只按「邀请 + 日期 + 餐次」查，查到就改，`menuItemId` 原样留着。我按「有没有 menuItemId」
    把它们当成两拨，于是自由填的那格永远显示「还没提过」，一提交就把人刚点的菜顶掉。
    契约里的可空字段看着像分类标志，其实只是来源记录；**唯一键得去服务端那段代码里确认**。
    顺带一条：公开页要放在登录闸门之前（`App.tsx` 里按 pathname 提前返回），
    这一组请求全部 `auth: false`——带上家里人的令牌，401 会触发续期、失败再把访客踢去登录页。

17. **导航分组不能再从 URL 前缀反推，搜索也不能只枚举场景子项。** Phase F1 保留购物的
    `/house/shopping` 规范路径，但手机入口按计划归到「吃饭」；直接筛 `SCENES.eat`
    会漏购物、带上 shelf 菜谱，按 `/house` 高亮又会点亮错误的 tab。常驻顺序、手机菜单与
    路径映射应独立组织，共用同一份分段注册信息。原来的 ⌘K 只枚举 `SCENES`，漏了
    `PINNED` 的小管家与个人设置，还把管理员标记硬编码成 true；改导航时要同时验证
    **所有 shelf 可搜索、普通成员的可达性、旧书签和查询参数不丢失**，不能只看菜单变短了。


18. **启动台状态行只显示对家人有意义的状态，不显示开发者计数。** F2 原先从成功缓存
    派生「已载入 N 条」，虽避免了逐图块请求，却没有帮助家人判断要做什么。2026-09-21
    按验收反馈移除计数及缓存订阅；F5 有真实留意数据后才显示有意义的状态，没有就不渲染。
    导航意图预取保持不变，管理员查询仍按身份过滤；e2e 验证成功预取和回访缓存也不出现
    载入计数、冷开不逐域请求、回访不补发菜谱请求。


19. **保留页会同时渲染同一实体，唯一测试数据不能代替容器定位。** F2 首跑 CI 的
    `家庭成员可浏览核心页面且布局不横向溢出` 在任务备注断言匹配了日历保留页和任务行两处。
    备注已带随机后缀，根因不是跨 project 数据重名；限定到精确完成复选框所在任务行，
    不用 `.first()` 掩盖歧义。今后 CI 失败后未改代码重跑变绿，汇报必须单列根因或待查项，
    不能只写「重跑通过」。

20. **日期回归不能默认测试机已经过中午。** 2026-09-21 凌晨新端完整回归中，
    `资产维护：排计划、关联耗材、完成一次、加条资料再删掉` 双视口 POST complete 返回 400。
    trace 证实表单将本地当天按中午转成 `performedAt`，晚于真实当前时刻，API 正确拒绝。
    用例明确填昨天后验收，不放宽 201 断言。现有表单「上午不能以默认今天完成维护」
    属于资产页独立缺陷，待后续修复；本轮不顺手改业务逻辑。

21. **新增尾部迁移要同步维护旧迁移演练的回退入口。** F3 全量 API 首跑在
    `agent-proposal-groups.mjs --migration` 失败：旧脚本只认识订阅续费之前的迁移，
    新增模块表后仍断言最新迁移必须是提案组。`agent-profiles` / `agent-routines`
    也有同一假设；三处先回退本次模块迁移，再执行原断言和完整演练，不跳过旧测试。
    本次另加隔离库模块表 up → down → up 回归，且核对其他表的索引定义未变化。
    存在性夹具也必须尊重不可变流水：财务流水不能用 DELETE 清理；改用仅限 runner
    临时库的独立家庭，随隔离库删除，不关闭触发器或放松业务约束。


22. **完成状态与回答必须原子提交，读取也要有先后。** F3 回填 CI 的
    `agent.mjs:156` 并非无害偶发：detail 并行读 messages/runs，两个 READ COMMITTED
    快照可能跨过完成提交；写侧也把回答、completed、会话更新时间分开提交。
    限定修复为同一事务写三者，先读 runs 再读 messages（后者快照不早于前者），
    不靠 completed 后追加轮询掩盖问题。原幂等发送与首次 completed 响应断言支持
    `AGENT_CONSISTENCY_ITERATIONS=30`：2026-09-21 全量 API 实跑 30/30 通过，
    typecheck / lint 通过（43 条既有 warning）。本地首轮事务锁查询因 eager
    关联加入外连接而失败，禁用该锁查询的 eager 加载后重验通过；未扩大模块改动。


### Phase 2 · 试点切片与换栈决策门（1～2 周 + 2 周观察）

目标：用两个真实模块验证新栈，产出可比较的数据。

- 新建 `apps/api-next`（Hono + Drizzle + Zod）。Drizzle `introspect` 现有库生成 schema，**不新建迁移**，迁移仍由旧 API 的 TypeORM 负责直到最后。
- 实现 `polls`（8 端点）和 `tasks`（5 端点 + 与 `points` 的联动）。`tasks` 完成后发积分这条跨域调用，试点期通过 `packages/shared` 里的领域事件接口 + 直接调用旧 API 内部端点完成，验证切片边界方案。
- Caddy 按前缀把 `/polls*`、`/tasks*` 转到 api-next，其余仍到旧 API；JWT 密钥共用，两边都能验签。
- 用现有 `polls.mjs`、`tasks.mjs`、`points.mjs` 黑盒脚本跑通，Playwright `family-navigation.spec.ts` 跑通。
- 决策门记录：代码行数对比、测试耗时、一个新端点从需求到测试通过的 AI 往返次数、Docker 镜像体积与冷启动时间。

验收：两个模块在新栈上线运行两周无回滚；决策门文档 `docs/refactor-gate-review.md` 写明"继续 / 回退"。

### Phase 3 · 后端按域迁移（4～8 周，按依赖顺序）

顺序按耦合度从叶子到中心，每个域一个 PR 系列，迁完即切流量、删旧代码：

1. 叶子域：`dishes` `recipes` `shopping` `inventory` `calendar` `reminders` `notifications` `points`（其中 `reminders` 依赖 calendar/tasks，`notifications` 是被所有域调用的公共能力，需先抽成独立服务接口）。
2. 中层域：`menus` `smart-menu` `guests` `assets` `travel` `knowledge` `memories` `finance` `system`。
3. 复杂域：`media`（10 个子服务 + 3 个外部连接器 + 2 个 webhook + 后台对账），单独排 2～3 周，连接器 contract 测试直接复用。
4. `auth`：最后迁，因为两边都要验签；迁移时顺带把三个未导出的 Service 拆开。
5. `agent`：放在所有域之后，因为它依赖 13 个域的 Service。重建时改为只依赖 `packages/contracts` 与各域的 service 接口；28 个工具的名称与参数保持不变（现有黑盒脚本与页面上下文入口都依赖它们）。自研 loop 按 3.2 节落到 `packages/agent-core`，`HermesAgentRuntime` 与 `docker-compose.agent.yml` 在新 runtime 跑通 `agent*.mjs` 后删除。
6. 6 个轮询器统一收进一个 `jobs/` 调度层。单家庭部署不需要多实例，用一个进程内的调度器 + 数据库 `job_runs` 表记录即可，不引入 pg-boss；但接口要留成"可换成外部队列"的形状。
7. 最后一步：迁移体系从 TypeORM 切到 Drizzle（`drizzle-kit generate` 以当前库为基线生成初始迁移），删除 `apps/api`。

每域验收：对应黑盒脚本通过；端点清单勾掉；`household_id` 隔离测试（`household-isolation.mjs`）通过；旧模块目录删除。

### Phase 4 · 纯 Web 客户端重建（与 Phase 3 并行，4～8 周）

**已提前启动（2026-09-17）。** 原计划让 Phase 4 跟在 Phase 3 后面并行，实际是先开工了：
先尝试在现有 Expo / RN Web 上做视觉与布局整改，四轮方案都没被接受，最后确认问题不在配色
而在底子，于是直接建 `apps/web` 重写。**这一步之所以敢提前，是因为 Phase 1 的契约已经
275/275 全覆盖**——新客户端一个接口都不用逆向，`import type` 就拿到全部类型，客户端重建
和后端换栈（Phase 2/3）因此完全解耦，决策门可以照原计划慢慢走。

已落地：登录 / 今天 / 任务 / 点菜 / 厨房 / 菜谱六页，Vite 7 + React 19 + TanStack Query +
React Router + Tailwind 4，新旧客户端并存（旧的仍在 8088，新的在 5180）。

这一阶段最贵的教训写在下面第 13 条：**照契约凭空做页面等于把旧客户端几十轮迭代的经验全扔掉**，
每搬一页必须先读旧页面的实现。

**信息架构已定（2026-09-17）。** 24 个域收进五个「场景」——今天 / 吃饭 / 日程 / 家务 / 我的——
取名照家里人会说出口的话，不照后端模块名。第二层是场景内的分段（吃饭 = 点菜·厨房·菜谱·购物·库存·观影），
第三层一律用抽屉或对话框，不再开新页。**三层封顶**，旧客户端那种 22 个页面靠 `href: null` 藏起来、
只能从别处跳进去的情况不再出现。桌面是通栏 app bar（场景行 + 分段行），手机是底部五标签 + 可横滑的分段行。

分段表集中在 `apps/web/src/lib/nav.ts`：`ready: true` 的走新客户端，其余渲染「还在旧版」的桥接页，
一个按钮跳 8088。搬完一页只改这张表里的一行，导航、⌘K、预取三处自动跟着变。

**导航形态按端分开（1024px 为界）**：桌面是左侧固定竖栏，场景做手风琴、分段列在下面，
搜索在顶、成员与主题开关在底——就是后台控制台那一套，24 个功能一眼能扫完；
手机是底部五个标签，**点一下从那个标签的正上方弹出气泡菜单**（微信公众号底部菜单那种），
选完即关，不再用横向滚动的分段条（一行放不下六个，滑动才能看到后面的等于没有）。
气泡比整屏上推的面板轻，而且指向明确——从哪个标签冒出来一眼就知道；靠边的标签会把气泡顶到屏幕边，
所以位置要夹一下，小三角单独对准标签中点。

气泡的动效按 `.claude/skills/apple-design` 调过，几条值得记下来：
- **变换原点锚在触发它的标签上**，不是气泡自己的中心，所以是「从那个按钮里长出来」而不是「在那个位置放大」。
- **进出走同一条路**：出场是入场的镜像，缩回同一个原点。东西从哪儿来就得回哪儿去，凭空消失会让人不知道它去了哪。
  为此关闭要先播出场动画再卸载组件，不能直接 setState 为 null。
- **临界阻尼、不回弹**：手指只是点了一下，没有甩出去的动量；没有动量的回弹是假的。曲线用 `cubic-bezier(0.32,0.72,0,1)`。
- **按下就弹，不等抬手**：等 `click` 的那一下延迟，手感立刻就塌了。
- **材质而不是色块**：半透明 + 背景模糊，而且**模糊半径跟着缩放一起动**（materialize, don't just fade），
  像一层玻璃落下来而不是一张图淡入。注意模糊必须动在带 `backdrop-filter` 的那一层上，
  动在外层定位容器上是空转——这个错我犯了一次，肉眼几乎看不出来。
- **边缘渐隐只在真的滚得动时才加**：列表没超出还淡掉首尾，等于骗人说下面还有，所以用 `scrollHeight > clientHeight` 实测。
- 尊重 `prefers-reduced-transparency`：玻璃退化成实心，否则文字压在花背景上读不清。
代价是手机上多一次点击，换来的是任何时候都只有五个固定目标 + 一个弹出层，不用记东西藏在哪一屏。
菜单弹出时顺手把这一组的查询全预取掉，第二次点击基本是瞬时的。

宽屏页面一律排成两栏，主内容在左、时间线类信息在右（库存右边是批次与流水，购物右边钉住添加表单）——
侧栏之外只放一条 760px 的内容会把右边空掉一大半，那是没用上屏幕，不是留白。

切换手感做了三件事：① 导航包 `startViewTransition`，只给主体加 `view-transition-name: page`，
顶栏底栏不参与，所以切页是内容淡入而不是整屏闪；② 指针悬停/按下即预取该页第一屏的查询，
松手时缓存通常已经有了；③ ⌘K 命令面板，页面和菜品一起搜——功能过二十个以后，搜索比导航好用。
加载态一律用骨架屏而不是转圈：转圈只说「在等」，骨架屏还说清「等的是什么形状」，页面不会塌一下再弹回来。

目标：新建 `apps/web`，按页面逐个替换 Expo Web；类型全部来自 contracts；业务逻辑不进组件。

- 技术选型：Vite + React 19 + TypeScript；TanStack Router（类型化路由、按角色的路由树）+ TanStack Query（沿用现有心智）；样式用 Tailwind + 一个 headless 组件库（Base UI 或 Radix）自建"苹果风格"皮肤，延续 `.claude/skills/apple-design` 的设计约束；表单用 react-hook-form + contracts 里的 Zod schema 直接做校验；PWA 用 `vite-plugin-pwa`。
- 目录：`src/features/<domain>/{api.ts, hooks.ts, components/, pages/}`；`hooks.ts` 从 `lib/queries.ts` 对应域迁出，引入 **query key factory**（每域一个 `keys` 对象），mutation 失效按域声明，消灭 300 处手写 key。
- 迁移顺序按使用频率：登录 → 今天/首页 → 厨房/点菜/购物/库存 → 日历/任务/提醒/通知 → 小管家 → 投票/积分/财务 → 媒体 → 访客/资产/出行/知识/回忆 → 成员/备份/设置。每迁一个域，Caddy 把对应路径切到 `apps/web`，旧 Expo Web 保持可用直到最后。
- 巨石页拆法：`watchlist`、`assets`、`assistant`、`polls`、`travel`、`notifications` 每页拆成 page + 若干组件 + 一个表单 hook；几十个 `useState` 归并成 react-hook-form 或 `useReducer`。
- 路由按角色分 `/(consumer)` 与 `/(manager)` 两棵树，不再用 `href: null` 隐藏 22 个页面。
- 会话：改为同站 HttpOnly Cookie + CSRF 令牌，后端在 Phase 3 的 `auth` 迁移里配合；`localStorage` 只放主题、草稿等非敏感偏好。
- 轮询收敛：通知/agent 运行/提案/备份四路轮询合并为一个 SSE 通道（`/events`），后端在 Phase 3 顺带提供。
- 移动端体验：所有页面以 390px 视口为第一设计目标（延续现有 Playwright 双视口约定），安全区、下拉刷新、底部 Tab 都用 CSS 实现；原生触感用 `navigator.vibrate` 降级。

验收：单文件不超过 400 行（ESLint `max-lines`）；`invalidateQueries` 只出现在 key factory；Playwright 51 个用例改指向 `apps/web` 后全过；每个 feature 至少有一个组件级测试（Vitest + Testing Library）；`packages/core` 里没有任何 `import react`。

### Phase 5 · 收尾（3～5 天）

- 删除旧 `apps/api`、`apps/mobile`、`Dockerfile.*` 冗余、`docker-compose.agent.yml` 与 `deploy/hermes/`；compose 只保留 dev / prod 两份。
- 重写 README、CLAUDE.md、`docs/family-platform-plan.md` 第 5 章"技术架构"；验收文档不动。
- 备份/恢复脚本对新镜像做一次完整演练（`docs/backup-restore.md` 流程）。

---

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 双栈并行期跨域事务（任务完成→积分、维护完成→库存扣减、投票→片单）不一致 | 迁移顺序保证被调用方先迁；边界期通过共享 DB 事务不可行时，用幂等键 + 反向流水补偿（项目已有这套模式） |
| 需求持续新增（财务、订阅刚落地） | 新需求一律在新栈实现；旧栈只修 bug，写进 CLAUDE.md 约定 |
| 自研 agent loop 上线后工具契约或安全边界被无意改动 | 28 个工具名与参数 schema 放进 `packages/contracts`，`agent-tools.mjs` / `agent-page-context.mjs` 黑盒脚本进 CI 必跑；`propose_*` 不落库即执行的路径用单测锁死 |
| 纯 Web 后手机端体验退化（无原生触感、离线） | PWA 安装 + Service Worker 缓存壳与静态资源；390px 视口 Playwright 用例保留；触感用 `navigator.vibrate` 降级 |
| 黑盒测试太慢拖垮迭代 | Phase 0 支持单脚本运行；新栈补 Vitest 单测覆盖纯逻辑（状态机、日期、差额计算） |
| 一人项目精力分散 | 每个 Phase 都有独立可交付物，任何时候停下来都比现在好 |

---

## 5.5 复盘与后续规划（2026-09-17）

### 现在在哪

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| Phase 0 安全网 | ✅ 完成 | 黑盒 734 断言、Playwright 52 用例、CI 四个 job 全绿（含镜像构建） |
| Phase 1 契约 | ✅ 契约 275/275；⏸ Zod 迁移 3/23 域 | 契约与请求守卫已经把后端锁住了；DTO 迁移在客户端重建开始后停了 |
| Phase 2 换栈决策门 | ⏸ 未开 | 见下面「建议暂缓」 |
| Phase 3 后端按域迁移 | ⏸ 未开 | 依赖 Phase 2 |
| Phase 4 客户端重建 | 🚧 10 页 / 24 分段 | 框架已定型（五场景、Page/Panel、桌面侧栏 + 手机气泡菜单、⌘K、过渡、预取），吃饭 5/6、日程 4/5、家务 0/9、我的 0/3 |

分支 `refactor/phase-0-safety-net` 领先 main 51 个提交，新客户端 7.7k 行。

### 看到的问题（按严重程度）

1. **新客户端没有回归保护。** CI 的 Playwright 全部指向 `apps/mobile`——它保护的是马上要删的代码，
   而每一页新客户端都只靠我临时写的脚本验一次。这是眼下最大的结构性风险：再往下搬十几页，
   任何一次改共享组件（Page/Panel/Dialog/SoftLink）都可能悄悄弄坏已经搬好的页面。
   CI 也不 build `apps/web`，lint 不覆盖它。
2. **两套客户端并存，家里人不知道该用哪个。** 桥接页能跳旧版，但每个没搬的功能都是一次 8088 的跳转；
   越拖越久，切换那天的落差越大。
3. **剩下的 14 个分段比已经搬的重。** 财务、资产、知识库、观影在旧客户端里都是 1000+ 行的页面，
   带审批、附件、版本历史；不能按前面十页的速度估。
4. **Zod 迁移停了，但它不阻塞任何用户可见的东西。** 它是给 Phase 3 铺路的；Phase 3 本身值不值得做，
   现在应该重新问。
5. **旧客户端有一条 flaky 用例**（`family-navigation` 首页断言零 console 错误，偶发一次 401 后自愈）。
   一次红一次绿，没改旧客户端代码。先记着，稳定复现再查时序，不放宽断言。
6. 演示库里混着我手工造的测试数据（9 条事件、5 条库存、批次、购物项、两条划菜通知）；
   深色模式和真机触控都还没验过。

### 建议：Phase 2/3 暂缓，先把 Phase 4 做完并切换

用户这一轮所有的痛点都在客户端：配色、布局、导航、切换手感、空白。后端一次也没被抱怨过。
契约 + 请求守卫 + 黑盒测试已经把 NestJS 这一层锁死了，换成 Hono/Drizzle 的收益（启动快、代码少）
对一个家庭应用不明显，风险却是实打实的回归。所以：**换栈的决策门推到客户端切换之后再开**；
Zod 迁移改成「顺路做」——每搬一个域的客户端页面，顺手把那个域的 DTO 迁掉，因为刚读过它。

### 后续顺序

> 逐任务的执行细节（读什么、改什么、验收标准、提交信息、进度表）在 `docs/execution-plan.md`，交给执行 agent 时以那份为准。

**A. 先补安全网（1～2 天，做完再搬新页）**
- Playwright 新增 `web` 项目指向 5180：登录 + 每个已搬页面冒烟（渲染、零 pageerror、不横向溢出）
  + 五条关键写路径（点菜提交、任务打勾、日历增删、提醒建/取消、消息标已读）。复用现有随机库隔离。
- CI：`apps/web` 加 build，lint 覆盖 web。
- 演示数据脚本化：`seed.js` 加 `--demo` 选项造一套像样的家庭数据，别再手工 curl。

**B. 搬完剩下 14 个分段（按使用频率，估 1～2 周）**
投票 → 积分 → 成员 → 个人 → 问问小管家 → 访客 → 资产 → 财务 → 知识库 → 回忆 → 出行 → 备份 → 家庭动态 → 观影。
每页规矩不变：先读旧页面，再动手；搬完只改 `nav.ts` 一行。观影排最后是因为它牵 TMDB/Plex/MoviePilot 三方，最重。

**C. 切换与下线（B 做完后）**
- Caddy 默认入口切到新客户端，旧客户端挂到 `/legacy` 保留两周。
- 家里人试用两周，问题记进 `docs/manual-acceptance.md`。
- 删 `apps/mobile`、`Dockerfile.web`（旧）、旧 Playwright 套件；README/CLAUDE.md 改写。

**D. 之后**
- 用户提的「AI agent 自动从网上找菜谱」：套现有 agent 提案 → 确认执行机制，切换完再做。
- 重开 Phase 2 决策门：拿切换后的真实运行数据（启动时间、内存、改一个域要动几个文件）再判断换不换栈。

## 6. 已确认的决策与执行建议

已确认（2026-09-15）：

1. **客户端走纯 Web**，后续再迁 App / 小程序 → 见 3.2 节客户端与 Phase 4。
2. **智能体换成自研 agent loop** → 见 3.2 节智能体与 Phase 3 第 5 步。

其余事项的建议：

3. **三层不要同时动。** 现在决定要换的已经有两层（客户端、智能体），后端再换栈就是三层同时重建，任何回归都无法定位是谁的问题。建议顺序：Phase 0～1（安全网 + 契约）→ Phase 4 Web 客户端（用户最先看到收益，且只依赖 HTTP 契约不依赖后端实现）→ 自研 agent loop（依赖新的 SSE 通道）→ 后端换栈**最后且可选**。如果 Phase 2 试点数据不够有说服力，就保留 NestJS 只做目录重组（路线 A），把精力留给前两项。
4. **并行期**：单家庭部署多跑一个容器没有实际压力；真正的成本是 Caddy 路由表要随迁移进度改。把路由规则放进仓库（`deploy/Caddyfile` 已在），每次切流量都是一个 PR，可回滚。
5. **数据规模按单家庭设计，但不要写死。** 保留 `household_id` 隔离与行锁（成本几乎为零，且已有隔离测试），去掉多实例调度、分布式锁这类为不存在的规模准备的东西。
6. **给 AI 编码工具的工作方式约束**（写进 CLAUDE.md）：每个 PR 只碰一个域；新代码禁止 import 旧模块的 Service；任何业务规则必须能在 `packages/core` 里被单测覆盖；`packages/contracts` 的改动必须同时更新对应黑盒脚本。这四条比任何框架选择都更能决定重建后的代码会不会再次长成现在的样子。
7. **不要急着删旧代码**。旧 Expo 端与 Hermes 在新实现跑通对应 Playwright / `agent*.mjs` 之前一直保留，删除放在 Phase 5 一次完成。

---

## 附：复核命令

```bash
# 端点总数
grep -rhoE "@(Get|Post|Put|Patch|Delete)\(" apps/api/src | sort | uniq -c
# 实体数
grep -c "^export class" apps/api/src/entities/index.ts
# 后端重复函数
grep -rhoE "^(export )?function [a-zA-Z0-9_]+" --include=*.ts apps/api/src | sed 's/export //' | sort | uniq -c | sort -rn | awk '$1>1'
# 客户端 hook 数与失效次数
grep -c "^export function use" apps/mobile/src/lib/queries.ts
grep -c "invalidateQueries" apps/mobile/src/lib/queries.ts
# 最大文件
find apps -path '*/node_modules' -prune -o \( -name '*.ts' -o -name '*.tsx' \) -print | xargs wc -l | sort -rn | head -20
```
