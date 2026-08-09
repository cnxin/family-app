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
- 完整 Mobile Web 回归受既有“妈妈”账号登录失败阻塞，结果为 2 passed、1 failed、45 not run；未修改密码或重新 seed。独立响应式回归为 1 passed。

### 真实 Hermes 回归

| 范围 | 结果 | 说明 |
|---|---:|---|
| A7.4-A 主场景 | 9/9 | 全部 `runtimeKind=hermes`，回落数 0，多工具场景通过 |
| A7.2 记忆 | 2/2 | `remember_preference` 写入候选，`recall_preferences` 召回已确认的同键偏好 |
| A7.3 页面上下文 | 2/2 | 有上下文按当前菜品回答；清除后明确追问 |
| A7.5 组提案 | 0/1 | 未调用 `propose_plan`，也未调用旧单提案工具 |

组提案场景输入“周六爸妈来吃饭”后，Hermes 真实运行 104.2 秒，无回落；模型调用日程、点菜、菜单、成员档案、库存、偏好和菜谱共 7 类只读工具，随后追问具体餐次、人数和忌口，没有创建组提案。该结果不是工具不可见，也不是拆分调用旧 `propose_*`，而是模型在信息不足时选择先澄清。按照本批约定，没有继续试探工具描述或改 system prompt。结构化明细见 `E2E-RESULTS.json`，页面证据见 `14-proposal-group.png`。
