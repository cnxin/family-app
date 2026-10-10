# 小管家 · J4 agent 重建设计稿（等 King 拍板）

> 2026-10-09 起草。依据 `architecture.md` §2.2 第 2 档、§3.3、§4 J4 一行、§6 第 4 条（云端档 BYOK、默认关、脱敏、每日上限）、§9 J1b 的内核机制；`refactor-plan.md` §3.2「智能体」一节（自研 loop 的形态、`packages/agent-core`、SSE 替代轮询、FakeAgentRuntime 保留）。
> 定位：**J4 只重建「第 2 档」的执行层和配置层**，不做第 0 档（J3）、不做第 1 档（J5）。做完后：App 里能填 key、选模型；助理用自家 loop 调模型、按 manifest 生成工具；Hermes 下线；K2 截图记账随后可做。
> **King 拍板（2026-10-09）**：§2 十件全部按「建议」栏执行。
> 排期：试用期间做（只动后端与小管家设置页，家里人天天用的页面零 diff）。XL，约 3 周，分 7 笔。

---

## 0. 现状（2026-10-09，main `016dacf`）

| 现状 | 说明 |
| --- | --- |
| `AgentRuntime { health, chat, cancel }` | `agent.types.ts`；两个实现 `FakeAgentRuntime`（黑盒用）、`HermesAgentRuntime`（HTTP 调 `docker-compose.agent.yml` 里的 Hermes 容器） |
| 循环在 Hermes 里 | 我们只给 `message + history + allowedTools`，拿回 `content`；工具调用由 Hermes 经 MCP（`agent-mcp.controller.ts`，`/internal/agent/mcp`）回调我们的 `AgentToolsService` |
| 模型 | Hermes 配置 `longcat-2.0-free` / `opencode-zen`（免费模型），App 里**没有任何模型 / key 配置入口** |
| 工具 | 30 个：23 读 + 7 `propose_*`；归属已全部在 manifest / `core-assistant.ts`（J1.6、J1b.5）；但**名单仍是手写字面量**（`AGENT_READ_TOOLS` / `AGENT_PROPOSAL_TOOLS`），MCP 的 `propose_plan` 入参联合也是手写（check-plugins 盯着一致） |
| 提案 | `AgentProposalsService.executeWithinTransaction`：模型只能提案，成员确认才执行；提案组 `propose_plan` |
| 会话 / 运行 / 事件 | `agent_conversations`、`agent_runs`、`agent_tool_events` 已有；~~前端 2 秒轮询 run 状态~~（起草时写错：H2 起对话页已靠 `/events` 的 `changed` 刷新，没有按 run 轮询，J4.4 核实） |
| 外围 | 记忆（2 个工具 + 候选 / 确认）、例行任务（`nightly_digest`、`weekly_report`，**确定性汇总拼正文，不经模型、不开 run**；起草时写的「用 runtime.chat 生成」不对，J4.5 核实后更正）、外部渠道（`/internal/agent/channels`，配对码） |
| J2 已落的开关 | `agent_settings`：`enabled`（= 第 2 档）、`tier2DailyLimit`（50）、`tier2Redact`（true）、`captureUtterances`、`assistant_utterances` 表 |
| agent 目录仍直接 import 各插件 Service | §9.5 点名留给 J4 |

---

## 1. 目标形态

```
前端 ⌘K / 小管家页 / 外部渠道 / 例行任务
        │ message
        ▼
  AgentService（会话、权限、每日上限、原话落表、脱敏）
        │
        ▼
  NativeAgentRuntime（第三个 AgentRuntime 实现）
        │ runLoop(model, tools, input) → AsyncIterable<AgentEvent>
        ▼
  packages/agent-core（纯 TS，无 Nest、无 HTTP）
   ├─ ModelProvider：OpenAI 兼容 chat/completions（含 tool_calls、流式、images）
   ├─ ToolRegistry：每个工具 = zod 参数 + 描述 + execute(ctx, args)
   ├─ loop：步数 / 工具调用次数 / token 上限；untrustedContent 围栏
   └─ 事件：text_delta / tool_call / tool_result / proposal / done / error
        │
        ▼
  工具实现：由 manifest 的 queries / actions(propose) 生成 + core-assistant 7 个
  读工具 → 门面（§9）直接执行；propose_* → 只落 AgentActionProposal
```

