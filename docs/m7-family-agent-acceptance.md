# M7-A4 家庭智能体首批验收

> 实施分支：`uitest`
> 范围：M7-A4.1 只读 Agent 基础与 M7-A4.2 App 内“问问小管家”

## 已实现

- NestJS 新增可替换 `AgentRuntime`，包含确定性 `FakeAgentRuntime` 与 Hermes OpenAI 兼容适配器。
- 新增标准 Streamable HTTP MCP：Hermes 只可调用家庭摘要、日历、低库存、知识库、出行清单、观影候选和最近回忆七个只读工具。
- MCP 同时校验内部 Bearer 密钥和五分钟短时 `runId`；家庭、成员和工具白名单均由服务器端运行记录确定。
- 新增 44 号有序迁移，建立设置、对话、加密消息、运行与不可变工具审计五张表；`synchronize` 继续为 `false`。
- 对话正文使用独立 `AGENT_DATA_KEY` 进行 AES-256-GCM 加密。生产未配置数据密钥时默认不启用对话，不回退到明文保存。
- 发送消息使用家庭级客户端幂等键，运行异步排队；支持明确取消，已取消运行不会被迟到回答覆盖。
- Hermes 未配置或暂时离线时，运行自动回退到本地家庭摘要并向用户标明，不影响其他家庭功能和 `/health/ready`。
- Expo Mobile/Web 新增“问问小管家”独立页面、首页入口和管理员桌面侧栏入口，包含历史对话、建议问题、发送、停止、失败、离线和降级状态。
- 管理员可启停功能并选择本地摘要或 Hermes；普通成员可使用但不能修改运行时设置。
- 核心按钮不小于 44px，鼠标和触控均可操作，不依赖快捷键。
- Hermes 使用官方 `main` 多架构清单的不可变 digest `sha256:9fdeb877ec279fee2d431a4458015ea97eb3f7f784bf059f96b81423b1f60b9f`，Docker Hub 标签 API 已确认同时包含 `linux/amd64` 与 `linux/arm64`。

## 安全边界

- Hermes 不连接 PostgreSQL，不持有用户 JWT，不读取 Plex/MoviePilot 密钥。
- 可选 `docker-compose.agent.yml` 不挂载 Docker Socket、源码、上传、备份、家庭数据或个人 `~/.hermes`。
- Hermes API Server 的 `platform_toolsets.api_server` 只包含 `family_app` MCP；终端、文件、浏览器、记忆和任意网络工具不会进入该入口。
- 知识正文、回忆内容和业务备注均按不可信数据处理；工具审计只记录数量、范围和结果状态，不复制正文。
- 工具事件由 PostgreSQL 触发器保护为不可更新、不可删除。

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
POST   /internal/agent/mcp
```

`GET` 和 `DELETE /internal/agent/mcp` 固定返回 405。MCP 不经过普通 `{ data }` 包装，保持标准 JSON-RPC 响应。

## 回归矩阵

- API：角色权限、家庭隔离、停用成员、消息幂等、取消与迟到结果、Hermes 离线降级。
- MCP：错误内部密钥、过期运行、工具白名单、未知工具和不可变审计。
- 内容安全：恶意知识正文不会进入工具摘要、回答或审计。
- 数据库：空库迁移、当前开发库备份后迁移、结构漂移检查。
- 前端：普通成员手机入口，管理员手机/桌面入口，鼠标点击、触控目标、无横向溢出和运行状态。
- 构建：API/Mobile TypeScript、Expo lint、Web export、Docker Compose 解析、API 镜像构建与 Hermes 固定清单核验。

## 本次验证说明

- 44 个迁移的空库演练、全量 API 回归、当前开发库结构漂移、API/Mobile TypeScript、Expo lint、API 构建和 Web export 均通过。
- 开发与生产 Compose 叠加解析通过，开发 API 镜像已重建并健康运行，`/agent/status` 已加载且要求登录。
- 旧浏览器刷新会话失效，手机与桌面 Agent 登录态用例均被正确重定向到登录页；未读取或重置密码，因此登录后的浏览器流程未完成。
- Docker Hub 标签 API 已验证固定清单和 arm64 镜像；Docker Registry 连接在本机代理链上发生 TLS 超时或重置，Hermes 镜像实际拉取与容器健康检查尚未完成。Hermes 未启动不影响本地摘要和 `/health/ready`。

## 后续批次

首批不含写操作。M7-A4.3 再增加任务、提醒、投票、菜单和购物提案，并要求用户查看预计变化后明确确认；消息渠道、长期主动任务和敏感生活数据仍不在本批范围。
