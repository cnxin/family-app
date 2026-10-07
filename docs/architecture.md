# 小管家 · 内核 / 插件 / 助理三层架构：可行性分析与方案（Phase J）

> 放进仓库 `docs/architecture.md`。给 King 决策，也给执行 agent 做盘点的依据。
> 起因（2026-09-30）：King 重新确认产品核心——「小管家」应是核心框架，点菜、智能家居、地图、观影等像插件；助理希望内置一个不依赖云端 API 就能回答基础问题的智能体，高级能力走云端 API。
> 结论先行：**插件化——做，且大半已具备；助理——做成三档路由，第 0 档是规则引擎而不是模型；两者都不挡在家庭试用前面。**

---

## 0. 三个问题，三个答案

| 问题 | 答案 | 一句理由 |
| --- | --- | --- |
| 各功能是不是应该像插件？ | 是 | 这一个月做的导航分层、模块开关、事件域、留意 provider、⌘K 动作表、agent 工具表，本质上就是七处分散的「插件登记」，缺的只是收成一份 manifest |
| 小管家的核心是不是智能体？ | 不是 | 家里人的日常操作要求零延迟、零成本、确定性、弱网可用；LLM 一项都做不到。智能体是可关掉的一层，现在 `enabled=false` 而 App 运转良好就是证据 |
| 能不能内置一个不依赖云端的助理？ | 能，但不是「本地跑个模型」 | 家里人的句子高度重复，规则引擎 + 槽位抽取能覆盖大多数；本地小模型只做「听懂」的兜底；云端只做推理、摘要、多步 |

---

## 1. 现状盘点（依据 refactor-plan / ia-plan / pre-trial-plan）

### 1.1 已经具备的「插件接口」

| 接口 | 在哪 | 谁在消费 |
| --- | --- | --- |
| 导航分段与三层（core / shelf / settings）、glyph | `apps/web/src/lib/nav.ts`，key 枚举在 `packages/contracts`（F1、F4） | 侧栏、底栏、家里页 |
| 模块 hasData / override（空域隐身） | `GET /system/modules`、`household_module_overrides`（F3、F4） | 家里页、侧栏、留意抑制 |
| 事件域（`changed.domains`）与「路由前缀 → 域」映射表 | `packages/contracts/src/events.ts`，CI 断言全覆盖（H2） | 客户端失效、留意刷新、HA 状态推送 |
| 留意规则 provider | `apps/api/src/today/`，每条规则一个 provider，服务端按家庭日期计算（F5、E5） | 今天页「需要留意」、家里页状态行 |
| ⌘K 动作注册表（含深链约定） | `apps/web/src/lib/actions.ts`（F6） | ⌘K、今天页 / 家里页搜索条 |
| agent 工具注册（21 读 + 7 `propose_*` + 2 记忆，J0 已核实） | 名单在 `packages/contracts/src/agent.ts` 与 `apps/api/src/agent/agent.types.ts` 各一份；MCP 注册在 `agent-mcp.controller.ts`；执行在 `agent-tools.service.ts`（1,324 行单类） | Hermes 经 MCP 调用（当前关闭） |
| 家庭设置行、用量统计 | F7 设置页、`usage-report.mjs` | 管理员、C2 三档分类 |

**判断**：七处登记彼此独立、各自手写，加一个域要改七个地方（I1 加「位置」时正是如此：nav、modules、events、actions、agent 工具、设置、usage-report 各一笔）。这是插件化要解决的**唯一**问题——不是缺能力，是缺一份统一的清单。

### 1.2 智能体现状

- 模块 `agent`：39 个端点、17 个文件 7,949 行，全项目耦合中心（依赖 14 个域的 Service）。
- 运行时：`AgentRuntime { health, chat, cancel }` 接口，两个实现 `FakeAgentRuntime` / `HermesAgentRuntime`（Hermes 镜像经 MCP 调 `/internal/agent/mcp`）。
- 安全模型已成型且正确：读工具直接执行；写只能 `propose_*` 落提案，人确认才执行；页面上下文与检索内容标 `untrustedContent`。
- 工具数（J0 核实）：读 21 + `propose_*` 7 = 28，另有记忆工具 2 个（`recall_preferences`、`remember_preference`），MCP 共注册 30 个；名字全部手写字面量，不是拼出来的。详见 §8.2。
- refactor-plan 已定：**Hermes 换成自研 loop**，工具注册表抽到 `packages/agent-core` 的 `ToolRegistry`，28 个工具名与参数保持不变。
- 附属能力：个人记忆（候选 / 确认 / 共享 / 纠正 / 遗忘）、成员画像、例行任务与周报、外部渠道配对、保留期清理。
- 生产与演示栈 `enabled=false`，从未被家里人使用。

**判断**：重建 agent 是既定项，缺的是目标形态。本方案给出的形态——「manifest 的消费者 + 三档路由」——正好回答它。

---

## 2. 助理三档的可行性分析

### 2.1 家里人会说什么

按现有 15 个域的动作和查询，家里人的话可以分四类。比例是估计，**试用期间用 ⌘K 输入和微信群原话校准**。

| 类 | 例子 | 占比估计 | 需要的能力 |
| --- | --- | --- | --- |
| A 单动作 | 记一笔 38 买菜 / 把牙膏加进清单 / 扫地机开始 / 周六张叔来吃饭 | 60% | 意图 + 槽位（金额、物品、时间、人、房间） |
| B 单查询 | 今天吃什么 / 明天有什么安排 / 牙膏放哪了 / 滤芯还能用多久 | 25% | 意图 + 少量槽位，读一个插件 |
| C 跨插件推理 | 这个月吃饭花得比上月多吗 / 周末来客人菜单和采购一起安排 | 10% | 读多个插件、算、组织语言 |
| D 闲聊与开放问题 | 番茄怎么保存 / 帮我想个周末活动 | 5% | 通用知识 |

A + B 是「基础功能」，C + D 是「高级功能」。**A + B 不需要模型**，这是整个方案成立的前提。

### 2.2 三档各自的可行性

**第 0 档 · 规则引擎（确定性意图 + 槽位）**

- 做法：每个插件在 manifest 里声明动作 / 查询，每条带若干中文模板与槽位类型；引擎做分词无关的模糊匹配（编辑距离 + 同义词表）、槽位归一化（中文数字、金额单位、相对日期「后天 / 下周六 / 月底」、餐次、家庭成员名与位置名从数据库取）、置信度打分。
- 可行性：**高**。词表封闭（动作有限、槽位类型有限、成员 / 位置 / 设备名从库里来），这是规则引擎最擅长的场景；难点全在中文口语归一化，是细活不是难题，`packages/shared/src/date.ts` 已经把日期部分做了一半。
- 成本与延迟：0 / < 50 ms，在 NAS 上跑，开源用户零配置。
- 风险：模板覆盖不全导致「听不懂」；对策是听不懂时退回 ⌘K 候选列表（现有），并把原话记下来喂下一版模板。
- 工作量：引擎 M，首批 15 个域的模板 L（每域 5～15 条），日期 / 金额 / 数量归一化 M。

**第 1 档 · 本地小模型（只做「翻译」）**

- 做法：第 0 档置信度低时，把原话 + 候选意图列表 + 槽位定义交给本地模型，要求只输出结构化 JSON（意图 id + 槽位），仍由同一套动作执行。不让它生成自然语言答复，不让它多步。
- 硬件：NAS（多为 Intel N100 / J 系列、8～16 GB）跑 1.5B 量化模型可用但慢（数秒）、7B 不现实；Mac mini（Apple Silicon）跑 7B 中文模型秒级。**所以第 1 档必须是可选的**：检测到 Ollama 可用才启用，默认关。
- 可行性：**中**。小模型做「归类到有限选项 + 抽槽位」的准确率可接受（远好于让它自由回答），且结果落进同一套确认流程，错了人能看见。
- 成本：一次性硬件（已有 Mac mini），电费。
- 风险：模型更新、Ollama 版本、显存；对策是接口只依赖 OpenAI 兼容 API，任何本地推理服务都能替。
- 工作量：路由与适配 S，提示词与评测集 M。

**第 2 档 · 云端 API（推理、摘要、多步）**

- 做法：现有 agent loop（自研版）+ 从 manifest 生成的工具；C、D 两类走这里；写操作仍是提案 → 确认。
- 可行性：**高**（这就是现有 agent 的形态），只是从「必经之路」降为「可选的上层」。
- 成本：按家庭 key 计费（BYOK）；开源版让用户填自己的 key；将来运营中继时可代理。
- 风险：隐私（家庭数据出网）——必须家庭级开关、默认关、发出前脱敏（成员真名→称呼、金额→区间可选）；成本失控——每家每日上限。
- 工作量：agent 重建本身（refactor-plan 已列，L～XL），本方案不新增。

### 2.3 路由

```
输入 → 第 0 档匹配
  置信度 ≥ 高阈值 → 直接进入动作（写操作走提案确认）
  中间区 → 第 1 档可用？→ 让它选意图 → 同上
          → 不可用 → 展示前 3 个候选让人点（⌘K 现有形态）
  低于低阈值 / 类别为 C、D → 第 2 档开着？→ agent loop
                              → 关着 → 「这个我还不会，你可以…」+ 候选
```

- 阈值是插件级可配的常量；全部命中和未命中都记入 `assistant_utterances`（原话、命中档位、意图、是否被人改正），这是模板迭代和试用分析的唯一数据源。
- 三档共用：动作执行、提案确认、权限校验、审计。**档位只决定「耳朵」，不决定「手」。**

### 2.4 为什么不选另外两条路

| 路 | 为什么不 |
| --- | --- |
| 全靠云端 LLM（现状的默认想象） | 延迟秒级、每句都花钱、断云即死、偶发答错，家里人第一周就弃用；隐私上家庭数据全出网 |
| 在 NAS 上内置一个模型当核心 | NAS 算力不够；小模型自由回答质量差且不可预测；模型成了必须维护的依赖；开源用户硬件五花八门 |

---

## 3. 目标架构

### 3.1 三层

```
┌─────────────────────────────────────────────────────┐
│ 助理层（可选，家庭级开关）                             │
│   第0档 规则引擎 │ 第1档 本地模型 │ 第2档 云端 agent loop │
│   ── 只消费插件 manifest，不持有业务逻辑 ──            │
├─────────────────────────────────────────────────────┤
│ 插件层（按 manifest 接入，可开可关）                   │
│   点菜 任务 日历 购物 库存 资产 财务 观影 智能家居 地图 … │
├─────────────────────────────────────────────────────┤
│ 内核（确定性，永远在）                                 │
│   家庭/成员/权限 · 事件通道 · 家庭日期 · 今天页 · 搜索  │
│   留意 · 设置 · 备份 · 深链约定 · 插件注册表           │
└─────────────────────────────────────────────────────┘
```

### 3.2 插件 manifest（草案）

放 `packages/contracts/src/plugins/<key>.ts`，每个插件一份，类型 `PluginManifest`：

