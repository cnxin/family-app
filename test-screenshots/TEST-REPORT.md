# A7.4-A 遗留问题端到端测试报告

测试时间：2026-08-08

测试环境：Expo Web / Google Chrome，390 × 844 移动视口，触控模式

测试账号：家庭管理员（复用现有登录态，未读取或重置密码）

代码基线：`1706321`，叠加本次工作区修复

Agent 配置：`runtimeKind=hermes`，API 已启用 17 个只读工具，Hermes `familyapp` profile 已加载 24 项工具白名单

主场景会话：`cb5ac754-dc09-4137-bb93-13ea33344fd9`

记忆专项会话：`4cba646d-da3c-47b8-bd66-2877c4b37ab7`

## 结果纠正

上一版报告的 `7/9` 判定不成立：场景 1 自身为失败，场景 9 使用 `HERMES_UNAVAILABLE_FALLBACK`，其工具事件来自 FakeAgentRuntime，不能证明模型参与。按“回落即失败”规则，修复前真实结果为 **6/9**。

真实 Hermes E2E 现已把 `passed` 从明细动态汇总；每条记录均包含 `runtimeKind`、`errorCode`、`durationMs`。任何 `HERMES_UNAVAILABLE_FALLBACK` 都会标记为“回落，模型未参与”并判失败。

## 最终结果

| 场景 | 输入 | 实际工具 | 卡片 | 耗时 | 结果 |
|---|---|---|---|---:|---|
| 1 | 查看我的待办任务 | `get_member_tasks` | 成员任务 | 25.4s | 通过 |
| 2 | 这周家里有什么安排 | `get_family_schedule` | 家庭日程 | 8.6s | 通过 |
| 3 | 家里还有哪些菜快过期了 | `get_inventory_summary` | 库存摘要 | 8.6s | 通过 |
| 4 | 购物清单里有什么 | `get_shopping_list` | 购物清单 | 23.2s | 通过 |
| 5 | 搜索不辣的家常菜 | `search_recipes`（2 次） | 菜谱搜索（2 张） | 34.8s | 通过 |
| 6 | 下周点了什么菜 | `get_dish_plan` | 点菜计划 | 13.8s | 通过 |
| 7 | 深圳这几天天气怎么样 | `get_weather` | 天气服务尚未配置 | 18.3s | 通过，安全降级 |
| 8 | 我的个人档案 | `get_member_profile` | 成员档案 | 11.3s | 通过 |
| 9 | 我明天有什么安排，需要准备什么食材 | `get_meal_plan`, `get_member_tasks`, `get_shopping_list`, `search_recipes` | 菜单、任务、购物、菜谱 | 102.7s | 通过，多工具联动 |

- 通过率：**9/9**。
- 9 个 run 均为 `runtimeKind=hermes`、`errorCode=null`，回落数为 **0**。
- 9 个场景均产生预期工具事件和结构化卡片。
- 平均响应时间约 **27.4 秒**。
- 天气工具返回 `weather_api_not_configured` 的友好展示；回答只说明服务未配置，没有输出任何具体温度、降水量或降水概率。

## RunId 证据

所有工具事件均按 `runId` 关联 `agent_runs` 与 `agent_tool_events`，未使用全表聚合推断。

- 场景 1：`c72e5bb5-9634-4680-9297-7f98e8367fe3`
- 场景 2：`667cf3de-937b-4906-9bad-f944c61600fe`
- 场景 3：`d2798150-e258-403a-ac34-a90bdc0d964e`
- 场景 4：`5a60d905-a92e-4f8b-abe9-37163e56307d`
- 场景 5：`c14bb5cd-12f5-410d-9b4c-c7c339d7195a`
- 场景 6：`5ea4a7bb-5f9f-4f49-b64e-24692e3fafce`
- 场景 7：`403b671c-9e6c-42c8-85bf-7879823d76b4`
- 场景 8：`63ed438a-4221-4a1f-9ec5-a2726f3a97a1`
- 场景 9：`9463abe2-584a-46cc-83a2-b13625f48881`

独立可见性闸门 run `8590c921-fc73-46c0-a54d-9b88356d34cc` 同时调用过 `get_tasks` 和 `get_member_tasks`，证明新工具对 Hermes 可见。正式场景通过工具描述消歧，针对“我的待办”只调用 `get_member_tasks`。

## 记忆验证

| 输入 | 实际工具 | runId | 耗时 | 结果 |
|---|---|---|---:|---|
| 记住我不吃辣 | `remember_preference` | `bb57211f-c06b-4372-adb4-fa8108ac8f41` | 26.0s | 通过 |
| 我有什么饮食偏好 | `recall_preferences` | `fd67b7f9-1cfd-4af2-9701-d222168e8c24` | 13.9s | 通过 |

两条 run 均为 Hermes、无回落。数据库只核对元数据：写入产生一条 `candidate`、`scope=member_private`、`memoryKey=spice_level` 的 `agent_memory_items`；`ownerMemberId` 与 run 发起成员一致，家庭归属一致，来源为对应 `agent_tool` run。正文密文未读取或输出。

## 超时取舍

- Hermes chat 超时从 90 秒调整为 **180 秒**。
- 工具授权 TTL 保持 **300 秒**。
- 两者保留 **120 秒**授权余量，避免把请求超时问题变成运行中途授权过期。
- Expo 发送消息接口只创建 queued run 并立即返回，客户端随后轮询状态，不存在更短的长连接 HTTP 超时先行中断。
- 新增静态契约，要求 chat 超时固定为 180 秒且至少保留 60 秒授权余量。

## 自动回归

- `hermes-config-contract.mjs` 校验 Hermes 两份配置与 24 个代码工具一致。
- `agent-tools.mjs` 校验天气唯一数据源约束、成员/家庭任务边界，以及个人记忆候选无需范围追问。
- `agent-hermes-live.spec.ts` 负责真实 Hermes -> MCP 链路、回落判定、动态汇总、天气数字防编造和记忆工具验证；默认跳过，需显式设置 `HERMES_LIVE_E2E=1`。
- 截图与结构化明细见本目录 11 张 PNG 和 `E2E-RESULTS.json`。

实际验收结果：Hermes 配置契约通过；API build 通过；全量 API 回归在 65.3 秒内通过；Mobile TypeScript 与 Expo lint 通过；真实 Hermes 9 个主场景和 2 个记忆场景全部通过。

## 已知残留

- 390px 视口下，较长的助手纯文本消息仍会在右侧裁切。该问题在旧报告中已存在，与本批工具选择、超时和回落判定无关，留待聊天布局批次修复。
- 截图左下角的 Expo 开发工具按钮会覆盖少量导航区域，这是开发模式测试伪影，不代表发布构建界面。
