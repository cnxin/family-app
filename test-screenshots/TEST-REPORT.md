# A7.4-A 回归修复、A7.3 与小管家响应式测试报告

测试时间：2026-08-08

测试环境：Expo Web / Google Chrome，390 x 844 移动视口，触控模式

测试账号：`爸爸`（空密码登录，未修改账号或重新 seed）

代码基线：`2fc9dd6`，叠加任务 1 提交 `e43e9f3` 与任务 2 UI 修复

Agent 配置：`runtimeKind=hermes`，API 已启用 17 个只读工具，Hermes `familyapp` profile 已加载 24 项工具白名单

## 修复策略

采用工具描述粒度的方案：保留 A7.3 条件页面上下文片段，从全局 system prompt 移除“指代不明时追问”的无条件约束，并把规则收窄到 `search_recipes`。仅当用户指代单个菜品、又没有具体菜名或页面上下文时追问；“我的任务”“家里的库存”“搜索不辣家常菜”等范围查询继续直接调用对应工具。

记忆验收补齐真实产品流程：`remember_preference` 创建候选后，按写入 run 的 `source.id` 找到候选，调用确认 API 置为 `active`，再执行 `recall_preferences`。

## A7.4-A 主场景

| 场景 | 输入 | 实际工具 | 耗时 | 结果 |
|---|---|---|---:|---|
| 1 | 查看我的待办任务 | `get_member_tasks` | 13.5s | 通过 |
| 2 | 这周家里有什么安排 | `get_family_schedule`, `get_calendar`, `get_tasks` | 22.8s | 通过 |
| 3 | 家里还有哪些菜快过期了 | `get_inventory_summary` | 12.8s | 通过 |
| 4 | 购物清单里有什么 | `get_shopping_list`（2 次） | 10.5s | 通过 |
| 5 | 搜索不辣的家常菜 | `search_recipes`（2 次） | 10.8s | 通过 |
| 6 | 下周点了什么菜 | `get_dish_plan` | 7.4s | 通过 |
| 7 | 深圳这几天天气怎么样 | `get_weather` | 22.8s | 通过，安全降级 |
| 8 | 我的个人档案 | `get_member_profile` | 28.8s | 通过 |
| 9 | 我明天有什么安排，需要准备什么食材 | `get_family_schedule`, `get_dish_plan`, `get_meal_plan`, `get_shopping_list` | 53.4s | 通过，多工具联动 |

- 通过率：**9/9**，平均响应时间约 **20.3 秒**。
- 9 个 run 均产生工具事件和结构化卡片，`runtimeKind=hermes`、`errorCode=null`，回落数为 **0**。
- 天气服务未配置时调用了 `get_weather`，回答只说明服务不可用，没有输出具体天气数字。
- 主场景会话：`aa703480-b809-404e-a80d-a92a1e27f315`。

## 记忆工具

| 输入 | 实际工具 | runId | 耗时 | 结果 |
|---|---|---|---:|---|
| 记住我不吃辣 | `remember_preference` | `7ac24144-6722-4285-ad89-5e538034249a` | 15.3s | 通过 |
| 确认候选 | `POST /agent/memories/:id/confirm` | 对应写入 run 的候选 | - | 通过，状态变为 `active` |
| 我有什么饮食偏好 | `recall_preferences`, `get_member_profile` | `c893dcd6-f320-44fb-a14e-d9ad6ccebb01` | 7.4s | 通过 |

两条 Agent run 均为 Hermes、无回落。召回发生在确认之后，验证的是已确认记忆检索链路，不再依赖同一会话前文制造假通过。

## A7.3 页面上下文

| 场景 | 实际行为 | runId | 耗时 | 结果 |
|---|---|---|---:|---|
| 从菜品详情询问“这道菜需要什么食材” | 调用 `search_recipes`，按当前菜品回答 | `aa7e15d2-7d2c-4605-9a29-c756a292c958` | 16.5s | 通过 |
| 清除上下文后再次询问同一句 | 不调用搜索工具，明确追问具体菜名 | `81f3a0a9-e4e2-45f3-b581-e651620ff207` | 5.1s | 通过 |