```ts
{
  key: 'finance',                       // 唯一，与事件域、模块 key、导航 key 同名（三处合一）
  name: '财务', glyph: '账',
  tier: 'shelf' | 'core' | 'settings',  // 默认层，家庭可覆盖（现有 override）
  nav: { path: '/house/finance', segments: [...] },
  hasData: 'sql:finance_entries' | fn,  // F3 的判定，声明式
  eventRoutes: ['/finance', '/budgets'],// H2 映射表由此生成
  attention: [FinanceBudgetProvider],   // F5 provider 列表
  settingsRows: [...],                  // F7 家庭设置行
  usage: { tables: [...], activities: [...] },  // usage-report 由此生成
  dependsOn: ['tasks'],                 // J1b：用到了哪些插件的门面（读 / 同步调用），与代码里取用的一致（check-plugins 断言）
  hooks: ['tasks.completed'],           // J1b：订阅了哪些事务内钩子（同一事务连带写），与代码里订阅的一致
  actions: [{                           // ⌘K 动作 + 第0档模板 + agent propose 工具，三合一
    id: 'finance.record-expense',
    label: '记一笔支出',
    deepLink: '/house/finance?create=1&kind=expense',
    slots: { amount: 'money', note: 'text?', date: 'date?' },
    templates: ['记一笔{amount}{note}', '{note}花了{amount}', '记账{amount}'],
    propose: true,                      // 生成 propose_finance_record_expense 工具
    minRole: 'member',
  }],
  queries: [{                           // 第0档问答 + agent 读工具，二合一
    id: 'finance.month-summary',
    templates: ['这个月花了多少', '{month}花了多少'],
    slots: { month: 'month?' },
    execute: (ctx, slots) => ...,
    answer: (result) => '这个月到今天花了 1,240 元，吃饭占 46%',
  }],
}
```

**插件之间怎么打交道**（J1b 定，见 §9）：插件目录之间不 import，只走内核的两种机制——门面（读与同步调用，声明 `dependsOn`）、事务内钩子（同一事务连带写，声明 `hooks`）；事务提交后的「事情已经发生了」走内核事件总线上 contracts 定义的插件事件。

**原则**：manifest 是数据，不是框架。现有 nav.ts、events.ts、actions.ts、attention、usage-report 改成**从 manifest 生成**，各自的形态不变；CI 断言「每个域必须有 manifest 且七处全部由它导出」。

### 3.3 助理层与 manifest 的关系

- 第 0 档引擎的词表 = 所有已启用插件的 `actions[].templates` + `queries[].templates` + 库里的成员名 / 位置名 / 设备名。
- 第 2 档 agent 的工具 = `queries` 自动生成读工具，`actions(propose: true)` 自动生成 `propose_*`。28 个现有工具名保留为别名以兼容黑盒脚本，重建完成后弃用。
- 插件被家庭关掉（override off）→ 它的模板与工具同时从助理消失。
- 助理层零业务逻辑的检验标准：删掉整个助理层，所有插件和内核功能不受影响；删掉任一插件，助理只是少懂几句话。

---

## 4. 分期与工作量

按「一人 + AI 编码工具」估。J0～J2 在演示栈上进行，不以家庭试用为前提，不动页面；J3 起需要试用数据。

| 阶段 | 内容 | 档 | 依赖 |
| --- | --- | --- | --- |
| **J0 盘点**（不改代码） | 列出 15 个域在七处登记的现状差异；起草 `PluginManifest` 类型；选 3 个域（购物、任务、智能家居）做 manifest 草稿看是否表达得下 | S | — |
| **J1 插件注册表** | `packages/contracts/src/plugins/`；nav / modules / events 映射 / attention 挂载 / settings 行 / usage 表改为从 manifest 生成；CI 断言全覆盖；15 个域逐个迁（每域一提交，页面不动） | L（约 1.5 周） | J0 |
| **J2 助理数据与开关** | `assistant_utterances` 表；助理三档的家庭级开关与配置页（第 0 档默认开、1/2 默认关）；⌘K 输入原话落表（试用期就开始攒句子） | M | J1 |
| **J3 第 0 档引擎** | 意图匹配、槽位归一化（金额 / 数量 / 相对日期 / 餐次 / 成员 / 位置 / 设备）、置信度、候选回退；首批模板覆盖 A、B 两类；接进 ⌘K 与今天页搜索条，命中后走现有提案确认。**输入 = `assistant_utterances` 导出的 CSV**（设置页「原话记录 → 导出 CSV」，`chosenKind` / `chosenId` 当人工标注）。**补 ⌘K 动作时**：给点菜补一条动作，把 `propose_menu` 从 manifest 顶层 `proposals` 挪回 `actions[].propose`，然后删掉 `proposals` 字段（J1.4 加的过渡结构，2026-10-06 King 认定） | L（约 2 周） | J1；**模板需要试用期攒的原话** |
| **J4 agent 重建为 manifest 消费者** | refactor-plan 3.2 的自研 loop 落到 `packages/agent-core`；工具由 manifest 生成；28 个旧工具名做别名；`/events` 推运行状态（H2 已备）；第 2 档路由接入；脱敏与每日上限 | XL（约 3 周） | J1、J3 |
| **J5 第 1 档本地模型** | OpenAI 兼容适配；Ollama 探测；仅做意图 + 槽位；评测集（用 J2 攒的原话）；默认关 | M | J3 |
| **J6 收口** | 删 Hermes 相关（compose、配置）；文档；开源版的「写一个插件」指南 | S | J4 |

顺序建议：J0 → J1 → J2（演示栈上进行，与试用何时开始无关）→ 试用两周 → J3 → J4 → J5 → J6。J1 完成后，加一个新域的成本从「改七处」降到「写一份 manifest + 自己的表和页面」。

---

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| J1 变成一次大重构，页面被顺手改 | 硬规矩：J1 每个提交只允许改「登记处」，Playwright 全量必须零改动通过；页面文件 diff 为零 |
| 第 0 档模板凭空写、和家里人说的不一样 | J2 先落原话表，J3 用真实原话做评测集，覆盖率作为验收指标（首版目标：试用期原话 ≥ 70% 命中） |
| 三档共用一套动作但权限校验被绕过 | 动作执行只有一个入口（服务端），三档都调它；单测锁死「任何档位都不能跳过 minRole 与提案确认」 |
| 云端档隐私 | 家庭级开关默认关；发出前脱敏；每日上限；开源版 BYOK；不留云端对话记录在第三方（按供应商配置） |
| 本地模型成为维护负担 | 只依赖 OpenAI 兼容 API；不可用即静默跳过，功能退回第 0 档 |
| 重建 agent 期间旧 agent 无法使用 | 它现在就是关的；J4 完成前不开启 |

---

## 6. King 拍板（2026-10-01 已定）

1～5 同意；第 6 条按 King 修改后的口径执行。

1. **三层定位**（同意）：「小管家 = 整个 App；助理 = 可选的一层」，而不是「助理 = 核心」。
2. **第 0 档优先于模型**（同意）：基础能力用规则引擎实现，本地模型只做兜底翻译且默认关。
3. **排期**（同意，措辞按 §4 修订）：J0～J2 在演示栈上进行，不以家庭试用为前提（不改页面）；J3 起等试用两周的原话数据。
4. **云端档策略**（同意）：开源版 BYOK；你家先用自己的 key；默认关、脱敏、每日上限。
5. **第 1 档硬件**（同意）：你家用 Mac mini 上的 Ollama（HA 也在那台机器上）；开源用户可选。
6. **对外插件**（修改）：J1 的 manifest 契约按第三方可写的标准设计——独立目录、声明式依赖、禁止跨域 import Service；插件市场本期不做。

## 7. 与其他计划的关系

- 不改变 `deploy-c2.md` 的迁 NAS 流程；J0～J2 不动页面，可在试用期间上线。
- refactor-plan 3.2「自研 agent loop」的目标形态由本方案给出（J4）。
- pre-trial-plan §5 后置的「agent 工具按模块裁剪」由 manifest 自然解决（插件关掉即工具消失）。
- Phase G（远程访问、购物清单离线）独立于本方案；第 0 档跑在 NAS 上，远程访问方案不影响它。

## 8. J0 盘点结果（2026-10-02）

> 只盘点，不改产品代码。产出：本节 + `packages/contracts/src/plugins/`（`types.ts` 与 shopping / tasks / smart-home 三份草稿，未从 `src/index.ts` 导出，未接线）。
> 盘点基于 main `b6abd35`。

### 8.0 先纠正两个数

- **域不是 15 个，是 18 个候选插件**：点菜（menus，两段导航：点菜 / 厨房）、菜谱、购物、库存、位置、资产、日历、任务、提醒、投票、财务、积分、访客、智能家居、观影、出行、回忆、知识库。另有内核域：今天、消息（notifications）、家庭动态（activity）、成员 / 家庭 / 备份 / 模块开关；小管家（assistant）属于助理层。`SHELF_MODULE_KEYS` 的 16 个里混着 activity 和 assistant，它们不是插件。
- **登记处不是 7 处，是 14 处**（§8.1）。文档原先只数了「主表」，漏掉的都在 web 端和 agent 内部。

### 8.1 每个域要登记的地方（实测 14 处）

| # | 登记处 | 文件 | key 用的是 | J1 后来源 |
| --- | --- | --- | --- | --- |
| 1 | 导航分段、core 顺序、手机底栏 | `apps/web/src/lib/nav.ts`（SCENES / PINNED / CORE_KEYS / mobileTabs） | 导航 key（menus 用 order / kitchen） | manifest（`pluginNav` 原位展开）；内核分段 `CORE_NAV` / `PINNED` / `TODAY`；`CORE_KEYS` 与 `mobileTabs` 顺序表手写（已知手写 ①） |
| 2 | 模块开关与 hasData | `packages/contracts/src/system.ts` SHELF_MODULE_KEYS + `apps/api/src/system/system-modules.service.ts` | 域 key | hasData 由 manifest 生成（`tables` 出 SQL、`server` 由插件注册 `ModuleHasDataRegistry`）；`SHELF_MODULE_KEYS` key 表手写（②）；activity / assistant 内核常量 |
| 3 | 写端点 → 域 | `packages/contracts/src/events.ts` EVENT_ROUTES（含 PROPOSAL_DOMAINS） | 域 key | manifest + 内核 `CORE_EVENT_ROUTES` / `CORE_EVENT_ROUTE_EXEMPT`；`PROPOSAL_DOMAINS` 由 manifest 的提案声明生成 |
| 4 | 域 → 前端查询 key | `apps/web/src/lib/events.ts` DOMAIN_QUERY_KEYS | 域 key | manifest + 内核 `CORE_QUERY_KEYS` |
| 5 | 留意规则（服务端） | `apps/api/src/today/` 11 条写死在 TodayModule + DOMAIN_ORDER + OFF_KEYS；智能家居 1 个走 AttentionRegistry；`contracts/src/today.ts` domain 枚举 | 域 key | 规则由各插件目录注册到 `AttentionRegistry`；排序、开关、能力门槛由 manifest + 内核 `CORE_ATTENTION`；domain 枚举手写（⑤） |
| 6 | 留意文案与落点（前端） | `apps/web/src/lib/attention-copy.ts`（labels / actions / kindActions / listActions）+ `routes.ts` attentionRoutes / attentionPath 特判 | 域 key + kind | manifest + 内核 `CORE_ATTENTION`（无手写表、无兜底分支） |
| 7 | ⌘K 动作 | `apps/web/src/lib/actions.ts` + `command-palette.tsx` 里的财务特判 | 域 key | manifest（`pluginActions` 原位展开） |
| 8 | agent 工具名单 | `contracts/src/agent.ts` 与 `apps/api/src/agent/agent.types.ts` **两份一模一样的名单** + `agent-mcp.controller.ts` 注册 | 工具名 | `contracts/src/agent.ts` 字面量名单手写（⑧）；每个工具的归属由 manifest / `KERNEL_AGENT_TOOLS` 认领并全量断言 |
| 9 | agent 工具 → 来源模块、提案 → actionType | `agent-tools.service.ts` sourceModule 表、`agent-proposals.service.ts` 双向表 | 单复数混用（`asset`、`locations`、`agent_memory`） | manifest（别名表）+ 内核 `CORE_TOOL_SOURCES`；提案工具 ↔ actionType ↔ 类型名 ↔ 能否打包由 manifest 生成 |
| 10 | 设置行 | `apps/web/src/pages/settings.tsx` | 写死路径 | 页面文件（⑩），断言与 manifest 一致 |
| 11 | 用量统计 | `apps/api/scripts/usage-report.mjs`（ACTIVITY_DOMAINS / TABLE_SOURCES / UNCOUNTED / 位置快照） | 流水 module → 中文名 | manifest + 内核 `CORE_ACTIVITY_DOMAINS`；位置快照实现按 id 留在脚本 `SNAPSHOT_SOURCES` |
| 12 | 动态流水 module | `contracts/src/activities.ts` ACTIVITY_MODULES | 单数（task、asset…） | 数据库枚举（⑫），别名表断言归属 |
| 13 | 通知 module 与图标 | `contracts/src/notifications.ts` + `apps/web/src/lib/notification-meta.ts` | 单数 | 枚举（⑬）；名字与图标 manifest + 内核 `CORE_MODULE_LABEL` / `CORE_MODULE_ICON` |
| 14 | 能力（权限） | `apps/api/src/auth/capabilities.ts` ROLE_CAPABILITIES | 能力名 | 授予关系 manifest + 内核 `CORE_ROLE_CAPABILITIES`；`Capability` 名字清单手写（⑭） |

