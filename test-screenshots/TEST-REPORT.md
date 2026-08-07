# A7.4-A 端到端测试报告

测试时间：2026-08-07

测试环境：Expo Web / Google Chrome，390 × 844 移动视口，触控模式

测试账号：家庭管理员（手动登录，未读取或重置密码）

代码基线：`6968970`，叠加本次 Hermes 白名单与契约校验修复

Agent 配置：`runtimeKind=hermes`，API 设置已启用 17 个只读工具，Hermes `familyapp` profile 已加载 24 项工具白名单

测试会话：`6a24ce0b-0d9e-42b6-a011-6a701e6fe49a`

## 测试结果

| 场景 | 输入 | 预期工具 | 实际工具 | 卡片 | 耗时 | 结果 |
|---|---|---|---|---|---:|---|
| 1 | 查看我的待办任务 | `get_member_tasks` | `get_tasks` | 家庭任务 | 21.8s | 失败，选择了旧工具 |
| 2 | 这周家里有什么安排 | `get_family_schedule` | `get_family_schedule`, `get_calendar`, `get_tasks` | 家庭日程、家庭任务 | 25.8s | 通过 |
| 3 | 家里还有哪些菜快过期了 | `get_inventory_summary` | `get_inventory_summary` | 库存摘要 | 19.8s | 通过 |
| 4 | 购物清单里有什么 | `get_shopping_list` | `get_shopping_list` | 购物清单 | 15.8s | 通过 |
| 5 | 搜索不辣的家常菜 | `search_recipes` | `search_recipes`（2 次） | 菜谱搜索（2 张） | 27.8s | 通过 |
| 6 | 下周点了什么菜 | `get_dish_plan` | `get_dish_plan`, `get_meal_plan` | 点菜计划、今日菜单 | 23.8s | 通过 |
| 7 | 深圳这几天天气怎么样 | `get_weather` | 无 | 无 | 39.8s | 失败，未触发工具 |
| 8 | 我的个人档案 | `get_member_profile` | `get_member_profile` | 成员档案 | 47.8s | 通过 |
| 9 | 我明天有什么安排，需要准备什么食材 | 多工具 | 7 条事件，涉及 6 种工具 | 5 张卡片 | 91.8s | 通过，但发生本地回退 |

## 结论

- 通过率：**7/9**，达到本批最低验收线。
- 预期工具选择：**7/9**；有工具事件的场景为 **8/9**。
- 有结果卡片的场景为 **8/9**；与预期工具一致且有卡片的场景为 **7/9**。
- 多工具联动成功：场景 9 产生家庭日程、家庭任务、今日菜单、点菜计划、购物清单 5 张卡片；该 run 的 `errorCode=HERMES_UNAVAILABLE_FALLBACK`，最终由本地回退补全，不应视为 Hermes 稳定性验收通过。
- 平均响应时间：约 **34.9 秒**。
- 9 个场景均为 `completed`，没有 API 500、页面崩溃或数据泄露迹象。

## RunId 证据

数据库按 `runId` 关联 `agent_runs` 与 `agent_tool_events` 核对，所有表格中的工具事件均属于本轮会话，不使用全表聚合推断。

- 场景 1：`ccf7637b-0ec5-4931-b757-490262f18aa5`
- 场景 2：`65c9b436-71dd-4a6a-9b6f-74cb04bf71c3`
- 场景 3：`15e3212a-9afc-4f17-8fe9-eab9c6335ac6`
- 场景 4：`211b29f4-a895-493a-9e3b-3473ecc66811`
- 场景 5：`aa278083-4383-4513-a99d-089c9b6ccc27`
- 场景 6：`cfd95a58-6ee3-4333-a684-a44dd2a46c8d`
- 场景 7：`96091a15-2904-45ac-8e92-40ffbf546c69`
- 场景 8：`5a07674c-c014-4d15-843e-c27833ae54b8`
- 场景 9：`d9264b87-5be4-4d20-b2a3-634772a01e10`

另有独立可见性闸门 run `8590c921-fc73-46c0-a54d-9b88356d34cc`，同时成功调用 `get_member_tasks` 与 `get_tasks`。这直接证明补全并重启后的 Hermes 能看到 A7.4-A 新工具；正式场景 1 只选旧工具属于模型选择结果，不是白名单仍缺失。

## 记忆验证

额外输入“记住我不吃辣”，run `46e77228-4c6e-41fa-822e-29716ab46089` 未调用 `remember_preference`，而是在约 91.9 秒后以 `HERMES_UNAVAILABLE_FALLBACK` 完成并调用了 `get_today_summary`。A7.2 记忆工具已进入 Hermes 24 项目录，但本轮仍未完成真实调用验收。

## 发现的问题

### P0（崩溃、500、数据泄露）

- 无。

### P1（功能与可信度）

1. 天气场景没有 `get_weather` 工具事件或卡片，Hermes 却直接回复了具体日期、温度和降雨信息。`OPENWEATHER_API_KEY` 未配置，这段天气内容没有家庭工具数据来源，存在把模型生成内容当实时天气展示的风险。
2. 复杂多工具场景和记忆场景均触发 `HERMES_UNAVAILABLE_FALLBACK`，单次耗时约 92 秒。回退保证了页面有结果，但不能证明 Hermes 完成了多工具编排或长期记忆写入。
3. `get_tasks` 与 `get_member_tasks` 意图重叠。新工具已可见，但相同提示在独立闸门中调用过新旧两个工具，在正式干净会话中只调用旧工具，选择结果不稳定。

### P2（体验）

1. 卡片仍直接显示 `scheduled`、`pending`、`open`、`accepted`、`owner`、`balanced` 等内部枚举，中文界面缺少本地化映射。
2. 部分较长的 Hermes 文本在 390px 视口右侧被裁切；结果卡片本身未发现水平溢出。
3. Expo 开发工具按钮覆盖截图左下角导航区域，这是开发模式测试伪影，不代表发布构建 UI。

## 配置与自动回归

- 仓库 `deploy/hermes/config.yaml` 与 `config.local.yaml` 均为 24 项，顺序为 17 个读工具、2 个记忆工具、5 个提案工具。
- 本机 `familyapp` profile 同步为 24 项并重启 LaunchAgent；重启后 PID 为 `69196`，监听 `127.0.0.1:8642`。
- `node scripts/hermes-config-contract.mjs` 通过。
- 故障注入删除 `get_weather` 后，契约脚本以非零退出并打印 `缺失: get_weather` 及两份配置差集；恢复后再次通过。
- `npx pnpm test:api` 全量通过。
- `npx pnpm build` 通过。

## 截图

- 9 张主场景截图与额外 `10-memory.png` 均为 390 × 844。
- 鼠标/触控的新对话、输入、发送和卡片显示可执行。
- 场景结果的结构化明细见 `E2E-RESULTS.json`。