A7.3 专项结果为 **2/2**。两条 run 均为 Hermes、无回落；范围查询恢复的同时，单菜品无上下文时的诚实追问仍然成立。

## 自动回归

- API 全量回归：通过，62.8 秒。
- API build：通过。
- Mobile TypeScript：通过。
- Expo lint：通过。
- 真实 Hermes 全套：1 passed，267.7 秒。
- `git diff --check`：通过。

任务 1 截图与结构化明细见本目录 01-13 PNG 和 `E2E-RESULTS.json`。所有工具事件按 `runId` 关联，没有使用全表聚合推断。

## 小管家移动端响应式修复

- 助手与用户消息气泡增加 `flexShrink: 1`、`minWidth: 0`，头像固定不收缩；保留消息正文自动换行和宽屏 `maxWidth: 680`。
- compact 布局的提案按钮改为纵向、等宽排列，按钮仍保持至少 44pt 高；提案变更值增加 `minWidth: 0`，长任务说明可换行。
- 补充关键容器 testID 和独立 mock session，响应式回归不依赖 Hermes、真实 Agent 数据或真实账号状态。

### 逐项实测

| 项目 | 实测结果 | 代码处理 |
|---|---|---|
| 助手消息与用户消息 | 320/375/390/414px 均在视口内，长正文完整换行，无右侧裁切 | 修复气泡收缩约束 |
| 结果卡片 | 四档竖屏和 390px 横屏无横向溢出，标题与详情按既有规则截断 | 实测正确，未改动 |
| `ToolProgress` | 320px 下完整显示，内部文案正常收缩 | 实测正确，未改动 |
| 页面上下文提示 | 四档竖屏、横屏、暗色模式均无溢出，清除按钮为 44 x 44pt | 实测正确，未改动 |
| 提案变更与操作区 | 320px 长说明正常换行；放弃/确认按钮纵向、等宽、不重叠，均不小于 44pt | 修复值列收缩和 compact 操作布局 |
| 会话历史 | 320px 长标题、时间和归档操作未撑出容器；`maxWidth=560` 弹层自适应 | 实测正确，未改动 |
| 助理设置 | 320px `maxWidth=640` 弹层自适应，关闭按钮不少于 44pt | 实测正确，未改动 |
| 输入区 | 四档竖屏、横屏和暗色模式无溢出，发送按钮不少于 44pt | 实测正确，未改动 |
| 记忆列表与详情 | 320/375/390/414px 均无页面横向滚动 | 已有 `flex: 1` / `minWidth: 0` 正确，未改动 |
| 暗色与减少动态 | 390 x 844 下使用真实暗色调色板并启用 reduced motion，无布局退化 | 实测正确，未改动 |

横屏的消息可视区高度约 96px，无法在同一帧同时容纳完整长回复与完整结果卡片；横屏截图聚焦结果卡片，同时自动化仍分别验证长消息气泡和结果卡片都在横向边界内。

### 响应式截图

- `14-assistant-320.png`：320 x 568，长回复尾部与结果卡片。
- `15-assistant-375.png`：375 x 667，长回复与结果卡片。
- `16-assistant-390.png`：390 x 844，常见 iPhone 宽度完整布局。
- `17-assistant-414.png`：414 x 896，大屏手机完整布局。
- `18-assistant-390-landscape.png`：844 x 390 横屏，结果卡片与输入区。
- `19-assistant-390-dark.png`：390 x 844 暗色模式 + reduced motion。
- `20-assistant-320-proposal.png`：320 x 568，纵向提案操作按钮。

### 响应式自动化