另有 `routes.ts` 的旧路径表 MOVED，属于一次性迁移遗留，manifest 里用 `legacyPaths` 收纳。

**同一个域最多有 6 种 key**：域 key `tasks` / 导航 key / 流水 `task` / 通知 `task` / 工具来源 `task` / 提案 `task`；点菜是 `menus` / `order`+`kitchen` / `menu`。J1 第一件事是把这些收成「一个 key + aliases」。

### 8.2 现状对照表（18 个候选插件）

事件栏「主 / 涉及」= 以本域为首的路由条数 / 会推本域的路由条数。依赖栏只列跨插件 import（activities、today 算内核，不列）。

| 域 | 导航 | 开关 · hasData | 事件 主/涉及 | 查询 key | 留意 | ⌘K | agent 读 / 提案 | 设置行 | 用量 | 通知 | 跨插件 import |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 点菜 menus | core ×2 | — | 3/7 | 5 | — | **缺** | meal_plan、dish_plan / menu | — | 流水 + menu_events | menu | recipes（函数） |
| 菜谱 | shelf | SQL | 4/4 | 3 | — | 1 | search_recipes / — | — | 流水 + 主表 | — | — |
| 购物 | core | — | 3/7 | 2 | — | 1 | shopping_list / shopping_items | — | 流水；主表不可计 | — | 直读 Menu、Inventory 实体 |
| 库存 | shelf | SQL | 3/9 | 6 | 1 | **缺** | inventory_alerts、inventory_summary / — | — | 流水 + 主表 | — | locations（函数） |
| 位置 | shelf | SQL（含子查询） | 2/7 | 1 | — | 1（落点在库存页） | find_item、list_location_contents / — | — | 只有快照 | — | — |
| 资产 | shelf | SQL | 6/7 | 3 | 3 | 1 | asset_detail / — | — | 流水 | — | **inventory Service**、locations（函数） |
| 日历 | core | — | 1/9 | 1 | — | 1 | calendar / — | — | 流水 + 主表 | calendar | **tasks Service** |
| 任务 | core | — | 1/3 | 1 | — | 1 | tasks、member_tasks / task | — | 流水 + 主表 | task | **points Service（事务内）** |
| 提醒 | shelf | SQL | 1/6 | 2 | — | 1 | **缺** / reminder | — | 流水 + 主表 | reminder | **calendar Service**、tasks（函数） |
| 投票 | shelf | SQL | 1/4 | 1 | 1 | 1 | **缺** / poll | — | 流水 + 主表 ×2 | poll | — |
| 财务 | shelf（仅管理员） | SQL | 1/3 | 1 | 1 | 2（仅管理员） | finance_summary / finance_transaction | — | 流水 | — | — |
| 积分 | shelf | SQL | 3/4 | 4 | 1 | **缺** | **缺** | — | 流水 | points | — |
| 访客 | shelf | SQL | 9/9 | 7 | 2 | 1 | **缺** | — | 流水 | guest | — |
| 智能家居 | shelf | 特判（读环境变量） | 2/2 | 10 | 3（注册表） | **缺** | **缺** | 有 | 主表 ×3 | — | **tasks / reminders / shopping Service**、tasks 事件 |
| 观影 | shelf | SQL | 2/4 | 9 | — | **缺** | watch_candidates / — | 有 | 流水 | media | — |
| 出行 | shelf | SQL | 2/2 | 3 | 1 | 1 | travel_checklist / — | — | 流水 | — | — |
| 回忆 | shelf | SQL | 1/1 | 1 | — | 1 | recent_memories / — | — | 流水 | — | — |
| 知识库 | shelf | SQL | 1/1 | 2 | — | 1 | search_knowledge / — | — | 流水 | — | — |

不属于任何插件的 agent 工具：`get_today_summary`、`get_family_schedule`（跨日历 / 任务 / 提醒）、`get_member_profile`（成员）、`get_weather`（无域）、`propose_plan`（跨插件打包），以及记忆工具 2 个。J4 要把它们归到内核或助理层自己的工具，而不是硬塞进某个插件。

**不一致**（J1 生成时必须先选定一个来源）：

1. ~~**财务权限三处不一致**：`ROLE_CAPABILITIES` 给普通成员 `view_finance` + `record_finance`（API 允许成员记账），但导航 `managerOnly`、⌘K 写死 `domain !== 'finance' || manager`。~~ **已关闭**（J1.3 财务权限 fix，§8.7）。
2. ~~**⌘K 不看模块开关**：家庭把某个模块关掉后，它的 ⌘K 动作还在。~~ **已关闭**（§8.6 第 5 条：搜索与深链始终可达，这是规则不是缺陷）。
3. **留意两种挂法**：11 条在 TodayModule 里写死注入，只有智能家居走 AttentionRegistry；DOMAIN_ORDER、OFF_KEYS、contracts 的 domain 枚举、web 的 4 张文案表又各写一遍。
4. ~~**agent 工具名单两份**：contracts 与 API 各一份，目前内容一致，但没有任何检查保证一致。~~ **已关闭**（J1.0 收成 contracts 一份，API 只转出）。
5. ~~**端点归属与路径前缀不符**：`POST /shopping-items/:id/confirm-stock` 写在 inventory 模块；`/maintenance-plans/:id/shopping-items` 写在 assets 模块。~~ **已关闭**（按写在哪个模块登记：confirm-stock、confirm-consumption 进库存 manifest（J1.5），`/maintenance-plans/:id/shopping-items` 进资产 manifest（J1.5）；推送的域照旧带上路径所在的域）。
6. ~~**内核反向依赖插件**：`system-modules.service.ts` import `smart-home/home-assistant.config`。~~ **已关闭**（J1.6：hasData 改走 `ModuleHasDataRegistry`，check-plugins 断言内核目录不 import 插件目录）。
7. **SHELF_MODULE_KEYS 混着非插件**：activity（永远 hasData）和 assistant（看 agent 开关）也在里面。

**缺项**（不是错，J3 / J4 要补的空白）：⌘K 缺点菜、库存、积分、智能家居、观影；agent 读工具缺提醒、投票、积分、访客、智能家居；设置行只有观影和智能家居有。

**跨插件 Service import（违反 §6 第 6 条）共 7 条边**：资产 → 库存、日历 → 任务、提醒 → 日历、智能家居 → 任务 / 提醒 / 购物、任务 → 积分（在打勾的同一事务里记积分）。另有 3 处纯函数 import（`usableLocationId`、`buildRecipeSnapshot`、`taskOccursOn`），以及所有域共用一个 8,352 行的 `entities/index.ts`（购物直接读 Menu、InventoryItem 实体）。agent 依赖 14 个域的 Service，属于 J4 的事。

### 8.3 agent 工具（核实）

- 读工具 21 个（`AGENT_READ_TOOLS`）、提案工具 7 个（`AGENT_PROPOSAL_TOOLS`），合计 28；另有记忆工具 2 个（`AGENT_MEMORY_TOOLS`），MCP 实际注册 30 个。
- 名字**全部手写字面量**，不是拼出来的。之前只搜到 `propose_plan`，是搜索写法的问题。
- 命名不统一：提案工具是 `propose_` + 名词，单复数随意（`propose_shopping_items` 对应 actionType `shopping`，`propose_finance_transaction` 对应 `finance`）；`propose_plan` 是跨插件打包，不对应单一 actionType。
- 文档里「28 个旧工具名做别名」（§3.3、J4）的数没错；J4 要做别名的是 30 个。

### 8.4 manifest 草稿：七处能不能表达

`packages/contracts/src/plugins/types.ts` 定义 `PluginManifest`；三份草稿 `shopping.ts`、`tasks.ts`、`smart-home.ts` 用 `satisfies PluginManifest` 通过 contracts 类型检查。另用临时脚本从草稿反推现有登记，逐项对比：导航、旧路径、模块开关、事件路由（含是否漏登）、查询 key、留意文案与排序、⌘K、agent 工具名、设置行、用量、通知 module，**三域 44 项全部一致**。

相对 §3.2 原草案的改动：

| §3.2 原写法 | 改成 | 原因 |
| --- | --- | --- |
| `execute` / `answer` 是函数 | `server: '<id>'`，答复可用模板字符串 | manifest 要能被第三方写、被 web 打包，不能带代码；实现留在插件自己的服务端目录按 id 注册 |
| `minRole` | `capability` + `managerOnly` | 系统用的是能力，不是角色等级 |
| `hasData: 'sql:...'` | `always` / `tables[]` / `server` | 智能家居要读环境变量；位置要子查询 |
| `attention: [ProviderClass]` | `attention.kinds[]`：server id + 文案 + 落点模板 + 能力 | 前端 4 张文案表、落点特判、排序都得从这里来 |
| `eventRoutes: string[]` | 每条带 `domains`、`emit`，另加 `queryKeys`、`emits` | 写一处常常推多个域；webhook 要显式发；前端失效靠 queryKeys |
| `tier` + 单个 `nav` | `nav[]`，每段带 scene / tier / mobileTab | 点菜有两段；购物路径在 house、底栏在 eat |
| 无 | `aliases`、`requires`、`legacyPaths`、`notifications`、`capabilities`、`manifestVersion` | 6 种 key 共存；声明式依赖（§6.6）；通知图标；权限汇总；第三方版本兼容 |

