# 家庭长期运行部署

这套配置把 Expo Web 导出为静态文件，由 Caddy 提供 HTTPS 并将同源 `/api` 请求转发给 NestJS。PostgreSQL 和 API 只在 Docker 内部网络可见，生产编排不会运行演示种子任务。

## 1. 前置条件

- 一台长期在线、已安装 Docker Compose 的主机。
- 使用公网域名时，将 DNS 指向该主机并开放 TCP 80/443 和 UDP 443；Caddy 会自动申请和续期证书。
- 不准备直接开放公网时，优先通过 Tailscale、WireGuard 等 VPN 访问。局域网 HTTP 仅适合部署演练，不能承载真实会话。
- 在升级或迁移前，先确认数据库和附件已经生成可校验的备份。

## 2. 创建本地生产配置

仓库根目录执行：

```bash
cp deploy/.env.production.example deploy/.env.production
mkdir -p deploy/secrets
openssl rand -base64 48 > deploy/secrets/db_password.txt
openssl rand -hex 64 > deploy/secrets/jwt_secret.txt
openssl rand -hex 32 > deploy/secrets/bootstrap_secret.txt
openssl rand -base64 32 > deploy/secrets/integration_secret.txt
openssl rand -base64 32 > deploy/secrets/agent_data_key.txt
chmod 600 deploy/.env.production deploy/secrets/*.txt
```

编辑 `deploy/.env.production`：

- `SITE_ADDRESS` 填实际域名，例如 `family.example.com`；Caddy 会自动启用 HTTPS。
- `CORS_ORIGINS` 填完整来源，例如 `https://family.example.com`。多个来源用逗号分隔。
- `APP_VERSION` 建议使用发布版本或 Git 提交短哈希，不要长期依赖 `latest`。
- 根据主机内存调整资源限制。默认值适合小型家庭实例的起点，不等于容量承诺。
- `integration_secret.txt` 用于加密数据库中的家庭连接凭据，必须独立备份且在恢复数据库时一并恢复。丢失或错误轮换会使已有家庭凭据无法解密。
- `agent_data_key.txt`（**生产必需**，不再只属于 Hermes）用 AES-256-GCM 加密小管家的对话正文和云端服务商 key（J4.3 起）。`docker-compose.prod.yml` 直接引用它：文件不存在 API 起不来，升级脚本会先检查。和 `integration_secret.txt` 一样必须独立备份、恢复数据库时一并恢复；丢失或直接轮换会导致已有对话和服务商 key 无法解密。

可选媒体连接器：

- `PLEX_BASE_URL`、`EMBY_BASE_URL`、`MOVIEPILOT_BASE_URL` 填 API 容器可访问的 NAS 地址，不要填写带 `/web/index.html` 或 Token 的浏览器详情页链接。
- Plex 使用 `PLEX_TOKEN_FILE`，Emby 使用 `EMBY_API_KEY_FILE`，MoviePilot v2 使用 `MOVIEPILOT_API_KEY_FILE`。建议统一放在 `/run/integration-secrets/`，该目录由编排只读挂载。
- `MEDIA_PRIMARY_LIBRARY=plex` 或 `emby` 只设置默认播放入口；Plex 与 Emby 可以同时启用。
- 上述变量是所有家庭的服务器默认值。家庭管理员可在“家庭观影 -> 观影设置 -> 媒体服务”建立家庭覆盖、切换主媒体库并测试连接；家庭凭据使用 `integration_secret.txt` 加密，界面与 API 不回显明文。
- 例如先创建 `deploy/secrets/plex_token.txt`，再设置 `PLEX_TOKEN_FILE=/run/integration-secrets/plex_token.txt`。密钥文件权限保持 `600`。
- API 镜像以内置 `node` 用户（UID 1000）运行。在 Linux/NAS 上应将连接器密钥文件属主设为 UID 1000，或使用只授予该 UID 读取权限的 ACL；不要通过放宽为全员可读来绕过权限问题。启动后用连接器状态接口确认文件可读。

可选智能家居（Home Assistant，H3）：