- `agent-responsive.mock.spec.ts`：1 passed，17.0 秒（完整 `test:web` 中）。
- 覆盖聊天气泡、结果卡片、页面上下文、提案、工具进度、会话历史、设置弹层、输入区，以及记忆列表/详情四档宽度。
- 所有目标页面均断言 `scrollWidth <= clientWidth`；关键交互控件额外断言不少于 44 x 44pt。
- Mobile Web 全量回归：41 passed、7 skipped，4.1 分钟；真实 Hermes 用例按环境开关跳过。

## A7.5 多步骤家庭协调提案（2026-08-09）

本批新增全有或全无的多步骤提案：一次 `propose_plan` 最多创建 8 个子提案，成员只能整组确认或整组放弃；任一步执行失败时事务整体回滚，并在独立事务中保留脱敏的 `failed` 元数据事件。既有独立提案仍保持 `groupId=NULL`、`stepOrder=NULL`。

- Hermes 两份仓库配置与本机 `familyapp` profile 均加载 25 个工具，`propose_plan` 对模型可见。
- API 全量回归、结构漂移检查、API build、Mobile TypeScript、Expo lint 均通过。
- 响应式专项通过，覆盖 320/375/390/414px 的组提案卡片、纵向 44pt 操作按钮、过期后禁用确认且保留全部放弃。
- 开发库在存在 group、事件和子项数据时完成 `migration:run -> migration:revert -> migration:run`；迁移后既有 10 条独立提案的新列均为 `NULL`。
- 完整 Mobile Web 回归恢复为 43 passed、8 skipped、0 failed，51 项全部调度，没有 `not run`；未修改密码或重新 seed。
- “妈妈”登录阻塞不是 A7.4-B/A7.5 产品回归：`dcaa85b` 增加第三个登录 setup 后，与 `5ba76d4` 遗留的默认密码优先候选顺序叠加，6 次请求超过 `LOGIN_RATE_LIMIT=5`；A7.3 `772610a` 的鉴权恢复 fixture 还会轮换公共 refresh token。当前改为无密码优先、复用已成功候选，并用独立会话验证刷新与退出撤销；UI 质量文件在同一 worker 上下文内保留轮换后的会话。
- A7.5 组提案会连续调用多类家庭查询，旧 180 秒 chat 上限两次在 5 至 7 次工具调用后精确回落。现调整为 chat 240 秒、工具授权 300 秒，保留契约要求的 60 秒余量；移动端没有更短的 HTTP/Abort 超时。

### 真实 Hermes 回归

| 范围 | 结果 | 说明 |
|---|---:|---|
| A7.4-A 主场景 | 9/9 | 全部 `runtimeKind=hermes`，回落数 0，多工具场景通过 |
| A7.2 记忆 | 2/2 | `remember_preference` 写入候选，`recall_preferences` 召回已确认的同键偏好 |
| A7.3 页面上下文 | 2/2 | 有上下文按当前菜品回答；清除后明确追问 |
| A7.5 组提案 | 1/1 | 走路径 (a)：`propose_plan` 生成 5 个组内子项，无回落 |

组提案输入改为明确周六晚餐、总计 5 人、来访爸爸不吃辣且其他人无忌口，并明确要求菜单、购物和准备任务。Hermes 真实运行 222.8 秒，先查询点菜、购物、库存和菜谱，再调用 `propose_plan` 创建 5 个子项，结构化结果记录 `proposalPath="a"`。本轮完整真实回归的 9 个主场景、2 个记忆场景、2 个页面上下文场景和 1 个组提案场景全部为 Hermes、回落数 0；没有修改工具 description、system prompt 或 Fake runtime。结构化明细见 `E2E-RESULTS.json`，页面证据见 `14-proposal-group.png`。

## A6.1 信息架构收敛最终验收（2026-08-10）

本节是 A6.1 的最终结果；上文 8 月 8 日和 A7.5 各节保留为历史批次记录，不代表本轮耗时、工具选择或授权参数。