**表达不了、需要 J1 另做机制的**：

1. **事务内的跨插件调用**：任务打勾时在同一事务里记积分；智能家居在自己的事务里建任务、提醒、购物项。manifest 只能声明 `requires`，运行时需要「带事务的跨插件门面」，或者改成事件加补偿。
2. **不属于任何插件的东西**：上面 5 个跨域 agent 工具；今天页、动态、消息自身的登记。需要一份「内核 manifest」，或者明确由内核手写。
3. **分段排序**：CORE_KEYS 的顺序、场景内分段顺序，草稿里还没有 `order` 字段，J1 补上。
4. **设置行的状态文案**：现在是页面各自取数拼的，manifest 只能给 `status.server` id，需要服务端出一个汇总端点（或页面保留特判）。
5. **位置的用量快照**：是专门写的 SQL，只能走 `server`。
6. **实体、迁移、页面**：manifest 管不到。「独立目录」若要落到实体和页面，是 J1 之外的事。

### 8.5 J1 迁移顺序与工作量

硬规矩不变：J1 每个提交只改登记处，页面文件 diff 为零，Playwright 全量零改动通过。

| 步 | 内容 | 量 |
| --- | --- | --- |
| J1.0 | 插件注册表 `plugins/index.ts`；14 处登记各写一个生成函数；CI 加「生成结果 == 手写结果」对比（先双跑，不切换）；统一 aliases | M（2～3 天） |
| J1.1 | 知识库、回忆、出行：无跨插件依赖，登记最少 | 各 XS（合计半天） |
| J1.2 | 投票、菜谱、积分、观影：观影有设置行和子页面 | 各 S（合计 1.5 天） |
| J1.3 | 访客（9 条路由、显式发、2 种留意）、财务（先定权限口径） | 各 S（合计 1 天） |
| J1.4 | 购物、任务、日历、提醒、点菜：core 层，只迁登记，Service 依赖原样保留 | 各 S（合计 2 天） |
| J1.5 | 库存、位置、资产：交叉多，confirm-stock 先定归属 | 合计 1.5 天 |
| J1.6 | 智能家居：hasData 改 server、去掉内核反向 import | S（半天） |
| J1.7 | 留意 11 条改走 AttentionRegistry；删掉手写表；CI 断言「每个域有 manifest，14 处全部由它导出」 | M（1～2 天） |

合计约 10～12 个工作日，与 §4 估的 L（约 1.5 周）大体相符，略多。每域一提交照旧。

**不放进 J1、另起 J1b**（§8.6 第 2 条已定）：7 条跨插件 Service import 的解耦（门面或事件）。这会改服务代码，违反 J1「只改登记处」的硬规矩。J1b 排在 J1 之后、J4 之前，量 M～L（约 1 周），最难的是任务 → 积分的事务内调用。实体拆目录不在 J1 / J1b 范围。

### 8.6 King 拍板（2026-10-04，J0 验收通过）

1. **插件清单**：按 18 个。J1 只收敛 key（一个 key + 别名表），不合并域。
2. **跨插件解耦另起 J1b**，J1 只改登记处。J1b 方向：
   - 跨插件调用改走内核事件，由对方订阅；
   - 必须同事务的，用内核的「事务内钩子」注册回调（任务 → 积分、智能家居建任务 / 提醒 / 购物项）；
   - 不属于任何插件的 agent 工具（今日摘要、家庭日程、成员档案、天气、`propose_plan`、记忆工具）归 manifest 里的 assistant 内核清单；
   - 内核 import 智能家居配置那一处一并解掉。
3. **财务权限口径**：普通成员可以记账、看流水；账户、预算、冲销只有管理员能做。导航、⌘K、API 能力三处对齐到这个口径，在 J1 迁财务域时作为一笔独立的 fix 一起修，带 e2e：普通成员能记一笔并在流水里看到，进不了预算页。
4. **「买到后入库」**（`POST /shopping-items/:id/confirm-stock`）归库存插件。
5. **⌘K 不随模块开关隐藏**。规则：模块收起 / 隐身只影响家里页、侧栏、留意；搜索与深链始终可达。§8.2「不一致」第 2 条据此关闭。

### 8.7 J1 执行记录

**做法**：各登记处改成「手写表 + 从 manifest 生成的条目」两段合并。迁一个域，就加一份 `packages/contracts/src/plugins/<key>.ts`、放进 `PLUGINS`、删掉各处的手写条目。顺序有意义的登记（导航分段、⌘K、旧路径）不在 manifest 里放 order，而是在原位置用 `pluginNav(key)` / `pluginActions(key)` / `pluginLegacyPaths(key)` 占位，现有顺序原样保留。

**两道检查**（CI 静态检查 job，J1.0 新加）：
- `scripts/check-plugins.mjs`：
  - 全局：key 表、别名表（流水 / 通知 / 提案 actionType 每个值归属唯一、没有死别名）、agent 工具归属；
  - 已迁域：contracts 里的登记结果，以及 web / api / 用量脚本里不许残留本域的手写条目；
  - 页面文件里的家庭设置行，只断言与 manifest 一致。
- `apps/web/src/lib/plugins-registry.test.ts`：已迁域的导航、⌘K、查询失效、旧路径、留意文案与落点、通知，运行结果与 manifest 一致。CI 原来不跑 web 单测，J1.0 起跑。

**14 处的落法**：

| # | 登记处 | J1 的落法 |
| --- | --- | --- |
| 1 | 导航 | 原位 `pluginNav(key)` |
| 2 | 模块开关 / hasData | `SHELF_MODULE_KEYS` 是 key 表，保留手写并断言；hasData SQL 由 `module.hasData.tables` 生成 |
| 3 | 写端点 → 域 | `EVENT_ROUTES` = 手写 + manifest | manifest + 内核 `CORE_EVENT_ROUTES` / `CORE_EVENT_ROUTE_EXEMPT`；`PROPOSAL_DOMAINS` 由 manifest 的提案声明生成 |
| 4 | 查询失效 | 手写 + manifest |
| 5 | 留意（服务端） | 排序、开关归属由 manifest 生成；规则本身 J1.7 再挂注册表 |
| 6 | 留意文案与落点 | 按 kind 的标题模板、合并标题、落点模板生成 |
| 7 | ⌘K | 原位 `pluginActions(key)` |
| 8 | agent 工具名单 | **J1.0 已收成一份**（contracts）；API 的 `agent.types.ts` 只转出；`hermes-config-contract.mjs` 改读 contracts | `contracts/src/agent.ts` 字面量名单手写（⑧）；每个工具的归属由 manifest / `KERNEL_AGENT_TOOLS` 认领并全量断言 |
| 9 | 工具来源 / 提案 actionType | 来源由别名表生成；actionType 映射在首个有提案的域迁移时接 |
| 10 | 设置行 | **页面文件，J1 不生成**，只断言一致 | 页面文件（⑩），断言与 manifest 一致 |
| 11 | 用量统计 | `pluginUsage()` 生成，脚本 import `@family/contracts`（生产镜像里可解析） | manifest + 内核 `CORE_ACTIVITY_DOMAINS`；位置快照实现按 id 留在脚本 `SNAPSHOT_SOURCES` |
| 12 | 动态流水 module | 数据库约束里的值，保留手写，别名表断言归属 | 数据库枚举（⑫），别名表断言归属 |
| 13 | 通知 module | 枚举保留，名字与图标在首个有通知的域迁移时接 |
| 14 | 能力 | 在首个声明能力的域迁移时接 |

**新增「表达不了」**（接 §8.4 的 6 条）：

7. **页面文件里的登记**：家庭设置行写在 `pages/settings.tsx`。J1 的规矩是页面文件 diff 为零，所以设置行在 J1 只做一致性断言，不从 manifest 生成。
8. **业务数据里的来源模块**：提醒、日历、回忆的 `sourceModule`（如 `'travel'`），以及 propose_plan 的步骤类型，是写进数据库约束的引用关系，不是登记处，J1 不动。J1b 做跨插件解耦时一并看。`components/calendar-views.tsx` 里日历条目来源 → 图标的表（含非插件的 `maintenance`）同属此类。

**逐域进度**（每域一个提交；CI 四个 job：静态检查 / API 黑盒 / Playwright 双视口 / 镜像构建）：