- `HOME_ASSISTANT_BASE_URL` 默认 `http://host.docker.internal:8123`（HA 跑在同一台宿主机上；编排给 API 加了 `host.docker.internal:host-gateway`，Linux/NAS 上也能解析）。**宿主机 8123 被别的程序占用时**（`lsof -nP -iTCP:8123 -sTCP:LISTEN` 能看到非 Docker 的进程），把 HA 的端口映射改成别的端口（如 `8124:8123`），这里同步写 `http://host.docker.internal:8124`；家庭在设置页单独填过地址的，那条地址也要一起改。注意宿主机 `curl localhost:8123` 可能走 IPv6 绕过占用者，看起来是通的，要在 API 容器里测。
- `HOME_ASSISTANT_TOKEN_FILE` 默认 `/run/integration-secrets/home_assistant_token.txt`，即 `deploy/secrets/home_assistant_token.txt`，放 HA 的长期访问令牌，权限 `600`、属主规则同媒体连接器。**文件不存在时只是「没配」**，API 照常启动；写入后不用重启，下次请求就会读到。
- 同样是服务器默认值；家庭管理员可在「家庭设置 → 智能家居」填自己的地址和令牌（加密存库、不回显）。所有对 HA 的调用 3 秒超时，HA 挂了只影响智能家居那一页。
- 控制（E2）：`HOME_ASSISTANT_COMMAND_TIMEOUT_MS` 默认 8000——HA 要等 service 执行完才回，石头、米家这类云端设备常要好几秒；超时只算这一次失败并记进审计。
- 状态推送（E2）：API 对每个「连好 HA 且白名单非空」的家庭常驻一条 HA WebSocket（订阅 `state_changed`），变化经 `/events` 推给页面；断了退回每 `SMART_HOME_POLL_MS`（默认 30000）拉一次 `/api/states`，同时按 `SMART_HOME_RECONNECT_MIN_MS`～`SMART_HOME_RECONNECT_MAX_MS`（5 秒～60 秒）退避重连。反代不用额外配置：这条连接是 API 容器主动连 HA。

- HA → 小管家（E3）：HA 的自动化用 `rest_command` 打 `POST /api/smart-home/webhook/<householdId>`，请求头带时间戳与签名（`sha256(密钥 + sha256(密钥 + 时间戳 + "." + 原始请求体))`，HA 模板没有 HMAC，只能这样算）。密钥在「家庭设置 → 智能家居 → 联动」生成，旧密钥轮换后宽限 24 小时；那一页会生成可直接粘贴的 `configuration.yaml` 与自动化 YAML。**HA 必须能访问到小管家的地址**（同机的 Docker 里用宿主机局域网 IP 或 `host.docker.internal:8088`），该端点公开但只认签名。

可选影视元数据：

- TMDB 推荐配置 `TMDB_API_TOKEN_FILE`，也兼容 `TMDB_API_KEY_FILE`；Bangumi 匿名搜索默认可用，长期部署应填写能识别当前实例的 `BANGUMI_USER_AGENT`。
- 豆瓣没有稳定的官方公共影视搜索 API。`DOUBAN_API_BASE_URL` 只能指向自行审核、限权的兼容桥接服务，不应复用 MoviePilot 管理端账号或 API Key。
- 三个来源会独立超时和降级，任何来源不可用都不会阻断家庭片单与手动录入。完整变量和豆瓣响应契约见 [M4-E 三源影视搜索验收](m4-media-search-acceptance.md)。
- 元数据凭据同样优先使用 `/run/integration-secrets/` 下的 `*_FILE`，文件权限规则与媒体连接器一致。
- 服务器变量是所有家庭的默认值。家庭管理员也可在“家庭观影 -> 观影设置 -> 搜索数据源”建立家庭覆盖；其 Token 使用 `integration_secret.txt` 进行 AES-256-GCM 加密，界面和 API 均不回显明文。

Native 小管家不需要额外的 Compose 叠加文件。基础生产编排已经通过
`AGENT_DATA_KEY_FILE=/run/secrets/agent_data_key` 提供数据加密密钥；各家庭在“小管家设置”里保存的云端服务商 key
也使用这把密钥加密。不要在未迁移已有密文时直接更换 `agent_data_key.txt`。

Hermes 兼容运行时（仅 J4.6 下线前可选）：

```bash
openssl rand -hex 32 > deploy/secrets/agent_mcp_key.txt
openssl rand -hex 32 > deploy/secrets/agent_runtime_key.txt
chmod 600 deploy/secrets/agent_*.txt
```