测试环境：Expo Web / Google Chrome，390 x 844 移动视口，触控模式。测试账号仍为 `爸爸` 空密码账号，没有修改密码、重新 seed 或覆盖开发数据。最终结构化结果的 `commitBase` 为 `A6.1-final-working-tree`。

### A7.4-A 主场景

| 场景 | 实际工具 | 耗时 | 结果 |
| --- | --- | ---: | --- |
| 查看我的待办任务 | `get_member_tasks` | 37.0s | 通过 |
| 这周家里有什么安排 | `get_family_schedule`, `get_tasks` | 19.9s | 通过 |
| 家里还有哪些菜快过期了 | `get_inventory_summary` | 14.1s | 通过 |
| 购物清单里有什么 | `get_shopping_list`（2 次） | 27.4s | 通过 |
| 搜索不辣的家常菜 | `search_recipes`（3 次） | 52.7s | 通过 |
| 下周点了什么菜 | `get_dish_plan` | 14.5s | 通过 |
| 深圳这几天天气怎么样 | `get_weather` | 6.9s | 通过，未配置时安全降级 |
| 我的个人档案 | `get_member_profile` | 9.7s | 通过 |
| 我明天有什么安排，需要准备什么食材 | `get_family_schedule`, `get_meal_plan` | 14.1s | 通过，多工具联动 |

主场景为 **9/9**，平均 21.8 秒；9 个 run 均为 `runtimeKind=hermes`、`errorCode=null`，均产生工具事件和结构化卡片，`fallbackCount=0`。

### 记忆、上下文与组提案

| 范围 | 实际行为 | 结果 |
| --- | --- | ---: |
| 记忆写入 | `remember_preference` 创建候选，随后由测试确认 | 通过 |
| 记忆召回 | `recall_preferences` 召回已确认的个人偏好 | 通过 |
| 菜品有页面上下文 | `search_recipes` 按当前菜品回答 | 通过 |
| 菜品无页面上下文 | 不调用工具，明确追问具体菜名 | 通过 |
| 知识文章无页面上下文 | 不调用 `search_knowledge`，要求文章正文、链接或标题 | 通过 |
| 家庭晚餐组提案 | 路径 (a)，调用 `propose_plan` 生成 4 个子项 | 通过 |

记忆 **2/2**、页面上下文与反向断言 **3/3**、组提案 **1/1**，全部由 Hermes 完成且无回落。`travel` 的反向约束没有计入通过数：专项曾追问，但完整运行中仍可能默认选择首项，最终已按刹车规则回退，详见审核文档附录八。

### 页面入口与响应式证据

- 家庭资产、知识库、出行、投票四页的「问小管家」入口均紧跟页头，位于筛选和主体内容之前；底部小管家 tab 保留。
- 320/375/390/414px 四视口验证入口不少于 44px、文本可收缩、页面无横向溢出，点击后 URL 只携带经过设计的 `route`。
- `a61-assets-390.png`、`a61-knowledge-390.png`、`a61-travel-390.png`、`a61-polls-390.png` 为四个页面的 390 x 844 真实截图。
- `15-no-knowledge-context.png` 为新增知识库反向断言的最终真机证据；01-14 PNG 和 `E2E-RESULTS.json` 均来自本轮最终运行。

### 最终自动验收

- API 全量回归：通过，约 63.4 秒。
- schema 漂移检查：实体与迁移一致；本批无迁移。
- API build：通过。
- Mobile TypeScript 与 Expo lint：通过。
- Mobile Web 全量：**43 passed / 8 skipped / 0 failed**，51 项全部得到明确结果，没有 `not run`。
- Hermes 配置契约：两份 yaml 各 25 项，均与代码常量一致。
- Agent 运行时契约：chat 240000ms、授权 360000ms、余量 120000ms。
- 真实 Hermes 全套：1 passed，398.3 秒；工具 9/9、记忆 2/2、页面上下文 3/3、组提案 1/1、回落 0。
- `git diff --check`：通过。

