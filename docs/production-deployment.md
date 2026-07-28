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
chmod 600 deploy/.env.production deploy/secrets/*.txt
```

编辑 `deploy/.env.production`：

- `SITE_ADDRESS` 填实际域名，例如 `family.example.com`；Caddy 会自动启用 HTTPS。
- `CORS_ORIGINS` 填完整来源，例如 `https://family.example.com`。多个来源用逗号分隔。
- `APP_VERSION` 建议使用发布版本或 Git 提交短哈希，不要长期依赖 `latest`。
- 根据主机内存调整资源限制。默认值适合小型家庭实例的起点，不等于容量承诺。

环境文件和 `deploy/secrets/` 已被 Git 忽略。数据库密码、JWT 密钥以及未来的连接器令牌不得提交到仓库，也不得写入镜像构建参数。轮换 JWT 密钥会使所有现有登录立即失效。

## 3. 校验并启动

```bash
docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml config --quiet

docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml build

docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml up -d
```

首次启动会在空数据库上执行 TypeORM 迁移，但不会创建“爸爸/妈妈”等演示数据。已有家庭数据应从经过校验的备份恢复；正式的首户注册流程会在后续账号模型批次实现。

健康检查：

```bash
curl https://family.example.com/api/health/live
curl https://family.example.com/api/health/ready
```

`live` 只确认 API 进程可响应，`ready` 还会执行数据库探测。成功的健康轮询默认不写 API 访问日志，失败仍会记录请求 ID 和状态。

## 4. 网络与安全边界

- 宿主机只映射 Caddy 的 80/443；PostgreSQL 与 API 没有宿主机端口。
- Caddy 为前端和 API 设置基础安全响应头；关闭含客户端地址和完整 URI 的访问日志，只保留轮转后的运行与错误日志。
- API 只记录请求 ID、路由模板、状态、耗时和成员/家庭 UUID，不记录请求体、查询值、姓名、IP、PIN 或令牌。
- `TRUST_PROXY_HOPS=1` 只信任紧邻 API 的 Caddy。改变代理层数时必须同步调整，不能使用无边界的代理信任。
- Web 会话当前仍保存在 `localStorage`，因此 HTTPS 不能消除 XSS 风险。对外开放前应保持依赖更新，并在账号模型稳定后评估同站 `HttpOnly` Cookie。

## 5. 备份与更新

服务运行且健康时执行：

```bash
./scripts/backup-prod.sh
```

备份包含 PostgreSQL 自定义格式导出、上传附件压缩包、迁移与 Git 版本清单及 SHA-256 校验和，默认写入 `backups-production/`。密钥文件故意不进入业务备份，必须另存一份加密保护的副本。至少保留一个不在当前主机上的备份，并定期在空数据库中演练恢复。

更新前先备份，再构建并启动固定版本：

```bash
./scripts/backup-prod.sh
docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml build
docker compose --env-file deploy/.env.production \
  -f docker-compose.prod.yml up -d
```

不要使用 `docker compose down -v`；该命令会删除生产数据库、附件和 Caddy 证书卷。恢复时先创建独立空数据库并用 `pg_restore --list` 和校验和检查备份，禁止直接覆盖仍在运行的生产库。