| 步 | 域 | 提交 | 合并 | CI | 备注 |
| --- | --- | --- | --- | --- | --- |
| J1.0 | key 收敛、别名表、注册表骨架、一致性断言 | `db21043` | `5cb1b85` | 一次过 | agent 工具名单收成 contracts 一份 |
| J1.1 | 知识库 | `a0633cf` | `7088ace` | 一次过 | |
| J1.1 | 回忆 | `0251ae8` | `24b4737` | 一次过 | |
| J1.1 | 出行 | `098d238` | `22aca84` | **重跑 1 次** | 首跑桌面视口「片单：改成已排期」失败（观影域，本笔未碰；同用例手机视口通过），重跑全绿。疑似观影片单改完只做缓存失效、没写回返回值（教训 44 的模式），J1 不修，单独记 |
| J1.2 | 投票 | `a68a26e` | `9ed0fec` | **重跑 1 次** | 首个带写提案、带通知的域：agent 提案的工具 ↔ actionType ↔ 类型名 ↔ 能否打包，原来四份手写（反查表、提案组各一份），改为 manifest 生成、反查表推导。首跑手机视口「设置页联动：收到的事件列在下面」失败（智能家居，本笔未碰；同一份代码在叠在其上的菜谱、积分分支里通过），重跑全绿 |
| J1.2 | 菜谱 | `c6b0afd` | `61a91eb` | 一次过 | 首个声明能力的域：ROLE_CAPABILITIES 改为手写内核能力 + manifest 插件能力；Capability 名字清单仍手写并断言 |
| J1.2 | 积分 | `7cacd89` | `8f38265` | 一次过 | |
| J1.3 | 访客 | `99a3f71` | `196eee3` | 一次过（#37320763876） | 9 条事件路由：访客公开页 4 条服务端显式发（调用不动），其余 5 条走拦截器——指令里「9 条全部显式发」与代码不符，按代码登记。留意两种（来访没定菜、访客点菜限 `manage_guests`）的标题模板、按钮、「去点菜」落点特判由 manifest 生成；`kindActions` 里的 `menu` / `meal-request` 一并删掉（只有访客用）。⌘K 实有 1 条「加个来访」（§8.2 表对，指令写「没有」），一并迁。`manage_guests` 的授予关系挪进 manifest |
| J1.3 | 财务 | `2cd3397` | `bcbf71a` | 一次过（#37321059096） | 事件路由实为一条 `/finance` 前缀，覆盖全部 8 个写端点、都走拦截器；§8.2 的「1/3」是「主 / 涉及」条数（另两条是 `/agent/proposals`、`/agent/proposal-groups`），不是「三分之一发事件」，无需补发。三个能力挪进 manifest、成员能力集不变；写提案按投票做法由 manifest 生成（`grouped: false`）。别名表去掉财务的 `agentSource`：`get_finance_summary` / `propose_finance_transaction` 的调用记录 `sourceModule` 现状落 `'agent'`（手写来源表从未登记），J1 不改值 |
| J1.3 | 财务权限 fix | `d19b715` | `dcb3f7f` | 一次过（#37322250756） | §8.6 第 3 条：导航去掉 `managerOnly`、删掉 ⌘K 写死特判（check-plugins 加断言防回退）；API 守卫本来就是这个口径，未改，`docs/api-inventory.md` 无变化，黑盒补成员读 200 / 管理写 403；财务页对成员不渲染「预算」「账户」分段（冲销按钮原本就不渲染）。新增 e2e `finance-member`（双视口）；`actions` / `nav` / `home` 三条原断言「成员看不到财务」的用例改为新口径。`GET /finance/budgets` 仍是 `view_finance`，概览页的「本月预算」进度对成员照常只读展示 |
| J1.4 | 购物 | `c431940` | `b623ce5` | 一次过（#37332178144） | 草稿转正，去掉第 0 档模板。`POST /shopping-items/:id/confirm-stock` 写在 inventory.module.ts、归库存（§8.6 第 4 条），**不收**，留在手写表并注释，check-plugins 用 `PENDING_ROUTES` 白名单放过。check-plugins 补 core 段检查：manifest 的 `tier` / `mobileTab` 与 nav.ts 的 `CORE_KEYS`、`mobileTabs` 一致（反证过：去掉 `mobileTab` 会报错） |
| J1.4 | 任务 | `7f037d1` | `58aa46f` | 一次过（#37332375652） | 别名 `task` 本已在表里。打勾时事务内调积分 Service 原样保留 |
| J1.4 | 日历 | `704c187` | `4db858d` | **重跑 1 次**（#37332584424） | 以日历为主的写路由只有 `/calendar-events`；另 8 条推日历的路由是小管家提案 ×2、资产、维护计划、提醒、任务、出行、来访，留在各自的域。`get_today_summary` / `get_family_schedule` 跨域、归内核，不认领。首跑桌面视口「片单：改成已排期」失败（观影，本笔未碰），重跑全绿 |
| J1.4 | 提醒 | `8e33db1` | `db108c4` | 一次过（#37332864835） | 本批唯一 shelf 域。hasData 由 `tables[].where` 生成，与手写 SQL 只差空白，system-modules 黑盒「提醒边界」通过。读工具仍缺，不补 |
| J1.4 | 点菜 | `14f7e79` | `442cd83` | **重跑 2 次**（#37333503940，第 3 次全绿） | 两段导航本来就能用 `nav[]` 表达，类型不用补（指令写的 `nav.segments` 不存在）。**manifest 类型补了两处**：①顶层 `proposals`——点菜没有 ⌘K 动作，而 `actions` 里的每条都会进 ⌘K（注册表单测按此断言），提案无处挂，先放这里，J3 补动作时挪进 `actions[].propose`；② `PluginUsageTable.log`——`menu_events` 每行就是一次操作，来源输出「流水 menu_events」，用量脚本里单独查它的那段删掉。`POST /menus/:id/confirm-consumption` 同样写在 inventory.module.ts（扣库存），与 confirm-stock 同类，**不收**、白名单，归属随 J1.5 定。首跑与第一次重跑都是手机视口「片单：改成已排期」失败；本地该用例双视口各连跑 5 次全过，点菜分支没碰观影，判定为同一偶发，**超出「重跑一次」的规矩多重跑了一次**，第 3 次全绿。该偶发已有未合并的修复分支 `fix/media-scheduled-cache`（`92a8d55`） |
| J1.5 | 位置 | `d61018e` | `8285055` | 一次过（#37418223045） | hasData 含子查询：子查询按外层表名 `storage_locations."parentId"` 关联父位置，现有 `tables[].where` 就能表达，**不补类型**；新旧 SQL 在本地开发库两个家庭上结果一致（22 / 0），system-modules 黑盒通过。⌘K「记一下东西放哪」归位置、落点在库存页，照原样。事件以位置为主 2 条（`/locations`、`/map`），另 5 条推位置的（库存物品、批次、买到后入库、资产、资产位置）留在各自的域。**补类型**：`PluginUsage.snapshots`（server id + 名字）——位置只有现状快照，SQL 与每行文案按 id 留在 usage-report.mjs 的 `SNAPSHOT_SOURCES`（§8.4 第 5 条的 server 模式），check-plugins 断言声明的快照有实现 |
| J1.5 | 库存 | `d7ecc89` | `2799e3a` | 一次过（#37418498319） | **收白名单**：`confirm-stock`（推 shopping / inventory / locations）、`confirm-consumption`（推 menus / inventory）进库存 manifest，推送的域集合与原来逐条一致；手写表里删掉，`PENDING_ROUTES` 空了，整个机制从 check-plugins 删掉；购物、点菜 manifest 的注释改成现状。查询失效 6 个 key 逐条一致。留意「快过期」的合并标题用 `mergedOverdueTitle` 表达「有的已经过期了」 |
| J1.5 | 资产 | `ada4071` | `0da1e3b` | 一次过（#37418772528） | 事件以资产为主 6 条，第 7 条推资产的是 `/locations`（位置）。留意三种由 manifest 生成，`attentionPath` 的资产特判删掉；服务端三条规则的顺序（保养 → 续费 → 保修）与开关归属不变。三条旧路径原本在 `MOVED` 里分两处（`/assets` 一处，`/home-assets`、`/asset` 在观影之后），`pluginLegacyPaths` 只能整组放回，放在 `/assets` 原位：三条互不为前缀，也不和中间条目重叠，换算结果不变。§8.2 写的「库存 Service」实际是 `InventoryTransactionsService`（维护记出库） |
| J1.6 | 观影 | `aabcaac` | `b98cbbf` | 一次过（#37425163279） | 9 个查询 key、五条旧路径（子页面在 `/media` 之前，顺序不变）、事件 `/media` + MoviePilot 回调 `/media/webhooks`（显式发）、事件豁免 `/media/library-availability` 一并进 manifest（`events.exempt`，J0 类型就有）。设置行「观影连接」只断言。hasData 三张表由 `tables[].where` 生成；本地两个家庭新旧都是 0（证明力弱），有数据的情况由 system-modules 黑盒覆盖（household_media、source_configs）并通过。`get_watch_candidates` 归位后 30 个 agent 工具全部有归属，check-plugins「无主工具」从「18 个迁完才查」改为**无条件断言** |
| J1.6 | 智能家居 | `df8f01a` | `4afdab4` | 一次过（#37425814822；已知偶发「设置页联动」双视口都过） | J0 草稿转正。**hasData 改 server**：manifest `{ kind: 'server', id: 'smart-home.hasData' }`（类型 J0 就有，用 `id` 不另起 `provider`）；内核新增 `apps/api/src/system/module-has-data.registry.ts`（SystemModule 导出），智能家居在 `smart-home/smart-home-has-data.ts` 注册判定，SQL 与 `homeAssistantServerDefaultConfigured()` 逐字搬过去；`system-modules.service.ts` 删掉对 `smart-home/home-assistant.config` 的 import、按 key 的特判和已空的手写 `sources` 表，改为按 manifest 的 server id 取判定。新旧判定 SQL 文本逐字一致，本地两个家庭 × 服务器默认 true / false 四种结果一致（都为 false，本地没有设备）；smart-home 黑盒的三条 hasData 断言（白名单空 false / 配好 true / 退回服务器默认 false）通过。check-plugins 加：server 判定必须在插件自己目录注册、system-modules 不许按 key 特判、内核目录（system / today / activities / notifications / events）不许 import 插件目录（反证过）。留意三种由 manifest 生成文案与落点，`attentionPath` 的智能家居特判删掉，顺带删掉一行与下一行重复的判断。用量三项用 `note` 照原样输出来源说明。订阅任务打勾事件、调任务 / 提醒 / 购物 Service 原样保留，记入 J1b |
| J1.7 | 留意改走注册表 | `d1f28c6` | `f78e558` | 一次过（#37429814259） | 11 个规则类原样搬进各自目录（`<key>-attention.ts`，备份在 `system/backups-attention.ts`），规则体逐字核对 11/11 一致，只加 `domain` / `kinds`；每份一个注册类按原顺序 register（同域条件相同时合并卡取先到的那条）。`TodayAttentionService` 删掉 11 个构造注入与手写拼装，改从注册表取；能力门槛按 manifest / `CORE_ATTENTION` 里 kind 的 `capability` 判（来源的种类都看不到就不跑，跑出来再按种类过滤）。**删掉的四处写死能力判断**（与声明同义）：访客点菜 `manage_guests`、积分兑换 `manage_points`、超预算 `manage_finance`、备份 `manage_integrations`；智能家居「连不上」的 `manage_integrations` 在规则体里，按「规则判什么不动」保留。新增 `contracts/src/plugins/core.ts` 的 `CORE_ATTENTION`（备份）与 `allAttention()` |
| J1.7 | 删空表、内核表改名 | `c284435` | `288eef9` | 一次过（#37430661959） | 删掉已空的 `HANDWRITTEN_OFF_KEYS` / `HANDWRITTEN_ORDER`（备份排序进 `CORE_ATTENTION`）、提案三张手写段、用量的主表 / 未计入手写段；内核表改名 `CORE_*` 共 11 张（表头注明内核条目、assistant 工具清单归 J1b），导航内核分段抽成 `CORE_NAV`、内核旧路径抽成 `CORE_LEGACY_PATHS`，都在原位引用；内核 agent 工具来源抽成 `CORE_TOOL_SOURCES`。`PROPOSAL_DOMAINS` 由 manifest 生成（`PluginProposal` 加 `domains`，任务 / 提醒的提案注明还写日历），域集合不变、两条提案路由的域**顺序**变了（推送按集合用）。留意文案与落点只读声明，删掉 `switch` 与 default 兜底。财务不能打包改由 `grouped: false` 推出，`GroupAgentActionType` / `GroupedAgentProposalToolName` 不再写死 `'finance'`。`actions.ts` 里已经没有手写动作，`ACTIONS` 只剩按顺序排的占位，没有空表可删 |
| J1.7 | check-plugins 收口 | `bb649a5` | `6bde9db` | 一次过（#37431219278） | 全量断言：18 个 key 各有 manifest 文件并在 `PLUGINS`；`KNOWN_HANDWRITTEN` 显式登记仍手写的 8 处（①②⑤⑧⑩⑫⑬⑭）并写原因、只断言一致；`CORE_TABLES` 11 张不许出现插件 key / 别名、新加 `CORE_*` 必须登记，例外只有 `CORE_TOOL_SOURCES` 里两个内核工具记成 `calendar`；注册的留意种类 == 声明的种类（逐个类核对真的 register）、today 的 domain 枚举 == 声明了留意的域。`plugins-registry.test.ts` 新增两条断言（18 个都有 manifest；备份文案来自 `CORE_ATTENTION`）。**反向验证 12 种破坏全部报错** |

