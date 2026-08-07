# A7.4-A 端到端测试报告

测试时间：2026-08-07

测试环境：Expo Web / Google Chrome，390 × 844 移动视口，触控模式

测试账号：家庭管理员（手动登录，未读取或重置密码）

代码版本：`35cce56`（A7.4-A 功能提交：`5623004`）

Agent 配置：`runtimeKind=hermes`，设置版本 17，已启用 17 个只读工具

## 测试结果

| 场景 | 输入 | 预期工具 | 实际工具 | 运行状态 | 卡片 | 截图 | 结果 |
|---|---|---|---|---|---|---|---|
| 1 | 查看我的待办任务 | `get_member_tasks` | 无 | completed | 无 | `01-tasks.png` | 失败 |
| 2 | 这周家里有什么安排 | `get_family_schedule` | 无 | completed | 无 | `02-schedule.png` | 失败 |
| 3 | 家里还有哪些菜快过期了 | `get_inventory_summary` | 无 | completed | 无 | `03-inventory.png` | 失败 |
| 4 | 购物清单里有什么 | `get_shopping_list` | 无 | completed | 无 | `04-shopping.png` | 失败 |
| 5 | 搜索不辣的家常菜 | `search_recipes` | 无 | completed | 无 | `05-recipes.png` | 失败 |
| 6 | 下周点了什么菜 | `get_dish_plan` | `get_today_summary` | completed | 无 | `06-dish-plan.png` | 失败，选错旧工具 |
| 7 | 深圳这几天天气怎么样 | `get_weather` | 无 | completed | 无 | `07-weather.png` | 失败 |
| 8 | 我的个人档案 | `get_member_profile` | 无 | completed | 无 | `08-profile.png` | 失败 |
| 9 | 我明天有什么安排，需要准备什么食材 | 多工具 | 无 | completed | 无 | `09-multi-tool.png` | 失败 |

## 结论

- 通过率：**0/9**
- 正确工具选择：**0/9**
- 结果卡片渲染：**0/9**
- 多工具联动：失败
- 平均响应时间：约 **53.2 秒**
- 9 个运行均为 `completed`，没有 API 500、页面崩溃或数据泄露迹象。
- 9 个运行全部绑定到干净会话 `34f3fb00-e008-473d-8ea0-e601f44adc85`；逐个 `runId` 与数据库核对结果见 `E2E-RESULTS.json`。

## 发现的问题

### P0（崩溃、500、数据泄露）

- 无。

### P1（阻塞 A7.4-A 验收）

1. Hermes 页头显示“已连接”，但新工具没有进入实际可调用工具集。8 个单工具场景中，7 个完全没有 `agent_tool_events`；唯一一次调用发生在场景 6，且错误选择了旧工具 `get_today_summary`。
2. 小管家多次回复 Family App 数据服务或 MCP 不可用。数据库中对应运行仍标记为 `completed`，导致运行状态看似成功，但用户拿不到家庭实时数据。
3. 由于没有正确工具事件，8 种新卡片及多工具卡片全部未渲染，A7.4-A 端到端能力当前不可用。

### P2（体验与文档）

1. 失败回答反复建议等待一到两分钟或重新连接，但 API、Web 和数据库均健康，且运行已经结束；提示无法帮助用户定位 Hermes MCP 工具目录或桥接配置问题。
2. 新工具尚未加入前端 `TOOL_LABELS`，即使后续成功调用，处理中状态也只会显示笼统的“家庭资料查询”。
3. 原测试指令中的数据库示例已漂移：实际表为 `household_tasks`、`calendar_events`、`shopping_items`，库存到期日位于 `inventory_batches.expiresOn`，`readToolsEnabled` 为 `jsonb`。本次未执行过时 SQL。

## 测试数据

使用固定 UUID 幂等补充了以下带“端到端测试”标记的数据，没有删除或覆盖现有数据：

- 爸爸的两项未来待办
- 明天和后天的两项家庭日程
- 低库存且 7 天内到期的牛奶库存及批次
- 当天待购的西红柿购物项
- 可匹配“不辣”查询的家庭菜谱
- 明天和下周的菜单及点菜项

## 视觉检查

- 9 张截图均为 390 × 844。
- 鼠标/触控的新对话、输入和发送操作可执行。
- 页头、消息区、输入区和底部导航未发现相互遮挡或水平溢出。
- 因工具链失败，本轮无法验收结果卡片的真实内容与跳转。

## 配置说明

- `OPENWEATHER_API_KEY` 未配置；正常情况下场景 7 应由 `get_weather` 返回友好的“天气服务尚未配置”卡片。
- 本轮 `get_weather` 未被调用，因此该降级路径未能完成端到端验证。