**三条不变量**（写进单测）：
1. 写操作只能以提案形式出现，确认前数据库没有任何业务写入。
2. 页面上下文、检索结果、记忆内容进入提示词时一律标 `untrustedContent` 并加围栏；工具描述里不含家庭数据。
3. 循环上限是参数，不是散落常量；超限 → `error` 事件 + run 标 `failed`，不重试。

---

## 2. 要 King 拍板的 10 件事（建议在括号里）

| # | 事 | 选项 | 建议 |
| --- | --- | --- | --- |
| 1 | 循环怎么写 | A 自研约 200 行（只依赖 fetch + zod）；B 引 Vercel AI SDK | **A**。工具 schema 已是 zod、协议只认 OpenAI 兼容，AI SDK 的 provider 抽象和依赖树是多余的；流式与 tool_calls 的解析自己写并用录制响应回放做单测 |
| 2 | 预置服务商 | 下拉：DeepSeek、通义千问（百炼）、智谱、Kimi（月之暗面）、OpenAI 兼容自定义（填 baseUrl）；每家预填 baseUrl 与推荐模型名 | **做下拉 + 自定义**。King 家先用哪家由 King 定（现在 Hermes 用的 LongCat 免费模型也能作为「自定义」填进去） |
| 3 | key 存哪 | A 数据库加密列（`agent.crypto.ts` 已有对称加密，渠道密钥在用）；B 环境变量 | **A**：开源用户在设置页填，不碰服务器文件；加密密钥沿用现有 `AGENT_SECRET` |
| 4 | 脱敏粒度（`tier2Redact` 开时） | 成员真名 → 称呼（爸爸 / 妈妈 / 本人设定的称呼）；访客名 → 「访客N」（第四批收尾补，N 按建档先后，同名成员优先）；手机号、车牌、身份证样式、银行卡样式 → 打码；金额 **保留**（否则财务问题答不了）；地址 / 位置名保留 | 按左栏做，开关只有开 / 关；「金额变区间」不做 |
| 5 | 每日上限计什么 | A 按 run 次数；B 按 token | **A**，默认 50（J2 已存）；超限返回固定文案「今天小管家的云端额度用完了，明天再问」，同时写审计 |
| 6 | 试用期谁能用第 2 档 | 家庭级 `enabled` 之外加 `tier2Scope: 'admins' \| 'all'`，默认 `admins` | **加**。9-27 拍板试用期助理对家里人关闭；加这个字段后 King 自己能在演示栈上真用、真调，家里人看不到 |
| 7 | 流式输出 | SSE `/agent/runs/:id/events` 替代 2 秒轮询（refactor-plan 3.2 已写） | **做**，`/events` 通道 H2 已在，复用其鉴权与心跳；前端只改小管家页的消息区 |
| 8 | Hermes 怎么下线 | 新 runtime 过全部 `agent*.mjs` 黑盒 + King 在演示栈实测一周后：删 `HermesAgentRuntime`、`docker-compose.agent.yml` 的 hermes 服务、`deploy/hermes/`、`hermes-config-contract.mjs`；`runtimeKind` 枚举改 `'fake' \| 'native'`，迁移把现有 `'hermes'` 改成 `'native'` | 按此做，下线是最后一笔（J4.6），可单独推迟 |
| 9 | 视觉输入 | `ModelProvider` 接口从第一天就带 `images` 入参（OpenAI 兼容的 image_url），本阶段只在单测里用 | **带上**，K2 直接用，不用再改接口 |
| 10 | 第 0 / 1 档的位置 | J4 里只放一个路由桩：`tier0` 未实现 → 所有输入直接走第 2 档（开着时）或 ⌘K 候选（关着时） | 按 §2.3 的路由图预留接口，J3 / J5 各自填 |

