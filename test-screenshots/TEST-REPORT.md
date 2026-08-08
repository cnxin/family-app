# A7.4-A 回归修复与 A7.3 真实 Hermes 测试报告

测试时间：2026-08-08

测试环境：Expo Web / Google Chrome，390 x 844 移动视口，触控模式

测试账号：`爸爸`（空密码登录，未修改账号或重新 seed）

代码基线：`2fc9dd6`，叠加本次任务 1 工作区修复

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

截图与结构化明细见本目录 13 张 PNG 和 `E2E-RESULTS.json`。所有工具事件按 `runId` 关联，没有使用全表聚合推断。

## 待处理

- 390px 视口下较长助手文本的右侧裁切，以及最窄屏提案按钮布局，将在独立的任务 2 commit 中修复并补多视口回归。