## Hermes 波动验收加固（2026-08-10，未闭环）

本批将 `get_shopping_list` 和 `recall_preferences` 的中性描述改为场景级强约束，并增加通用防线：没有任何工具事件却直接给出家庭数据结论时判定失败。购物清单约束后的九个只读场景为 9/9；记忆约束后的两轮为 8/9 和 7/9，失败场景均已调用正确工具，但在 240 秒发生 `HERMES_UNAVAILABLE_FALLBACK`，没有发现 description 引起的错工具回归。

真机场景现在最多尝试 3 次，只在 `HERMES_UNAVAILABLE_FALLBACK` 时等待 30 秒并开启新会话重试。错工具、未调工具编造或其他非回落能力错误立即失败。每条结果记录 `attempts`、`attemptDurationsMs`、`attemptRunIds` 和 `attemptErrorCodes`；汇总记录 `totalAttempts`、`totalRetries` 和 `fallbackAttemptCount`。产品 chat 超时仍为 240000ms，测试框架总预算提高到 4 小时以容纳最坏情况下的重试。

### 本轮真机结果

| 场景 | attempts | 每次耗时 | 结果 |
| --- | ---: | --- | --- |
| 查看我的待办任务 | 1 | 113.045s | 通过 |
| 这周家里有什么安排 | 1 | 100.276s | 通过 |
| 家里还有哪些菜快过期了 | 1 | 146.174s | 通过 |
| 购物清单里有什么 | 1 | 113.105s | 通过，调用 `get_shopping_list` |
| 搜索不辣的家常菜 | 1 | 112.752s | 通过 |
| 下周点了什么菜 | 1 | 128.086s | 通过 |
| 深圳这几天天气怎么样 | 1 | 103.738s | 通过，未配置时安全降级 |
| 我的个人档案 | 1 | 96.354s | 通过 |
| 明天安排与食材 | 1 | 110.119s | 通过，多工具联动 |
| 家庭晚餐组提案 | 2 | 240.110s / 231.984s | 第一次回落，第二次路径 (a) 通过并生成 4 个子项 |
| 记住我不吃辣 | 1 | 60.024s | 通过，测试候选已清理 |
| 我有什么饮食偏好 | 1 | 135.087s | 通过，调用 `recall_preferences` |
| 菜品页面上下文 | 1 | 98.823s | 通过 |
| 资产页面上下文 | 1 | 34.737s | 失败：诚实说明资产详情工具不可用，但未复述上下文资产名称 |

已执行 14 个场景，共 **15 次 attempts、1 次重试、1 次 fallback attempt**。A7.4-A 为 9/9、记忆为 2/2、组提案为 1/1；页面上下文执行到资产场景时因非回落能力错误停止，后续无上下文菜品和知识文章场景未运行。按规则没有重试该资产场景，也没有放宽 `requiredText` grounding 断言。失败运行生成的截图与 `E2E-RESULTS.json` 已还原到 HEAD，未作为验收结果提交。

资产夹具通过 `POST /assets` 创建并直接使用返回 ID，`finally` 通过 `PATCH /assets/:id` 将其归档；执行后 `active_assets=0`。当前产品 API 没有 `DELETE /assets/:id`，所以不能实现指令所说的“删除且不留测试数据”，本轮留下 1 条 retired 测试资产及对应审计记录，没有选择或修改用户已有资产。

### 自动回归

- API 全量：通过，63.6 秒；schema 无漂移；API build 通过。
- Hermes 配置契约：两份 yaml 各 25 项；运行时契约仍为 chat 240000ms、授权 360000ms、余量 120000ms。
- Mobile TypeScript 与 Expo lint：通过。
- Mobile Web 首轮为 42 passed / 8 skipped / 1 failed，鉴权恢复用例观察到 3 次 refresh；专项复跑通过，间隔登录限流窗口后完整复跑为 **43 passed / 8 skipped / 0 failed / 0 not run**，未修改该断言。
