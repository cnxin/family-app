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

进度（2026-09-16）：`packages/shared` 与 `packages/contracts` 已建立；9 个重复工具函数（42 处定义）已合并；tasks / polls / calendar / reminders / points / dishes / recipes / shopping / inventory / menus / notifications / activities / auth / finance / smart-menu / upload / guests / travel 共 18 个域 161 个端点有契约并在测试模式下自动校验响应；`docs/api-inventory.md` 增加"契约"列跟踪覆盖率；客户端 `types.ts` 已对这十八个域改为 re-export（从 2,140 行降到约 1,210 行）。剩余：assets / media / knowledge / memories / system / agent 6 个域（114 个端点）的契约、`fingerprint` 等依赖 node:crypto 的工具、Zod 校验管道替换 class-validator。

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
