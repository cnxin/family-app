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
chmod 600 deploy/.env.production deploy/secrets/*.txt
```

编辑 `deploy/.env.production`：

- `SITE_ADDRESS` 填实际域名，例如 `family.example.com`；Caddy 会自动启用 HTTPS。
- `CORS_ORIGINS` 填完整来源，例如 `https://family.example.com`。多个来源用逗号分隔。
- `APP_VERSION` 建议使用发布版本或 Git 提交短哈希，不要长期依赖 `latest`。
- 根据主机内存调整资源限制。默认值适合小型家庭实例的起点，不等于容量承诺。
- `integration_secret.txt` 用于加密数据库中的家庭连接凭据，必须独立备份且在恢复数据库时一并恢复。丢失或错误轮换会使已有家庭凭据无法解密。

可选媒体连接器：

- `PLEX_BASE_URL`、`EMBY_BASE_URL`、`MOVIEPILOT_BASE_URL` 填 API 容器可访问的 NAS 地址，不要填写带 `/web/index.html` 或 Token 的浏览器详情页链接。
- Plex 使用 `PLEX_TOKEN_FILE`，Emby 使用 `EMBY_API_KEY_FILE`，MoviePilot v2 使用 `MOVIEPILOT_API_KEY_FILE`。建议统一放在 `/run/integration-secrets/`，该目录由编排只读挂载。
- `MEDIA_PRIMARY_LIBRARY=plex` 或 `emby` 只设置默认播放入口；Plex 与 Emby 可以同时启用。
- 例如先创建 `deploy/secrets/plex_token.txt`，再设置 `PLEX_TOKEN_FILE=/run/integration-secrets/plex_token.txt`。密钥文件权限保持 `600`。
- API 镜像以内置 `node` 用户（UID 1000）运行。在 Linux/NAS 上应将连接器密钥文件属主设为 UID 1000，或使用只授予该 UID 读取权限的 ACL；不要通过放宽为全员可读来绕过权限问题。启动后用连接器状态接口确认文件可读。

可选影视元数据：

- TMDB 推荐配置 `TMDB_API_TOKEN_FILE`，也兼容 `TMDB_API_KEY_FILE`；Bangumi 匿名搜索默认可用，长期部署应填写能识别当前实例的 `BANGUMI_USER_AGENT`。
- 豆瓣没有稳定的官方公共影视搜索 API。`DOUBAN_API_BASE_URL` 只能指向自行审核、限权的兼容桥接服务，不应复用 MoviePilot 管理端账号或 API Key。
- 三个来源会独立超时和降级，任何来源不可用都不会阻断家庭片单与手动录入。完整变量和豆瓣响应契约见 [M4-E 三源影视搜索验收](m4-media-search-acceptance.md)。
- 元数据凭据同样优先使用 `/run/integration-secrets/` 下的 `*_FILE`，文件权限规则与媒体连接器一致。
- 服务器变量是所有家庭的默认值。家庭管理员也可在“家庭观影 -> 数据源设置”建立家庭覆盖；其 Token 使用 `integration_secret.txt` 进行 AES-256-GCM 加密，界面和 API 均不回显明文。

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
- API 只记录请求 ID、路由模板、状态、耗时和账号/成员/家庭 UUID，不记录请求体、查询值、姓名、IP、密码或令牌。
- `TRUST_PROXY_HOPS=1` 只信任紧邻 API 的 Caddy。改变代理层数时必须同步调整，不能使用无边界的代理信任。
- Web 会话当前仍保存在 `localStorage`，因此 HTTPS 不能消除 XSS 风险。对外开放前应保持依赖更新，并评估改用同站 `HttpOnly` Cookie。

## 5. 备份与更新

服务运行且健康时执行：

```bash
./scripts/backup-prod.sh
```

备份包含 PostgreSQL 自定义格式导出、上传附件压缩包、迁移与 Git 版本清单及 SHA-256 校验和，默认写入 `backups-production/`。数据库、JWT 和初始化密钥文件故意不进入业务备份，必须另存一份加密保护的副本。至少保留一个不在当前主机上的备份，并定期在空数据库中演练恢复。

更新前先备份，再构建并启动固定版本：

```bash
./scripts/backup-prod.sh
docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml build
docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml up -d
```

不要使用 `docker compose down -v`；该命令会删除生产数据库、附件和 Caddy 证书卷。恢复时先创建独立空数据库并用 `pg_restore --list` 和校验和检查备份，禁止直接覆盖仍在运行的生产库。