---

## 3. 数据与配置

> 按实际落地的列名修正（J4.3，迁移 `AddAgentCloudProvider1785234500000`；运行方式 `'native'` 在 J4.2 的 `AddNativeAgentRuntime1785234400000`）。

- `agent_settings` 加列：`providerKind`（varchar(16)，deepseek / qwen / zhipu / kimi / custom，可空）、`providerBaseUrl`（varchar(300)）、`providerModel`（varchar(120)）、`providerKeyEncrypted`（text，存 `v1:<nonce>:<密文>`：与对话内容同一把 `AGENT_DATA_KEY` 的 AES-256-GCM，附加数据绑家庭；接口只回 `providerKeyConfigured` 与 `providerKeyLast4`）、`providerCheckedAt`（timestamptz）/ `providerCheckOk`（bool，默认 false；改了服务商、地址、模型或 key 就清掉）、`tier2Scope`（varchar(8)，admins / all，默认 admins）。老家庭升级后新列为空、`tier2Scope = admins`，`runtimeKind` 不变。
- `agent_runs` 加列：`tier`（smallint，可空；云端运行方式 hermes / native 的 run 记 2，本地确定性助理 fake 留空）、`redacted`（bool，默认 false；native 且 `tier2Redact` 开时为 true）。`inputTokens` / `outputTokens` 原来就有，native 累加各步用量写进去。
- 每日用量：不建表，在 `agent_runs` 上按上海时区当天 `count(tier = 2)`；超过 `tier2DailyLimit` 的那次记成一条不执行的 failed run（`errorCode = AGENT_DAILY_LIMIT`，`tier` 留空不占额度），兼作审计；用量报告的「云端档」一段按天数它们。
- 工具名单：`AGENT_READ_TOOLS` / `AGENT_PROPOSAL_TOOLS` 改为从 manifest + `core-assistant.ts` 生成；30 个现名全部保留（和规则不同的在 manifest 写 `toolName`，`toolAliases` 留给以后改名），`check-plugins` 的手写联合断言随之删掉（J4.1）。

## 4. 分笔（叠加分支，每笔一个 PR，规矩照旧）