**J1.7 验证**：
- 留意列表：本地开发库复制出的临时库（另造了访客点菜、积分兑换、超预算、备份四种要能力的数据）上，用 Nest application context 直接调 `TodayAttentionService.get()`，两个家庭的每个成员 × owner / member 角色共 6 份列表，提交 1、提交 2 后与改前 JSON 逐条一致（管理员 7 张、成员 4 张，id、顺序、种类、实体、日期都一样），能力门槛没变。
- 等价比对：73 条留意文案样例、导航、⌘K、旧路径、通知、查询失效、用量报告前后一致；事件路由只有上面说的两条提案路由域顺序不同（集合一致）。
- 反向验证（每次只破坏一处、跑完还原）：内核表塞插件条目、内核工具来源写插件工具、未登记的 `CORE_*` 表、手写回导航分段、`PLUGINS` 漏插件、多规则文件漏注册一条、来源种类与声明不符、声明了没来源的种类、留意能力名写错、domain 枚举多一个域、`CORE_ATTENTION` 写进插件 key、web 单测里 `PLUGINS` 漏插件——12 种全部报错，还原后通过。

**J1 每笔的等价比对做法**（J1.4 起，每笔都做）：迁移前后各导一份快照比——web 端的事件路由、查询失效表、导航分段 / core 顺序 / 手机底栏、⌘K（除动作 id）、旧路径换算、通知名与图标、留意落点；再在本地开发库上跑 `usage-report.mjs`，排序后逐行比。各批只记差异：
- J1.4：五笔全部一致。
- J1.5：旧路径样例加了 `/home-assets/…`、`/asset/…?…`、`/map`、`/locations`；新加 73 条留意文案样例（九个有留意的域 × 每种事 × 有 / 无截止日、逾期、合并、合并含逾期、混合，`attentionCopy` 输出）；用量报告含「位置」快照一段。三笔全部一致；当时 agent 工具只剩 `get_watch_candidates`（观影）无主。
- J1.6：沿用 J1.5 的工具，两笔全部一致；事件豁免条数（9）前后一致。
- J1.7：见上「J1.7 验证」，只有两条提案路由的域顺序不同（集合一致）。

**J1 收口时的剩余手写项**（main `6bde9db`；插件的条目已全部由 manifest 导出，`scripts/check-plugins.mjs` 全量断言）：

1. **已知手写、只断言一致**（`check-plugins` 顶部 `KNOWN_HANDWRITTEN`）：① `nav.ts` 的 `CORE_KEYS` 与 `mobileTabs` 顺序表；② `SHELF_MODULE_KEYS`；⑤ `contracts/src/today.ts` 的留意 domain 枚举；⑧ `contracts/src/agent.ts` 的 agent 工具名单字面量；⑩ `pages/settings.tsx` 的设置行；⑫ `ACTIVITY_MODULES`、⑬ `NOTIFICATION_MODULES`（数据库枚举）；⑭ `Capability` 名字清单。
2. **内核 / 助理层的 `CORE_*` 表**（11 张，不许出现插件 key / 别名）：`CORE_EVENT_ROUTES`、`CORE_EVENT_ROUTE_EXEMPT`、`CORE_ATTENTION`（备份）、`CORE_QUERY_KEYS`、`CORE_MODULE_LABEL` / `CORE_MODULE_ICON`、`CORE_NAV`、`CORE_LEGACY_PATHS`、`CORE_ROLE_CAPABILITIES`、`CORE_TOOL_SOURCES`、`CORE_ACTIVITY_DOMAINS`；外加 `KERNEL_AGENT_TOOLS`、`PLUGIN_ALIASES` / `KERNEL_ALIASES` 这些 key 表本身。唯一例外：`CORE_TOOL_SOURCES` 里 `get_today_summary` / `get_family_schedule` 记成 `calendar`（数据值，J1b 定）。
3. **按设计留在代码里的实现**（manifest 只给 id）：位置用量快照 `SNAPSHOT_SOURCES`、智能家居 hasData 判定、各插件的留意规则。

**J1b 的输入**（§8.6 第 2 条）：已解，见 §9。下面前两条是当时的输入原文，后两条仍然有效。
- ~~**7 条跨插件 Service import**：资产 → 库存（`InventoryTransactionsService`）、日历 → 任务（`TasksService.list`）、提醒 → 日历（`CalendarService.list`）、智能家居 → 任务 / 提醒 / 购物（`createWithinTransaction`）、任务 → 积分（打勾的同一事务里记积分）；另有纯函数 import：位置的 `usableLocationId`（库存、资产用）、菜谱的 `buildRecipeSnapshot`（点菜用）、任务的 `taskOccursOn`（提醒用）；以及智能家居订阅任务打勾事件（`smart-home-links.service.ts`）、购物直读点菜 / 库存实体。~~
- ~~**assistant 内核工具清单**：`get_today_summary`、`get_family_schedule`、`get_member_profile`、`get_weather`、`propose_plan`、两个记忆工具，现由 `KERNEL_AGENT_TOOLS` + `CORE_TOOL_SOURCES` 承接。~~（J1b.5 收进 `contracts/plugins/core-assistant.ts`）
- **数据库里的引用**（J1 不动）：提醒 / 日历 / 回忆的 `sourceModule`、`propose_plan` 的步骤类型、财务流水的 `sourceType`（`asset`、`media_subscription`）、日历条目来源图标表。
- **待 J4**：财务两个 agent 工具（`get_finance_summary`、`propose_finance_transaction`）的调用记录 `sourceModule` 落 `'agent'`（J1.3 起记录，不改值）；manifest 顶层 `proposals` 是过渡结构，J3 补点菜 ⌘K 动作时收掉。

**J1.5 待收**：已收，见 J1.5 库存一行（`PENDING_ROUTES` 已删）。

**演示栈升级（2026-10-06，J1.4 合完后）**：`b5c4e7c` → `442cd83`（脚本打印的「升级前提交」取自 ORIG_HEAD，是 `db108c4`，不准；实际运行版本以 9-30 的备份清单与 reflog 为准）。`upgrade-prod.sh --no-pull`，无新迁移（仍 72 个）。回滚标签 `prod-before-20261006-003241`，升级前备份 `backups-production/20261005-163242Z`。升级后：14 张业务表行数与迁移数前后一致；四个服务与 API Node 时区均为上海；`/api/health/ready` ok，今天 / 家里 / 点菜 / 厨房 / 购物 / 日历 / 任务 / 提醒 / 财务 / 访客 / 智能家居 / 位置 12 个页面 200，新 bundle 含 J1.3 / J1.4 的 manifest；智能家居 `smart_home_live mode=push`，API 容器到 HA 401（网络通）；API 日志无 error。事件流的 `hello` / `heartbeat` 要成员令牌，没测（不登录家里人的账号），无令牌 401。J1.3 的财务权限变化随这次一起上线。

**演示栈升级（2026-10-06，J1.7 合完后）**：`442cd83` → `d9b770c`，`upgrade-prod.sh --no-pull`，无新迁移（仍 72 个）。脚本读「升级前提交」走的是退回路径（运行中的镜像还没有 revision 标签，取最近一份备份清单），得到 `442cd83`，与实际一致。回滚标签 `prod-before-20261006-162932`，升级前备份 `backups-production/20261006-082933Z`。升级后 api / web / backup-worker 三个镜像的 `org.opencontainers.image.revision` 都是 `d9b770c`，同一取值函数复读走标签路径——下次升级直接读标签。检查：14 张业务表行数与迁移数前后一致；四个服务与 API Node 时区为上海；`/api/health/ready` ok；今天、家里、点菜、购物、日历、任务、财务、访客、资产、库存、地图、智能家居、观影、备份 14 个页面 200，新 bundle 含 J1.6 / J1.7 的声明；智能家居 `smart_home_live mode=push`，API 容器到 HA 401（网络通）；API 日志无 error、无 5xx。升级后无人使用，演示栈上没有 `/today/attention` 的真实请求（不登录家里人的账号），由 CI 黑盒与本地留意列表对比覆盖。

**J1.4 收尾（2026-10-06，King 拍板后）**：
- 第四批进度文档 `de3c657` / 合并 `344fb56`，main CI #37345262025 一次过。
- 片单偶发的修复 `fix/media-scheduled-cache` rebase 到 main（`ca0f018`，以 `refactor/media-scheduled-cache` 跑 CI——`fix/` 前缀不触发 CI），#37346314793 一次过，合并 `855252e`；随后在同一提交上全量 CI 连跑 3 次，该用例双视口全过，已从已知偶发表移除（`docs/execution-plan.md` §3.1）。
- `upgrade-prod.sh` 的「升级前提交」改取正在运行的版本（镜像 revision 标签，退回最近备份清单），不用 ORIG_HEAD：`4cbd904` / 合并 `729cb4a`，#37346699307 一次过。标签要等下次升级构建出的镜像才有，下次升级时脚本会退回备份清单（现为 `442cd83`，与实际一致）。
- `agent-proposal-groups` 黑盒可单跑（先 GET /agent/routines 补建 nightly_digest）：`e29b6d3` / 合并 `e481e51`，#37346861982 一次过。
- 重跑规矩修订写进 `docs/execution-plan.md` §3.1 第 6 条。事件流 `hello` / `heartbeat` 由 King 本人登录验证。

### 8.8 J2 执行记录（助理数据与开关）

**目的**：让试用期从第一天起就攒原话（§2.3「模板迭代和试用分析的唯一数据源」）。本批不接任何模型，原话只存本地库。

| 步 | 内容 | 提交 | 合并 | CI | 备注 |
| --- | --- | --- | --- | --- | --- |
| 收尾 | J1 收尾杂项 | `6b66a1b` | `8a74cc6` | 一次过（#37442334833） | `docs/finance-plan.md` 入库；`_to_delete/`（两个空锁文件）与 `fix/media-scheduled-cache` 本地分支 / worktree 清掉（远端分支未动）；§8.7 补 J1.7 后的演示栈升级记录、三段等价比对合成一段。财务不能打包有人盯着：黑盒「`propose_plan` 混进 type finance 整组拒绝」，且 check-plugins 断言 MCP `propose_plan` 手写的步骤类型联合 == manifest 里 `grouped` 不为 false 的提案类型（反证过）——黑盒其实是被 MCP 入参这层手写联合拦下的，manifest 推出的 `GROUPABLE_ACTION_TYPES` 是第二道 |
| J2.1 | `assistant_utterances` 表与接口 | `8c53535` | `b6bdcd5` | 一次过（#37443619010） | 迁移 `AddAssistantUtterances1785233600000`；`/assistant/utterances` 五个端点（见下）；路由进 `CORE_EVENT_ROUTE_EXEMPT`（不推事件、不进流水 / 通知），查询 key 进 `CORE_QUERY_KEYS`；`agent-retention.service.ts` 留 `ASSISTANT_UTTERANCE_RETENTION_DAYS = null`（J3 评测集固定后再定）；黑盒 `assistant-utterances.mjs` + `household-isolation.mjs` 一段 |
| J2.2 | 三档开关与配置、设置页 | `430c5e6` | `272862a` | 一次过（#37444906394） | 迁移 `AddAssistantTiers1785233700000`；设置对话框加「三档」「原话记录」两段；e2e `assistant-settings`（双视口） |
| J2.3 | ⌘K 原话落表 | `0b4a1ae` | `b8dbc3d` | 一次过（#37445870812） | 只改 `command-palette.tsx` 的提交 / 关闭逻辑；e2e：输「记一笔」选中 → 设置页原话记录可见（双视口），没点就关三种结果 + 空输入不记（桌面） |