- `agent_data_key.txt` 已由基础生产编排挂载，这里不用再建。
- `agent_mcp_key.txt` 只用于 Hermes 到 Family App MCP 的容器内认证，`agent_runtime_key.txt` 只用于 Family App 到 Hermes API Server 的认证，不能复用家庭账号、JWT 或媒体连接器密钥。
- 模型密钥通过 `HERMES_OPENAI_API_KEY` 或部署环境的 Secret 管理注入 Hermes，不写入仓库、Compose 文件或日志。

本机开发可使用独立 Hermes profile，不覆盖个人默认配置：

```bash
hermes profile create familyapp --no-skills
node scripts/setup-local-hermes-secrets.mjs
familyapp gateway install --start-now --start-on-login
docker compose -f docker-compose.dev.yml -f docker-compose.local-agent.yml up -d --no-deps --force-recreate api
```

`deploy/hermes/config.local.yaml` 只为 API Server 启用 Family MCP；`docker-compose.local-agent.yml` 让容器内 API 通过 `host.docker.internal:8642` 连接本机 Hermes。脚本只在 profile 尚无配置时写入模板，并只生成缺失密钥；重复执行不会轮换现有密钥。切换模型提供方时，应同步调整该 profile 的 `model` 配置和所需的单个提供方凭据，不要复制个人消息渠道配置。
- Hermes 是 J4.6 前保留的兼容服务，不启用 `docker-compose.agent.yml` 不影响 Native 小管家、家庭平台或 `/health/ready`。在收集连续一周 Native 实测证据并满足 J4.6 验收条件前，保留该兼容编排及密钥。

环境文件和 `deploy/secrets/` 已被 Git 忽略。数据库密码、JWT 密钥、首户初始化密钥、集成加密密钥以及连接器令牌不得提交到仓库，也不得写入镜像构建参数。轮换 JWT 密钥会使所有现有登录立即失效；集成加密密钥不能在未迁移现有密文时直接轮换。

## 3. 校验并启动

```bash
docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml config --quiet

docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml build

docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml up -d
```

### 3.1 启用 Native 小管家

上面的基础生产命令已经部署 Native 运行时所需的 API 和 `AGENT_DATA_KEY_FILE`，启用 Native 无需叠加
`docker-compose.agent.yml`。使用具有家庭管理权限的账号完成以下设置：

1. 从“家庭设置”进入“小管家设置”，或在“问问小管家”页面点“设置”。
2. 打开“云端助理（第 2 档）”，选择云端服务商，保存模型地址、模型名和 key。试用期间保留“只对管理员开放”，并按需要确认每日上限和“发出前脱敏”。
3. 点“测一下”，确认状态为“测通了”。只要服务商、地址、模型或 key 有变化，就要重新测试。
4. 在“谁来回答”中选择“小管家自带”。后端会拒绝在云端模型未测通时切换到该运行方式。
5. 回到“问问小管家”，确认标题下显示“小管家自带 · 服务商”，再发送一条实际问题验证回答与工具事件。页面显示“暂时连不上”时先检查家庭服务商配置，不要通过启动 Hermes 来代替 Native 配置。

全新数据库的 `runtimeKind` 默认仍为 `fake`（“本地摘要”），因此部署完成不会自动开始向云端服务商发送内容。服务商 key
只通过家庭设置保存，API 仅返回是否已配置和末四位；它不需要写入服务器环境文件。

### 3.2 保留 Hermes 兼容运行时

只有仍需验证或回退到 Hermes 时，才将兼容叠加文件加入相同命令：

```bash
docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml \
  -f docker-compose.agent.yml config --quiet

docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml \
  -f docker-compose.agent.yml up -d
```

生产环境不会发布 Hermes API 或 Dashboard 端口。Compose 已固定官方多架构清单 digest；首次启用前仍应在目标主机实际拉取并完成健康检查，再在家庭平台后台选择 Hermes。运行时不可用会回退到本地只读摘要。

**启用 Hermes 必须显式选择该运行方式：** 即使 Hermes 容器、密钥和 MCP 健康检查全部正常，管理员仍需在“小管家设置”的“谁来回答”中选择“Hermes”。如果跳过这一步，对话仍会使用默认的本地摘要。新环境验收必须把运行时选择与 Hermes/MCP 健康检查分开验证。