| 笔 | 内容 | 量 | 提交 | 合并 | CI |
| --- | --- | --- | --- | --- | --- |
| J4.0 | `packages/agent-core`：`ModelProvider`（OpenAI 兼容，流式 + tool_calls + images）、`ToolRegistry`、`runLoop`、上限与围栏；**单测用录制的模型响应回放**（含：一次工具调用、连续三次、工具报错、超步数、流式分片、恶意上下文注入围栏） | L | `d72d586` | `4ca3405` | 分支 #37824739021、main #37828165900，均一次过 |
| J4.1 | 工具从 manifest 生成：`queries` → 读工具（走门面）、`actions(propose)` → `propose_*`；core-assistant 7 个；30 个旧名别名；agent 目录对插件 Service 的直接 import 全部改走门面（§9.5 那条）；`check-plugins` 断言「工具集合 == manifest 推导」 | M | `057baa8` | `cb9033f` | 分支 #37828855005、main #37832187109，均一次过 |
| J4.2 | `NativeAgentRuntime` + `AgentService` 接线：会话 / 历史 / 允许的工具（按家庭模块开关裁剪，§3.3）/ 提案落库 / 事件写 `agent_tool_events`；`runtimeKind: 'native'`；`FakeAgentRuntime` 保留；全部 `agent*.mjs` 黑盒在 native 下通过（用 Fake provider 回放，不打真模型） | L | `6ec81c8` | `beaed76` | 分支 #37873196748、main #37874814358，均一次过 |
| J4.3 | 云端档配置：`agent_settings` 新列 + 加密存 key；设置页「云端助理」分段加服务商下拉、模型、key（只显示末 4 位）、「测一下」（发一条 1 token 请求）、`tier2Scope`；每日上限与脱敏接到 AgentService；脱敏单测（真名 / 手机 / 车牌 / 卡号样式） | M | `25bf6a6` | `1cd65e0` | 分支 #37874906822、main #37876521864，均一次过 |
| J4.4 | SSE：~~`/agent/runs/:id/events`~~ 按 H2 的命名规则复用 `/events`，事件名 `agent.run`（载荷 `{runId, conversationId, seq, type, …}`，type = text_delta / tool_call / tool_result / proposal / usage / error / done，只有增量与状态，只推给发起成员；契约 `contracts/src/events.ts`）；native 推全过程，fake / Hermes 只推 done；小管家页流式气泡、proposal / done 时重取会话详情，`/events` 断开且有回答在跑时退回 2 秒轮询（H2 起本来就没有按 run 轮询，`GET /agent/runs/*` 不存在）；标题下按运行方式写「本地家庭摘要 / 旧版云端 / 小管家自带 · 服务商」；取消走原 `cancel` | M | `7185cd2` | `540cab6` | 分支 #37958657014、main #37961976806，均一次过 |
| J4.5 | 外围回归：外部渠道（配对、收发，tier2Scope 按消息所属成员判）、记忆工具（回放录制「记住 / 召回」）在 native 循环里跑通；例行任务在 native + 额度用完时照常——它们是确定性汇总、不经模型，**不受 scope、不受也不计入每日上限**（与指令「受每日上限影响且计入」不同，按实际行为断言）；每日上限计数与插入同事务、锁 `agent_settings` 行（10 并发只放行上限数，去锁反向验证放行 9 个）；用量报告云端段加「流式 run 占比」；deploy-c2 §4 ① 改为对仓库最后一个迁移；family-guide 不动 | S～M | `62de161`、`79549a0` | `764368e` | 分支 #37960811328（`62de161` 那次被新推送取消）、main #37965340669，均一次过 |
| J4.6 | Hermes 下线（拍板 #8 的条件满足后）：删 runtime / compose / deploy/hermes / 契约脚本，迁移 `'hermes'` → `'native'`，升级脚本与 deploy-c2 相应改 | S | | | |

验收总则：每笔前后 `agent*.mjs` 黑盒全过；J4.2 起用「录制回放」的 Fake provider 做确定性测试，真模型只在 J4.3 的「测一下」和 King 实测时碰；演示栈升级只在升级窗口，且 `tier2Scope=admins` 保证家里人无感。

## 5. 风险

| 风险 | 对策 |
| --- | --- |
| 不同服务商的 OpenAI 兼容实现有差异（tool_calls 格式、流式分片、`finish_reason`） | provider 层做兼容表；J4.0 的回放用例至少录 DeepSeek、通义两家真实响应 |
| 家庭数据出网 | 默认关、`tier2Scope=admins`、脱敏、每日上限、审计（run 记 `redacted` 与 token 数）；提示词里不放成员列表之外的个人字段 |
| 模型把工具描述当指令 / 上下文注入 | 围栏 + 写操作只提案 + 单测里的注入用例 |
| Hermes 下线后渠道配对等依赖它的东西断掉 | J4.5 先回归，J4.6 才删；渠道那条路径本来就在我们 API 里，不经 Hermes |
| 成本失控 | 每日上限 + 单次 run 的步数 / token 上限 + 「测一下」只发 1 token |
| 模型地址可填局域网（管理员） | 有意放开：要支持家里自己跑的本地模型（J5 第 1 档同一接口）。只有能管理小管家的人（`manage_agent`）能改；API 只请求这一个地址（「测一下」和对话），不跟随用户输入的其它 URL；key 加密存、只回末 4 位；每次 run 记 `tier` / `redacted` / token 数可审计 |

## 6. 与其它计划的关系

- K2 截图记账：J4.3 之后即可做（provider 带 images，key 已有）。
- J3 第 0 档：等原话门槛；J4 的路由桩给它留位。
- J5 第 1 档：`ModelProvider` 同一接口指向 Ollama 的 OpenAI 兼容端点即可，J5 只做「置信度低时问本地模型选意图」。
