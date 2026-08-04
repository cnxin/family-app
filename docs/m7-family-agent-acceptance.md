# M7-A4 家庭智能体首批验收

> 实施分支：`uitest`
> 范围：M7-A4.1 只读 Agent 基础、M7-A4.2 App 内“问问小管家”、M7-A4.3 操作提案确认与 M7-A4.4 消息渠道绑定

## 已实现

- M7-A4.4 已实现 provider-agnostic 消息渠道绑定层；本批只提供 Family App 管理 API 和 Hermes 内部接口，不宣称真实 Telegram、Discord 或 NAS 网关已接通。

- NestJS 新增可替换 `AgentRuntime`，包含确定性 `FakeAgentRuntime` 与 Hermes OpenAI 兼容适配器。
- 新增标准 Streamable HTTP MCP：Hermes 只可调用家庭摘要、日历、低库存、知识库、出行清单、观影候选和最近回忆七个只读工具。
- MCP 同时校验内部 Bearer 密钥和五分钟短时 `runId`；家庭、成员和工具白名单均由服务器端运行记录确定。
- 新增有序迁移 `AddFamilyAgent1785230700000`（第 44 个），建立设置、对话、加密消息、运行与不可变工具审计五张表；`synchronize` 继续为 `false`。
- 对话正文使用独立 `AGENT_DATA_KEY` 进行 AES-256-GCM 加密。生产未配置数据密钥时默认不启用对话，不回退到明文保存。
- 发送消息使用家庭级客户端幂等键，运行异步排队；支持明确取消，已取消运行不会被迟到回答覆盖。
- Hermes 未配置或暂时离线时，运行自动回退到本地家庭摘要并向用户标明，不影响其他家庭功能和 `/health/ready`。
- Expo Mobile/Web 新增“问问小管家”独立页面、首页入口和管理员桌面侧栏入口，包含历史对话、建议问题、发送、停止、失败、离线和降级状态。
- 管理员可启停功能并选择本地摘要或 Hermes；普通成员可使用但不能修改运行时设置。
- 核心按钮不小于 44px，鼠标和触控均可操作，不依赖快捷键。
- 新增任务、提醒、投票、菜单和购物清单五个 MCP 提案工具；工具只保存结构化提案，不执行业务写入。
- 新增有序迁移 `AddAgentActionProposals1785230800000`（第 45 个），状态包含 `pending / confirmed / executed / rejected / expired / failed`。
- 新增有序迁移 `AddAgentChannelBindings1785230900000`（迁移序号 49）和 `NormalizeAgentChannelPairingIndex1785231000000`（迁移序号 50），建立 `agent_member_channels`、`agent_channel_pairings`，并允许对话来源为 `app / channel`。
- 新增有序迁移 `LinkAgentMessagesToRuns1785231100000`（迁移序号 51），assistant 消息按 `runId` 精确关联，连续渠道消息不会串回答。
- 提案保存家庭、来源运行、创建/确认成员、白名单载荷、预计变化、请求指纹、创建与确认幂等键、版本、过期时间和执行结果。
- 确认使用事务行锁和预期版本，业务创建与提案执行结果在同一事务提交；并发双击和接口重试只产生一次业务变化。
- 确认时重新加载当前成员角色、家庭设置和来源资源，并调用原有任务、提醒、投票、菜单和购物 service。
- 对话页新增提案确认带，展示预计变化、警告以及待确认、执行中、已执行、已放弃、已过期和失败状态。
- 购物提案只能新增自由名称购物项，不直接修改库存；后续仍需在购物页明确关联库存并确认入库。
- Hermes 使用官方 `main` 多架构清单的不可变 digest `sha256:9fdeb877ec279fee2d431a4458015ea97eb3f7f784bf059f96b81423b1f60b9f`，Docker Hub 标签 API 已确认同时包含 `linux/amd64` 与 `linux/arm64`。

## 安全边界

- Hermes 不连接 PostgreSQL，不持有用户 JWT，不读取 Plex/MoviePilot 密钥。
- 可选 `docker-compose.agent.yml` 不挂载 Docker Socket、源码、上传、备份、家庭数据或个人 `~/.hermes`。
- Hermes API Server 的 `platform_toolsets.api_server` 只包含 `family_app` MCP；终端、文件、浏览器、记忆和任意网络工具不会进入该入口。
- 知识正文、回忆内容和业务备注均按不可信数据处理；工具审计只记录数量、范围和结果状态，不复制正文。
- 工具事件由 PostgreSQL 触发器保护为不可更新、不可删除。
- 操作提案历史由独立 PostgreSQL 触发器禁止删除；失败只保存错误码和面向用户的脱敏说明，不保存堆栈或模型密钥。

## API 契约

```text
GET    /agent/status
GET    /agent/settings
PUT    /agent/settings
GET    /agent/conversations
POST   /agent/conversations
GET    /agent/conversations/:id
DELETE /agent/conversations/:id
POST   /agent/conversations/:id/messages
POST   /agent/runs/:id/cancel
POST   /agent/proposals/:id/confirm
POST   /agent/proposals/:id/reject
GET    /agent/channels
GET    /agent/channel-pairings
POST   /agent/channel-pairings
POST   /agent/channel-pairings/:id/revoke
POST   /agent/channels/:id/revoke
POST   /internal/agent/mcp
POST   /internal/agent/channels/pair
POST   /internal/agent/channels/:channelId/messages
GET    /internal/agent/channels/:channelId/runs/:runId
```