**表结构（最终版）** `assistant_utterances`：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `householdId` | uuid，FK households ON DELETE CASCADE | 家庭隔离 |
| `memberId` | uuid，FK members ON DELETE CASCADE | 说话的人 |
| `clientId` | uuid | 前端打开面板时生成的幂等键；唯一 `(householdId, memberId, clientId)`，重复提交返回第一次那条（**指令表里没有这一列**，幂等要用它） |
| `text` | varchar(200) | 原话，去首尾空白；CHECK 长度 1～200 |
| `source` | varchar(24) | `command_palette` / `today_search` / `agent_chat`（CHECK）；本批只出现 `command_palette` |
| `tier` | smallint 可空 | 0～2（CHECK）；本批全为空 |
| `intentId` | varchar(80) 可空 | J3 起 |
| `confidence` | numeric(4,3) 可空 | 0～1（CHECK） |
| `outcome` | varchar(16) | `navigated` / `proposed` / `candidates` / `no_match` / `dismissed`（CHECK）；`navigated` 必须带 `chosenKind`（接口校验） |
| `chosenKind` | varchar(16) 可空 | `action` / `page` / `dish` / `item` / `agent`（CHECK） |
| `chosenId` | varchar(120) 可空 | 点的那条的 id（动作 id、页面 key、`dish-<id>`…） |
| `correctedIntentId` | varchar(80) 可空 | J3 起 |
| `createdAt` | timestamptz | 写入时由服务端给到毫秒（库默认 `now()` 是微秒，游标按毫秒比会漏行） |

索引 `IDX_assistant_utterances_household_created (householdId, createdAt)`。

**接口**：`POST /assistant/utterances`（任意成员，clientId 幂等）；`GET /assistant/utterances`（倒序游标分页；`manage_agent` 看全家、可按人筛，**成员也能调、只拿到自己的**，指定别人 403——指令写的是仅 `manage_agent`，但设置页要让成员看自己的）；`GET /assistant/utterances/export.csv`（`manage_agent`，UTF-8 BOM，`= + - @` 开头垫单引号防公式）；`DELETE /assistant/utterances/:id`（本人或 `manage_agent`）；`DELETE /assistant/utterances?memberId=me`（清自己的）。

**开关语义**（`agent_settings` 新列，都有默认值，老家庭升级后行为不变）：
- **`enabled` = 第 2 档（云端）的开关**，不加新列、不改语义：它今天控制的 Hermes 就是云端档的现状形态，J4 重建后仍用这一个字段。设置页上它的标签改成「云端助理（第 2 档）」。
- `tier0Enabled`（默认 true，第 0 档规则引擎，J3 实现）、`tier1Enabled`（false，第 1 档本地模型，J5）、`tier1BaseUrl` / `tier1Model`（OpenAI 兼容地址与模型名，只收 http(s)，局域网地址可用；本批只存、不连）、`tier2DailyLimit`（50，CHECK 1～1000，J4 执行）、`tier2Redact`（true，J4 执行）、`captureUtterances`（true；关掉后 ⌘K 不再落表）。
- `GET /agent/settings` 回传（成员也读得到，`use_agent`），`PATCH /agent/settings` 可改（`manage_agent`）；`/agent/status` 带上 `captureUtterances` 给 ⌘K 用。

**⌘K 记录规则**：一次打开 = 一次会话，只在输入结束时记一条——点了某条 → `navigated`（带 chosenKind / chosenId）；有候选没点就关（Esc / 点外面 / 再按 ⌘K）→ `candidates`；没候选 → `no_match`（「交给小管家」那条不算候选）；输过 ≥ 2 个字又全删掉再关 → `dismissed`（记最后一次非空文本）；空输入不记。只记 text、不记候选列表。`captureUtterances` 为 false，或者面板打开后还没读到 `/agent/status` 时不记（宁可少记）。`keepalive` fetch，失败静默。

**今天页搜索条**：现在没有。家里页搜索条和顶栏放大镜打开的就是 ⌘K，统一记 `command_palette`；`today_search` 留给 J3 接今天页搜索条时用。

**设置页**：小管家设置实际是 `components/agent-settings-ui.tsx` 里的对话框（`pages/assistant.tsx` 的 `?settings=1` 只负责打开），三档与原话记录两段放在新组件 `components/assistant-tiers.tsx`；`pages/assistant.tsx` 没有改动。管理员可改，成员只读；原话记录最近 20 条，管理员可切「全部 / 我的」、导出 CSV，所有人可「清空我的」（二次确认）。

## 9. J1b 执行记录（跨插件解耦）

**结果**：`apps/api/src/<插件>/` 之间零 import（contracts、shared 除外），`check-plugins` 断言。插件之间只走内核的两种机制：**门面**（读与同步调用）、**事务内钩子**（同一事务连带写）；事务提交后的通知走内核事件总线上 contracts 定义的**插件事件**（指令点名沿用的现有总线，不是第三种机制）。无依赖的纯函数挪进 `packages/shared`。数据库里的引用（`sourceModule`、`sourceType`、`propose_plan` 步骤类型、日历来源图标表）一个没动。

### 9.1 两种机制怎么用（给插件作者）

**门面：读，或者同步调一下别的插件。** 接口写在 `packages/contracts/src/plugins/<提供方 key>.facade.ts`（只有类型，前端也能 import），并登记进 `kernel.ts` 的 `PluginFacades`。提供方在自己目录里实现，`onModuleInit` 时 `PluginFacadeRegistry.register('<key>', <key>Facade(...))`；消费方注入 `PluginFacadeRegistry`，用到时再 `this.facades.get('<key>')`（别在构造函数里取，提供方可能还没初始化），manifest 声明 `dependsOn: ['<key>']`。要在调用方的事务里读写时，传 `toPluginTransaction(manager)`，提供方用 `fromPluginTransaction` 还原。门面方法按消费方今天真实用到的签名收口，不多给。

**事务内钩子：同一事务里要连带写别的插件的东西。** 钩子名 `<发起方 key>.<事件>` 与 payload 类型写在 contracts（`kernel.ts` 的 `TransactionHookPayloads` + `TRANSACTION_HOOK_NAMES`，payload 放 `<key>.hooks.ts`）。发起方在自己的事务里 `await this.hooks.run(name, payload, manager)`；订阅方在 `onModuleInit` 里 `this.hooks.on(name, '<自己的 key>', async (payload, manager) => …)`，用同一个 `manager` 写自己的表，manifest 声明 `hooks: [name]`。订阅方依次执行，任一个抛错整个事务回滚；没有订阅方时什么也不做。订阅方之间有先后依赖时，在 contracts 的 `TRANSACTION_HOOK_ORDER` 写死顺序（不写就只能靠模块初始化顺序）。

**插件事件：事情已经发生了，告诉想知道的人。** 事件名与 payload 写在 contracts（`PluginEventPayloads` + `PLUGIN_EVENT_NAMES`，payload 放 `<key>.events.ts`）。发起方事务提交后 `this.events.emit(name, payload)`（`EventBus`），订阅方 `this.bus.on(name, listener)`；订阅方异步执行、出错只记一句警告，发起方不等也不受影响。要和发起方同成同败的，用钩子，不用事件。

例：积分订阅任务打勾（`apps/api/src/points/points.module.ts`）

```ts
// contracts/plugins/kernel.ts
export interface TransactionHookPayloads { 'tasks.completed': TaskCompletedHookPayload; /* … */ }
// 任务：打勾的事务里
await this.hooks.run('tasks.completed', { householdId, taskId, instanceId, dueDate, title, rewardPoints, memberId, completedAt, actor }, manager);
// 积分：
@Injectable()
export class PointsTaskHooks implements OnModuleInit {
  constructor(private readonly hooks: TransactionHookRegistry, private readonly points: PointsService) {}
  onModuleInit() {
    this.hooks.on('tasks.completed', 'points', async (payload, manager) => {
      await this.points.awardTaskCompletion(manager, payload); // 同一事务；抛错 → 任务也不会变成已完成
    });
  }
}
// contracts/plugins/points.ts：hooks: ['tasks.completed', 'tasks.uncompleted']
```

### 9.2 清单

**门面**（`contracts/plugins/<key>.facade.ts`）：

| 门面 | 方法 | 消费方（manifest `dependsOn`） |
| --- | --- | --- |
| `tasks` | `listOccurrences(start, end, actor)`（= `GET /tasks`）、`completeOccurrence(taskId, dueDate, actor)`（= 打勾，自己的事务） | 日历（日历视图里的任务条目）、智能家居（留意查今天的「晾衣服」；联动查今天待做的家务、扫完打勾） |
| `calendar` | `listEntries(start, end, actor)`（= `GET /calendar`） | 提醒（可加提醒的日历条目） |
| `locations` | `usableLocationId(tx, householdId, locationId)` | 库存（物品默认位置、批次位置、入库放哪儿）、资产（放哪儿） |
| `inventory` | `consumeForMaintenance(tx, …)`、`listIngredientStock(tx, …)`、`listShoppingReceipts(…)`、`hasShoppingReceipt(…)` | 资产（维护记出库，同一事务）、购物（生成清单扣库存、已入库的自动项保留；列表的入库确认；删除前检查） |
| `menus` | `listIngredientNeeds(tx, householdId, date)` | 购物（按某天已接受 / 在做的菜生成清单） |
| `shopping` | `hasUncheckedItem(tx, householdId, customName)` | 智能家居（滤芯低时清单里是否已有没买的滤芯） |
| `assets` | `monthlyRecurringCost(householdId)`（Phase K3 加；K 收尾起每期金额优先用资产的「每次续费金额」`renewalPrice`，空了退回购买价格，都没有的不算） | 财务（汇总页「固定支出」里的资产续费月均） |

`dependsOn` 结果：calendar `[tasks]`、reminders `[calendar]`、smart-home `[tasks, shopping]`、inventory `[locations]`、assets `[locations, inventory]`、shopping `[menus, inventory]`、finance `[assets]`（Phase K3）。

**事务内钩子**：

| 钩子 | 发起方 | 订阅方（顺序） | 做什么 |
| --- | --- | --- | --- |
| `tasks.completed` | 任务（打勾的事务） | 积分 | 记积分，写回任务实例的积分版本 / 流水 id，记动态 |
| `tasks.uncompleted` | 任务（取消打勾 / 改跳过） | 积分 | 冲销这次完成记的积分 |
| `smart-home.link-fired` | 智能家居（联动的事务） | 任务 → 提醒 → 购物（`TRANSACTION_HOOK_ORDER` 写死：提醒校验会读刚建的家务行） | 建家务（id 由智能家居预先生成）/ 挂在它上面的提醒 / 清单项 |

**插件事件**：`tasks.completed`（任务，提交后）→ 智能家居联动规则（`smart-home-links.service.ts`）。原来任务目录的 `TaskEvents` 删掉，语义照旧。