首次启动会在空数据库上执行 TypeORM 迁移，但不会创建“爸爸/妈妈”等演示数据。打开站点后，初始化页面要求填写家庭名称、首位管理员、登录账号、至少 8 位密码，以及 `deploy/secrets/bootstrap_secret.txt` 中的初始化密钥。初始化使用数据库事务与互斥锁，只有数据库完全未建户时可成功一次；之后同一密钥不能再创建家庭。

首位所有者可在“我的 -> 成员邀请”生成 48 小时邀请码。邀请码只在创建响应中出现明文，服务端只保存摘要；领取、过期或撤销后不能复用。`owner/admin` 可以创建和撤销邀请，普通成员不能管理邀请。

已有家庭数据应先从经过校验的备份恢复。账号迁移会为每个现有成员建立独立账号，账号名默认沿用成员名，重复名称追加数字后缀，并把原 PIN 哈希迁入账号。没有 PIN 的旧账号可暂时用空密码登录，随后必须在“账号安全”补设密码。需要核对迁移生成的账号名时，可执行：

```bash
docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml exec db \
  psql -U family -d family_app \
  -c 'SELECT "loginName" FROM accounts ORDER BY "createdAt";'
```

健康检查：

```bash
curl https://family.example.com/api/health/live
curl https://family.example.com/api/health/ready
```

`live` 只确认 API 进程可响应，`ready` 还会执行数据库探测。成功的健康轮询默认不写 API 访问日志，失败仍会记录请求 ID 和状态。

## 4. 网络与安全边界

- 宿主机只映射 Caddy 的 80/443；PostgreSQL 与 API 没有宿主机端口。API 同时接入无入站端口的 `integrations` 网络，以便主动访问 NAS 上的媒体服务。
- Caddy 为前端和 API 设置基础安全响应头；关闭含客户端地址和完整 URI 的访问日志，只保留轮转后的运行与错误日志。
- 前端产物只有 `index.html` 和带内容哈希的 `/assets/*`：`/assets/*` 存在的文件返回 `Cache-Control: public, max-age=31536000, immutable`，不存在的直接 404（不回退到 index.html，前端靠它判断发版后旧分块失效并整页刷新一次）；`index.html` 返回 `no-cache`，每次用 ETag 回源校验。
- API 只记录请求 ID、路由模板、状态、耗时和账号/成员/家庭 UUID，不记录请求体、查询值、姓名、IP、密码或令牌。
- `TRUST_PROXY_HOPS=1` 只信任紧邻 API 的 Caddy。改变代理层数时必须同步调整，不能使用无边界的代理信任。
- Web 会话当前仍保存在 `localStorage`，因此 HTTPS 不能消除 XSS 风险。对外开放前应保持依赖更新，并评估改用同站 `HttpOnly` Cookie。

## 5. 备份与更新

服务运行且健康时执行：

```bash
./scripts/backup-prod.sh
```

备份包含 PostgreSQL 自定义格式导出、上传附件压缩包、迁移与 Git 版本清单及 SHA-256 校验和，默认写入 `backups-production/`。数据库、JWT 和初始化密钥文件故意不进入业务备份，必须另存一份加密保护的副本。至少保留一个不在当前主机上的备份，并定期在空数据库中演练恢复。

更新用 `./scripts/upgrade-prod.sh`：给当前镜像打回滚标签 → 备份 → `git pull --ff-only` → 构建 → 带超时启动（API 启动时执行迁移）→ 健康检查 → 清理旧回滚标签（只留最近 2 组），任一步失败即停。需要 Docker Compose ≥ 2.20。第一次升级、回滚的三种情形和升级后确认见 [deploy-c2.md](deploy-c2.md)。

```bash
./scripts/upgrade-prod.sh
```

宿主机磁盘满会让 Docker 引擎崩掉并丢失容器（镜像和卷不丢），恢复步骤见 `deploy-c2.md` §3 情形 D；Mac mini 上用 `scripts/demo-stack-watchdog.sh` + launchd 每 5 分钟探一次并自动拉起（§5）；平时留意 `df -h`，数据盘剩余不到 20 GB 就清缓存。

不要使用 `docker compose down -v`；该命令会删除生产数据库、附件和 Caddy 证书卷。恢复时先创建独立空数据库并用 `pg_restore --list` 和校验和检查备份，禁止直接覆盖仍在运行的生产库。