`GET` 和 `DELETE /internal/agent/mcp` 固定返回 405。MCP 不经过普通 `{ data }` 包装，保持标准 JSON-RPC 响应。

## 回归矩阵

- API：角色权限、家庭隔离、停用成员、消息幂等、取消与迟到结果、Hermes 离线降级。
- MCP：错误内部密钥、过期运行、工具白名单、未知工具和不可变审计。
- 内容安全：恶意知识正文不会进入工具摘要、回答或审计。
- 提案：重复生成、结构化载荷白名单、五类执行、重复确认、并发确认、旧版本、过期、放弃和失败状态。
- 权限：创建成员隔离、家庭隔离、管理员关闭提案工具后的确认失败，以及确认时重新检查当前资源。
- 历史：提案删除被数据库拒绝；没有安全撤销契约的创建操作不显示撤销。
- 数据库：空库迁移、当前开发库备份后迁移、结构漂移检查。
- 前端：普通成员手机入口，管理员手机/桌面入口，鼠标点击、触控目标、无横向溢出和运行状态。
- 构建：API/Mobile TypeScript、Expo lint、Web export、Docker Compose 解析、API 镜像构建与 Hermes 固定清单核验。

## M7-A4.3 验收步骤

1. 在小管家输入 `创建任务：整理冰箱 YYYY-MM-DD`，等待回答与操作提案同时出现。
2. 核对标题、日期、负责人和积分预览，点击“放弃”，确认状态变为“已放弃”且任务未创建。
3. 再生成一项任务并点击“确认执行”，确认状态变为“已确认并执行”，任务页只出现一次。
4. 快速重复点击或重放相同确认请求，确认仍返回同一执行结果，不新增第二条任务。
5. 分别生成投票、菜单、购物和关联现有事项的提醒提案，确认后在对应模块核对结果。
6. 对过期、来源已结束或管理员已关闭工具的提案尝试确认，核对明确失败状态且没有部分业务写入。
7. 在 390 x 844 触控视口与 1440 x 900 鼠标视口检查按钮、换行、暗色模式和横向溢出。

## 本次验证说明

- 新迁移已在当前开发库应用；空库迁移演练、结构漂移和全量 API 回归均通过。
- API 回归覆盖五类提案、并发与重复确认、版本冲突、放弃、过期、权限变化、成员隔离和不可删除历史。
- 开发与生产 Compose 叠加解析通过，开发 API 镜像已重建并健康运行，`/agent/status` 已加载且要求登录。
- Chrome 在 390 x 844 手机视口使用真实登录态完成任务提案生成与放弃流程；确认和放弃按钮均为 112 x 44，页面 `scrollWidth` 为 390，放弃后状态正确变为“操作提案 · 已放弃”。
- 实测发现横向对话选择器在手机端会纵向拉伸并遮挡后续聊天区域；已增加独立 56px 会话栏、固定滚动区域、`minHeight: 0` 收缩约束和层级，避免聊天卡顶出可视区域；修复后 API/Mobile TypeScript、Expo lint 与 Web export 均通过。
- 小管家专项 Playwright 回归 5/5 通过：隔离管理员登录、390 x 844 触控、1440 x 900 鼠标、提案生成与放弃状态，以及页面无横向溢出；全量浏览器回归曾有 30 项通过、2 项失败，随后聚焦重跑 `family-navigation.spec.ts` 为 5/5，失败与本批改动无关。
- 本轮在 8082 重跑时管理员移动用例 1/1 通过；桌面用例第一次因已有异步运行状态使发送按钮暂时禁用而超时，重跑时保存的登录态已过期回到登录页。普通成员 setup 仍因未提供当前密码而未完成；没有重置或读取账号密码。
- 本机 Hermes 已使用临时隔离配置和运行时密钥完成真实链路：隔离 API 3199 先启动后，Hermes 8642 发现 12 个 Family App MCP 工具，`get_today_summary` 工具事件为 `completed`，回答成功写回加密对话；测试数据库已删除，未读取或重置现有账号密码。
- 本次只验证本机 Hermes；NAS/Docker Hermes 的镜像拉取、容器网络与健康检查仍待部署批次完成，不影响当前 API/Web 服务。

## M7-A4.4 验收步骤

1. 管理员在“小管家”页面选择家庭成员和渠道标识，点击“生成一次性配对码”；确认列表接口不会再次返回明文配对码。
2. 使用内部渠道凭据提交配对码和外部账号摘要，确认绑定到指定成员；重复提交同一账号返回同一绑定，换账号或换家庭不能越权。
3. 通过内部渠道消息接口发送查询，确认运行状态完成、工具白名单只有只读工具，写意图不会绕过 App 提案确认。
4. 撤销绑定后再次发送消息应返回 403；停用成员、错误内部凭据、过期配对码和重复幂等键均返回明确错误。
5. 在 390 x 844 触控视口与 1440 x 900 鼠标视口检查渠道管理按钮、成员选择、状态反馈和横向溢出。

## 后续批次

M7-A4.5 完成 Hermes 生产容器网络和出口加固。长期主动任务、访客采纳、敏感生活数据和没有明确撤销契约的自动撤销仍不在本批范围。