**Phase K 新加的留意**（走 J1.7 的 `AttentionRegistry`，kind 与文案在财务 manifest）：`finance.recurring`（没开自动记账的周期账单，到期前 3 天起，逾期标出来，`FinanceRecurringDueProvider`）、`finance.credit`（信用卡还款日前 3 天到当天、还欠着钱，`FinanceCreditDueProvider`）、`finance.recurring-failed`（K 收尾：自动记账落失败，只给管理员 `manage_finance`，名字里带原因，`FinanceRecurringFailedProvider`）。见 `docs/finance-plan.md` §8。

**纯函数**：`taskOccursOn`、`buildRecipeSnapshot` 挪进 `packages/shared`（单测随之搬到 `kernel-units.check.ts`）；`usableLocationId` 要查库，归位置门面。

**assistant 内核工具清单**：`contracts/plugins/core-assistant.ts` 的 `CORE_ASSISTANT_TOOLS`（7 个，各带标签与 `sourceModule`），`KERNEL_AGENT_TOOLS` 与 `CORE_TOOL_SOURCES` 由它导出；`get_today_summary` / `get_family_schedule` 仍记 `calendar`。

### 9.3 每笔记录

每笔的「改前 / 改后」对比都在本地库副本上跑（`pg_dump` 进临时库，Nest 应用上下文直接调服务，结果去掉新生成的 id 与时间后逐字节比；每份探针先在改前代码上连跑两次确认本身确定），写入类的另加黑盒，新黑盒也在改前代码上跑过一遍、结果相同。

| 步 | 内容 | 提交 | 合并 | CI | 对比证据 |
| --- | --- | --- | --- | --- | --- |
| J1b.0 | 内核两个注册表 + 两个纯函数进 shared + manifest 类型 | `15cf044` | `a638fc0` | 一次过（#37453554476） | 注册表单测 8 条（注册取回 / 重复注册 / 未注册取用 / 按注册顺序执行 / 抛错向上抛且后面不再执行 / 重复订阅 / 不认识的钩子名 / 没有订阅方）、两个纯函数单测 3 条（`kernel-units.check.ts`，全量 API 测试里跑）；check-plugins 先只校验形状 |
| J1b.1 | 读门面：日历 → 任务、提醒 → 日历、智能家居留意 → 任务 | `f50ef79` | `42b1570` | 一次过（#37454583370；main #37457085313） | 两个家庭每位成员 × 两种角色调日历 / 提醒来源 / 任务 / 今日留意，24 份逐字节一致 |
| J1b.2 | 写门面：资产 → 库存 / 位置、库存 → 位置、购物 → 点菜 / 库存 | `d1d12d7` | `105926f` | 一次过（#37457237859） | 购物列表 / 生成 / 重新生成 / 删除、位置五种取值 × 五个入口、确认入库与撤销、维护记出库各表的行，65 份逐字节一致；新黑盒 `assets-inventory-rollback`（库存流水 / 批次流水写失败 → 维护记录、周期、余量、批次、动态都不落，同一幂等键重来正常） |
| J1b.3 | 事务内钩子：任务 → 积分 | `66a21b8` | `a14ee3a` | 一次过（#37458364963） | 3 个任务 × 14 步打勾（打勾、重复打勾、取消、重复取消、再打勾、跳过、0 分、无人认领、完成后改负责人、越权），每步的返回 / 流水 / 账户 / 实例积分列 / 动态 / 通知 93 份逐字节一致；新黑盒 `tasks-points-hook`（积分写失败 → 任务不完成；冲销写失败 → 保持已完成；重复不重复记；并发打勾只记一次） |
| J1b.4 | 智能家居：联动走钩子 / 任务门面，订阅打勾走内核事件 | `4117505` | `9fe85ee` | 一次过（#37460386542） | 12 步联动（洗完、重复、滤芯低、重复、买了再报低、扫完、规则关着、ping、打勾触发联动规则、扫完不自激），各表新行与联动规则记录 71 份逐字节一致，J1b.3 探针在本笔代码上仍一致；单测加 3 条（写死顺序 ×2、插件事件）；新黑盒 `smart-home-link-hooks`（家务 / 提醒 / 清单项任一写失败整条回滚；关掉「提醒」/「积分」模块时照旧连带写；打勾 → 联动规则；不自激） |
| J1b.5 | assistant 内核工具清单 | `b2cd7ca` | `2c4e683` | 一次过（#37461227810） | 30 个工具的调用记录 `sourceModule` 映射与 `KERNEL_AGENT_TOOLS` 逐字节一致 |
| J1b.6 | 强制断言 + 文档 | 见本次合并 | | | 反向验证 12 条（下） |

main 上 `105926f`（J1b.2 合并）、`a14ee3a`（J1b.3 合并）两次 CI 被紧接着的合并推送按并发组取消（Playwright 一项 cancelled，其余三项已过），以 J1b.6 合并后的 main 全量 CI 为准。

**check-plugins 新断言（J1b.6）与反向验证**：插件目录之间零 import；`apps/api/src` 下每个目录都归到插件或登记过的内核目录（`dishes` 归菜谱）；门面接口只在 contracts、登记进 `PluginFacades`、实现只在提供方目录注册一次；`dependsOn` == 代码里取用的门面；钩子名单与 payload 只在 contracts，发起方 == 钩子名前缀的插件，只能以所在插件的名义订阅，`hooks` == 代码里订阅的钩子，每个钩子有发起方和订阅方，写死顺序只列订阅方；插件事件名只在 contracts、只有前缀插件能发。逐条故意改坏、跑一遍、再从备份还原（还原后工作区与改坏前一致）：加回一条跨目录 import、漏声明 / 多声明 `dependsOn`、漏注册一个钩子订阅、订阅了没声明、发起不存在的钩子、冒充别的插件订阅、在 api 里定义门面接口、在非提供方目录注册门面、写死顺序里列非订阅方、在 api 里重定义钩子 payload、新加没归类的目录——12 条都报错。

**演示栈升级（2026-10-06，J1b 合完后）**：`4ed0746` → `eaaef2e`，`upgrade-prod.sh --no-pull`，无新迁移（仍 74 个）。「升级前提交」由脚本从运行中 api 镜像的 `org.opencontainers.image.revision` 标签读出（标签路径第一次生效，与实际一致）。回滚镜像标签 `prod-before-20261006-210401`，升级前备份 `backups-production/20261006-130403Z`；升级后 api / web / backup-worker 三个镜像的标签都是 `eaaef2e`。检查（King 授权的演示栈只读查询）：20 张业务表行数与迁移数前后一致；四个服务与 API Node 时区为上海；`/api/health/ready` ok；今天、家里、点菜、厨房、购物、库存、资产、地图、积分、日历、任务、提醒、智能家居、小管家 14 个页面 200，新 bundle 含 `smart-home.link-fired` / `tasks.completed` / `tasks.uncompleted` 与内核工具标签；智能家居 `smart_home_live mode=push`，API 容器到 HA 401（网络通）；API 日志无 error、无 5xx、没有门面 / 钩子注册类报错；事件流无令牌 401。人工走查（资产记维护看库存出库、任务打勾看积分、触发联动看建出的任务）要用 King 本人的账号、要往演示栈写数据，执行者不做，留给 King。

### 9.4 与指令不一样的地方

1. 门面方法名按今天真实的调用收口：任务门面是 `listOccurrences(start, end, actor)`（指令写 `listForCalendar(householdId, range)`；日历今天调的是 `TasksService.list(start, end, user)`，智能家居也用它），日历门面是 `listEntries`。
2. 资产维护记出库原来调库存的 `createTransaction` + `applyBatchConsumption` 两个方法、传 TypeORM 实体；contracts 不能带实体，收成一个 `consumeForMaintenance`、传普通值的出库行，流水 id 仍由资产预先生成写进耗材快照。建流水对象时的数量校验从「维护记录写入前」挪到「写入后」，同一事务，落库结果一致。
3. 钩子多了一张 `TRANSACTION_HOOK_ORDER`：`smart-home.link-fired` 的提醒订阅方要读刚建的家务行，不写死顺序就只能靠模块初始化顺序。
4. `smart-home.link-fired` 只在要建东西时发；扫完打勾是同步调用，走任务门面 `completeOccurrence`。家务 id 由智能家居预先生成（通知、提醒要挂在它上面），任务的 `createWithinTransaction` 加了可选 `id` 参数。
5. 积分订阅方写回任务实例表上的两列（`pointsAwardVersion` / `pointsLedgerId`）：列在任务表上，J1b 不动表，照旧由积分维护。
6. 内核表 11 → 12：来源表从 `agent-tools.service.ts` 搬到 `core-assistant.ts`，清单与派生的 `CORE_TOOL_SOURCES` 两张都登记。
7. 打勾事件订阅方出错时的告警由 `task_completed_listener_failed task=<id>`（`TaskEvents`）变为 `plugin_event_listener_failed event=tasks.completed`（`EventBus`）。

### 9.5 没解的（不在 J1b 范围）

1. **实体层的跨插件读写**（共享 `entities` 文件，不经插件目录 import，check-plugins 查不到；实体拆目录本就不在 J1 / J1b 范围，§8.5）：日历直读点菜 / 观影 / 访客 / 资产维护计划 / 旅行；提醒的来源解析直读家务 / 菜单 / 投票 / 维护计划 / 旅行 / 日程；资产直读并锁库存物品、读库存流水，维护缺口加购物项、取消维护提醒直接写购物 / 提醒的表；库存的菜单扣库、买到入库直读菜单与购物项；积分写任务实例的两列。
2. **内核（助理 `agent` 目录）→ 插件服务的 import** 还在（`agent-tools` / `agent-proposals` / `agent-routine` / `agent-location-tools` / `agent.module`）：J1b 只管插件之间，J4 重建 agent 时改走门面。
3. 数据库里的引用照旧（§8.7 第 8 条）。

## 进度表

| 任务 | 状态 | 提交 | 备注 |
| --- | --- | --- | --- |
| J0 盘点与 manifest 草稿 | ☑ | 见本次合并 | 结果见 §8；§8.6 五项已拍板 |
| J1 插件注册表（18 域） | ☑ | 见 §8.7 | 18 / 18 个插件都有 manifest，14 处登记里插件的条目全部由 manifest 导出，check-plugins 全量断言；剩余手写项与 J1b 输入见 §8.7 末尾；J1.7 合完后升演示栈 |
| J1b 跨插件解耦 | ☑ | 见 §9 | 插件目录之间零 import（check-plugins 断言）；门面 6 个、事务内钩子 3 个、插件事件 1 个，manifest 的 `dependsOn` / `hooks` 与代码一致；assistant 内核工具清单收进 `core-assistant.ts`；实体层的跨插件读写与内核（agent）→ 插件的 import 不在范围，见 §9「没解的」；演示栈随本批升级，人工走查由 King 本人做 |
| J2 助理数据与开关 | ☑ | 见 §8.8 | `assistant_utterances` 表与接口、三档开关、⌘K 原话落表；演示栈随本批升级，King 本人去 ⌘K 输几句再看「原话记录」做人工验收 |
| J3 第 0 档引擎 | ☐ | | 等试用原话；补点菜 ⌘K 动作时收掉 manifest 顶层 `proposals`（见 §4 J3 一行） |
| J4 agent 重建 | ☐ | | |
| J5 本地模型档 | ☐ | | |
| J6 收口 | ☐ | | |
