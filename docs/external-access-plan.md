# M5-E 外部访问与网络管理方案（Tailscale）

> 状态：设计稿，写于 2026-10-30，等 King 过目后再动手。
> 来源：评估了《群晖 DS220+：Docker 部署 Tailscale，远程访问 Plex》部署指南，结论是同一套 Tailscale + Serve 可以直接覆盖小管家，不需要公网 IP、DDNS、端口映射或 Funnel。
> 本方案回答总体方案 §23 里挂着的「外网访问采用 VPN 还是反向代理」：**选 VPN（Tailscale），Caddy 继续做同源反向代理，但不对公网开放。**
> 阶段 0 是部署验收，不改业务代码；阶段 1、2 各自是一个独立提交批次，都可以不做。

---

## 0. 一句话方案

Mac mini 装 macOS 版 Tailscale，用 `tailscale serve` 把私有 HTTPS 入口 `https://<节点名>.ts.net` 代理到现有 Caddy（8088）；家人手机装 Tailscale 登录同一个 tailnet，浏览器打开这个地址就是小管家。代码层面只需要认第二跳代理和一个新的 CORS 来源。

在此之上，App 里加一页「家里 → 外部访问」：先只读（节点、设备、密钥到期），再按需加受控写操作（授权新设备、移除设备、密钥到期开关），一律走 Tailscale 控制面 API，**不让 API 容器碰 tailscaled 的本机 socket**。

**一条产品判断先说在前面**：Tailscale 自己的管理控制台和 App 已经够用，小管家**不重做一个 Tailscale 控制台**。做进 App 的价值只有两处：① 家里管理员不用另开控制台就能看到「谁的手机在、谁的密钥快过期」并收到提醒；② 家人换新手机时，管理员在小管家里点一下「允许」，而不是去翻控制台。凡是「改 ACL、开 Funnel、管子网路由」的需求，答案都是「去用控制台」。

---

## 1. 选型：为什么是 Tailscale Serve

| 方案 | 需要什么 | 风险 | 结论 |
| --- | --- | --- | --- |
| 公网域名 + Caddy 自动 HTTPS（当前 `production-deployment.md` 的默认形态） | 公网 IPv4 或 IPv6、DNS、路由器开 80/443 | API 直接暴露公网；登录限流、依赖更新、XSS 边界都变成硬约束 | 保留为备选，不是首选 |
| **Tailscale Serve（本方案）** | 每台外部设备装 Tailscale 并登录 | 手机必须开着 Tailscale；iOS 一次只能跑一个 VPN | **首选** |
| Tailscale Funnel | 同上，另把入口发布到公网 | 等于公网暴露，只是省了证书和端口映射 | 不启用 |
| frp / 内网穿透 | 一台公网中转机 | 中转机持有明文或终止 TLS，多一处要维护和信任 | 不做 |

Tailscale 个人版免费含 6 个用户、不限设备、3 个 ACL 组，一家人够用。

---

## 2. 现状与约束

| 项目 | 现状 | 对方案的影响 |
| --- | --- | --- |
| 对外入口 | Caddy，`SITE_ADDRESS=:80`，宿主机映射 `8088 -> 80`、`8443 -> 443`，纯 HTTP | Serve 终止 TLS 后转到 `127.0.0.1:8088`，Caddy 不用申请证书 |
| API 代理信任 | `TRUST_PROXY_HOPS=1`（只信紧邻的 Caddy） | 走 Serve 后是两跳，要改成 2，否则限流和日志里的客户端地址是 Serve 的回环地址 |
| CORS | `CORS_ORIGINS` 白名单 | 加 `https://<节点名>.ts.net` |
| Web 客户端 | Vite 构建，同源 `/api`，没有可配置的服务器地址 | 不需要改前端地址 |
| 会话 | Web 会话在 `localStorage` | HTTPS 不消除 XSS 风险，部署文档 §4 的提醒依旧成立 |
| 手机端 | 浏览器访问；PWA 在 M7-A5.4，未做 | 外部访问验收以手机浏览器为准 |
| 宿主机 | Mac mini 上的 Docker Desktop | **不用容器跑 Tailscale**：Docker Desktop 的 host 网络是 4.34 起的 opt-in 功能，且只转发 TCP/UDP、容器不能绑宿主机地址。直接装 macOS 版 Tailscale 应用 |
| NAS 上的 Plex | 按指南用容器 + 用户态 + Serve 发布 | 和小管家是同一 tailnet 里的两个节点，互不影响；本方案不动 Plex |
| 多家庭 | 一个实例可以有多个家庭 | **tailnet 是部署级的，不是家庭级的**。设备列表对所有家庭是同一份，阶段 1 起必须限定可见范围（见 §5.2） |
| 家人账号 | 未定 | 全家同一个 Tailscale 账号最省事，但 Serve 身份头就分不出是谁；各自账号通过用户邀请加入才能按人审计（§9 待拍板） |

---

## 3. 拓扑与流量

```text
外部手机 / 电脑（Tailscale 已登录，移动网络）
  |  https://<节点名>.ts.net
  v
Tailscale 加密连接（优先直连，否则 DERP 中继）
  |
  v
Mac mini：macOS Tailscale（tailscaled）
  |  Serve：HTTPS 443 -> http://127.0.0.1:8089
  |  注入 X-Forwarded-For / X-Forwarded-Proto: https / X-Forwarded-Host
  |  注入 Tailscale-User-Login / -Name / -Profile-Pic，并先删掉外来的同名头
  v
Caddy 容器 :8080（只绑宿主机 127.0.0.1:8089，专供 Serve）
  |  header_up X-Family-Ingress tailscale
  v
api:3100（TRUST_PROXY_HOPS=2）

局域网：浏览器 -> Mac mini:8088 -> Caddy :80 -> api:3100（照旧；该入口剥掉所有 Tailscale-* 和 X-Family-Ingress 头）
```

为什么要给 Serve 单独开一个只绑回环的端口：Docker Desktop 把所有宿主机映射端口的来源都显示成 Docker 网关地址，Caddy 靠 `remote_ip` 分不出「来自 Serve」和「来自局域网」。单独一个只绑 `127.0.0.1` 的端口，局域网设备根本连不上，Caddy 才能放心打 `X-Family-Ingress: tailscale` 这个标记。这一步属于部署配置，阶段 0 顺手做好，阶段 1 的「当前连接来自外部通道」就直接可用。

---

## 4. 阶段 0：部署验收（M5-E0，不改业务代码）

### 4.1 范围

- Mac mini 安装 macOS 版 Tailscale，登录 King 的 tailnet，节点名建议 `xiaoguanjia`。
- 启用 tailnet HTTPS 证书（Serve 首次执行时会提示）。
- Serve 发布 `--https=443 -> http://127.0.0.1:8089`。
- 演示栈增加 Serve 专用入口端口、调整 CORS 与代理跳数。
- 手机关 Wi-Fi 用移动网络登录、走一遍点菜或任务，再做容器与 Mac mini 重启验收。
- 补 `production-deployment.md`：§1 前置条件里把 Tailscale 写成首选，§4 网络边界补两跳代理和回环端口的说明。

不做：Funnel、出口节点、子网路由、把 NAS 上的 Plex 迁到同一节点、改星云或 CatWrt 的任何配置。

### 4.2 配置改动

`docker-compose.prod.yml` 的 `web` 服务：

```yaml
    ports:
      - "${HTTP_PORT:-80}:80"
      - "${HTTPS_PORT:-443}:443"
      - "${HTTPS_PORT:-443}:443/udp"
      - "127.0.0.1:${TAILSCALE_INGRESS_PORT:-8089}:8080"   # 只绑回环，专供 Serve
```

`deploy/Caddyfile` 增加第二个站点块（与 `:80` 共用同一组 handle，用 snippet 抽出来）：

```caddyfile
(family_site) {
	encode zstd gzip
	handle_path /api/* {
		reverse_proxy api:3100 {
			header_up -Tailscale-User-Login
			header_up -Tailscale-User-Name
			header_up -Tailscale-User-Profile-Pic
			header_up -Tailscale-App-Capabilities
			header_up -X-Family-Ingress
		}
	}
	# …uploads、静态文件、安全头与现状一致
}

{$SITE_ADDRESS} {
	import family_site
}

:8080 {
	import family_site
	# Serve 入口：只有这里才允许把 Tailscale 身份头和入口标记交给 API
	handle_path /api/* {
		reverse_proxy api:3100 {
			header_up X-Family-Ingress tailscale
		}
	}
}
```

> 上面是意图示意，最终写法以 Caddy 的 handle 优先级和实际验证为准：目标是 `:80` 入口剥掉所有 `Tailscale-*` 和 `X-Family-Ingress`，`:8080` 入口原样透传 Serve 注入的头并加上入口标记。

`deploy/.env.production`：

```text
CORS_ORIGINS=<现有来源>,https://<节点名>.<tailnet>.ts.net
TRUST_PROXY_HOPS=2
TAILSCALE_INGRESS_PORT=8089
```

`TRUST_PROXY_HOPS=2` 对局域网入口也生效：局域网只有 Caddy 一跳，Express 会把 `X-Forwarded-For` 链里不存在的第二跳当作直连，取到的仍是 Caddy 看到的地址，不会放大信任范围；但 `CORS_ORIGINS` 和登录限流都要在两条入口各验一次。

### 4.3 步骤

```bash
# Mac mini（宿主机，不是容器）
tailscale up --hostname=xiaoguanjia --accept-dns=false
tailscale serve --bg --https=443 http://127.0.0.1:8089
tailscale serve status
```

然后在 `~/AI/family-app` 按 `upgrade-prod.sh` 的常规流程重建 `web` 和 `api`（只改配置也要走脚本，保持镜像 revision 标签可追溯）。

### 4.4 Tailnet 访问策略

在控制台里新增而不是覆盖现有策略：

```json
{
  "groups": { "group:family": ["<家人账号>"] },
  "tagOwners": { "tag:xiaoguanjia": ["autogroup:admin"] },
  "acls": [
    { "action": "accept", "src": ["group:family"], "proto": "tcp", "dst": ["tag:xiaoguanjia:443"] }
  ]
}
```

Mac mini 节点打 `tag:xiaoguanjia`。注意：**打了 tag 的节点发出的请求不带 Serve 身份头**，但这里打 tag 的是服务端节点，手机是普通用户设备，不受影响。全家共用一个账号时 `group:family` 只有一个人，ACL 仍然有意义（挡住将来加入的其他设备）。

### 4.5 验收标准

- [ ] 局域网 `http://<Mac mini>:8088` 原有访问与登录不变。
- [ ] 手机关闭 Wi-Fi，经 `https://<节点名>.ts.net` 登录成功，完成一次点菜或任务写操作。
- [ ] API 访问日志里该请求的客户端地址是手机的 Tailscale 地址（`100.64.0.0/10`），不是回环地址。
- [ ] 局域网请求故意带上 `Tailscale-User-Login` 或 `X-Family-Ingress` 头，API 侧收不到。
- [ ] `tailscale ping <手机>` 能看出直连或中继；中继时页面可用但记录下来。
- [ ] `docker compose restart web api` 后入口不变；Mac mini 重启后 Serve 规则与节点身份保留，不需要重新登录。
- [ ] 控制台里只有 `group:family` 能通过 ACL 测试工具访问 `tag:xiaoguanjia:443`。
- [ ] 星云 DHCP、CatWrt、DSM 和 Plex 的任何配置没有被改动。
- [ ] 部署文档已更新，并记录节点名、tailnet 域名、Tailscale 版本、验收日期（不记录登录链接或密钥）。

### 4.6 回退

`tailscale serve reset` 清掉 Serve；`TRUST_PROXY_HOPS` 改回 1、`CORS_ORIGINS` 去掉 ts.net 来源后重建 api。节点本身不用删。

---

## 5. 阶段 1：只读「外部访问」面板（M5-E1）

### 5.1 范围

家里页 shelf 上加一页 `/house/external-access`，管理员看：

- **节点**：小管家所在节点的名字、系统、客户端版本、是否有更新、最后在线、密钥到期；节点对应的私有地址（手填，见 5.2）。
- **设备**：tailnet 里所有设备的名字、系统、所属登录名、是否已授权、是否连着控制面、最后在线、密钥到期、是否为外部共享设备。
- **提醒**：节点或设备密钥 14 天内到期、设备 30 天未上线，进通知中心（管理员），每台设备每天最多提醒一次。
- **当前连接**：任何成员的个人页或页脚显示「正在通过外部通道访问」（仅在请求带入口标记时）。

不做：Serve 配置读取（需要 tailscaled socket）、直连/中继判断、流量统计、ACL 展示。

### 5.2 数据与密钥

沿用 `integrations` / `integration_secrets`，`kind = 'tailscale'`，与 Home Assistant 的 `SmartHomeSettingsService` 同一套「服务器默认 + 家庭覆盖 + 令牌加密只写不读」：

| 字段 | 内容 |
| --- | --- |
| `baseUrl` | 固定 `https://api.tailscale.com`，允许改为自建 Headscale 地址 |
| `settings.tailnet` | tailnet 名或 `-`（当前凭据默认 tailnet） |
| `settings.publicUrl` | 管理员手填的 `https://<节点名>.ts.net`，用于页面展示和 CORS 自检，不从 Serve 读取 |
| `settings.nodeHostname` | 小管家所在节点名，用来在设备列表里标出「这台」并阻止误删 |
| `secret.credentialEncrypted` | OAuth client secret（首选）或 API 访问令牌 |
| `settings.credentialKind` | `oauth_client` 或 `api_token` |

服务器默认：`TAILSCALE_API_BASE_URL`、`TAILSCALE_TAILNET`、`TAILSCALE_OAUTH_CLIENT_ID`、`TAILSCALE_OAUTH_CLIENT_SECRET_FILE`（或 `TAILSCALE_API_TOKEN_FILE`），放 `/run/integration-secrets/`，权限 `600`、属主 UID 1000。

凭据建议用 **OAuth client，scope 仅 `devices:core:read`**：客户端凭据不过期，每次换一个一小时有效的访问令牌；API 访问令牌最长 90 天就要手动轮换，只作为备选。阶段 1 的凭据只能有读权限，由 `POST /external-access/settings/test` 在保存时核验（拿到的令牌能列设备、但 `POST /device/:id/authorized` 返回 403 才算「只读」）。

可见范围：**只有「服务器默认」或拥有这一行的家庭能看到**；其他家庭的管理员看到的是「本实例未向你的家庭开放外部访问管理」。服务器默认模式下只对 `owner` 角色展示，避免一个实例多家庭时互相看见设备。

### 5.3 API（草案）

```text
GET    /external-access/settings            manage_integrations   模式、是否配置、凭据提示、publicUrl
PUT    /external-access/settings            manage_integrations   写凭据与设置；进家庭活动
DELETE /external-access/settings            manage_integrations   回到服务器默认；进家庭活动
POST   /external-access/settings/test       manage_integrations   换令牌、列设备、确认 scope 只读
GET    /external-access/overview            manage_integrations   节点 + 设备摘要 + 到期提醒，60 秒缓存
GET    /external-access/devices             manage_integrations   设备明细
GET    /external-access/session             任何正式成员         { viaTailscale, login?, name? }
```

响应里永远不带 `machineKey`、`nodeKey`、`tailnetLockKey`、登录链接、密钥或密文；设备 `addresses` 只在明细里给，不进列表。

控制面调用：`GET /api/v2/tailnet/{tailnet}/devices`、`GET /api/v2/device/{id}`，3 秒超时，失败只显示「连不上控制面」，其它页面不受影响。调用和 Home Assistant 一样走 `integrations` 网络的出口。

### 5.4 入口标记与身份头的信任规则

`/external-access/session` 只在**同时**满足下面三条时才报告 `viaTailscale: true`：

1. 请求带 `X-Family-Ingress: tailscale`（只有 `:8080` 入口会加，`:80` 入口剥掉）。
2. `req.ip`（经 `TRUST_PROXY_HOPS=2` 解析）落在 `100.64.0.0/10`。
3. 请求带 `Tailscale-User-Login`（Serve 已先删掉外来的同名头，所以存在即可信）。

身份头只用于：审计「从外部登录」事件（`external_access_login`，记录登录名和成员 UUID，不记录 IP）、页面上的「外部通道」标识。**不**用身份头代替小管家登录，也不自动把 Tailscale 登录名映射成家庭成员；若将来需要按人对应，照 M4-H 的做法做显式映射。

### 5.5 前端

- `/house/external-access`：节点卡 + 设备列表（在线/离线、最后在线、到期倒计时、是否已授权），未配置时显示引导文案和到设置页的入口。
- `/house/external-access/settings`：模式、tailnet、凭据（只写）、publicUrl、nodeHostname、测试连接；与 `/house/smart-home/settings` 同一套表单组件和交互。
- 成员个人页：「正在通过外部通道访问」一行，不显示登录名给非管理员。
- 遵守 `.claude/skills/` 的 apple-design 与 emil-design-eng：enter 动画 ease-out、确认操作带 haptics、暗色模式。

### 5.6 验收标准

- [ ] 普通成员不能读取设置、概览和设备列表；`/external-access/session` 对任何正式成员可用，访客无入口。
- [ ] 凭据保存后库里是版本化密文，所有响应不回显明文；测试接口能区分「只读」和「有写权限」并在阶段 1 拒绝保存有写权限的凭据。
- [ ] 控制面超时或 401 时页面显示连不上，首页、今日和其它模块不受影响。
- [ ] 局域网请求伪造 `X-Family-Ingress` 与 `Tailscale-User-Login` 时 `viaTailscale` 为 false；经 Serve 的真实请求为 true。
- [ ] 密钥到期 14 天内的设备在通知中心出现，一天只一条；到期日变化后提醒重新计算。
- [ ] 一个实例两个家庭时，只有拥有该集成行（或 owner 家庭的服务器默认）能看到设备，另一家庭看到的是未开放提示。
- [ ] 设置页、概览页在 390 x 844 与 1440 x 900 的鼠标回归通过，暗色模式截图通过。

---

## 6. 阶段 2：受控写操作（M5-E2）

### 6.1 范围

只做四个动作，全部要求 `manage_integrations`、请求体 `confirm: true`、进家庭活动审计：

| 动作 | 控制面调用 | 守门条件 |
| --- | --- | --- |
| 授权新设备 | `POST /device/{id}/authorized` | 只对 `authorized = false` 的设备；一次一台 |
| 移除设备 | `DELETE /device/{id}` | 不能移除 `settings.nodeHostname` 对应的节点；设备 7 天内在线过时前端二次确认文案加粗提示 |
| 密钥到期开关 | `POST /device/{id}/key`（`keyExpiryDisabled`） | 只允许对小管家节点自身关闭到期；对手机等用户设备只允许重新开启 |
| 一次性预授权密钥 | `POST /tailnet/{tailnet}/keys` | `reusable=false`、`ephemeral=false`、有效期 ≤ 24 小时、不带 tag；密钥只展示一次，库里只存摘要、创建人和到期时间 |

凭据 scope 相应升到 `devices:core`（预授权密钥另需 `auth_keys`）。阶段 1 的「拒绝有写权限凭据」规则改为「写权限只在阶段 2 功能开关打开时允许保存」。

不做：改 ACL/policy file、Funnel、子网路由与出口节点、用户邀请、把节点自身 `tailscale up/down`、批量操作。

### 6.2 API（草案）

```text
POST   /external-access/devices/:id/authorize       { confirm: true }
DELETE /external-access/devices/:id                  { confirm: true }
POST   /external-access/devices/:id/key-expiry       { confirm: true, disabled: boolean }
POST   /external-access/preauth-keys                 { confirm: true, expiresInHours: 1..24, description }
GET    /external-access/preauth-keys                 摘要、创建人、到期、是否已用
```

每个家庭每分钟最多 5 次写操作；控制面返回非 2xx 时不改本地状态，原样显示错误码。审计动作名：`external_access_device_authorized`、`external_access_device_removed`、`external_access_key_expiry_changed`、`external_access_preauth_key_created`，记录设备名、设备 ID、操作者，不记录密钥。

### 6.3 验收标准

- [ ] 未带 `confirm: true` 的写请求返回 400，什么都不做。
- [ ] 移除小管家节点自身返回 409 并说明原因；对用户设备关闭密钥到期返回 409。
- [ ] 控制面 403（凭据只读）时返回明确错误，不写活动记录。
- [ ] 预授权密钥响应只出现一次，再次查询只有摘要；到期后状态显示「已过期」。
- [ ] 四个动作都出现在家庭活动流里，带操作者与设备名。
- [ ] 同一家庭一分钟内第 6 次写操作被限流。

---

## 7. 明确不做的事

- API 容器不挂 tailscaled 的 socket、不用 LocalAPI：拿到 socket 等于完全控制节点，和「API 不持有 Docker socket」是同一条原则。
- 不在 App 里编辑 ACL / grants：一行错误就把自己锁在外面，而且控制台已有测试工具。
- 不启用 Funnel，不把 DSM、SMB、PostgreSQL、Hermes 发布到 tailnet。
- 不把 Tailscale 登录名当成小管家身份，不自动映射成员。
- 不做流量统计、连接路径（直连/中继）监控，不记录客户端 IP。
- 不用小管家取代 Tailscale App 的安装与登录引导，只给一段链接和截图式说明。

---

## 8. 安全边界汇总

- 公网没有任何端口：没有端口映射、DDNS、Funnel。
- 控制面凭据只在 API 服务端，加密存库或 `/run/integration-secrets/` 文件，响应从不回显；阶段 1 只读 scope，阶段 2 才升。
- Serve 身份头只在回环专用入口、Tailscale 地址段、入口标记三者同时成立时采信，且只用于审计与展示。
- 局域网入口剥掉所有 `Tailscale-*` 与入口标记头。
- 所有写操作：能力校验、`confirm: true`、限流、家庭活动审计、守门规则（不能删自己）。
- 多家庭实例下设备列表只对拥有集成行的家庭可见。
- Tailscale 账号开两步验证；定期在控制台清理不用的设备；节点密钥到期只对服务端节点关闭。
- 远程视频和大图走家里的上行带宽，和 Plex 指南里的瓶颈一样，这不是小管家能解决的。

---

## 9. 需要 King 拍板

1. **家人账号**：全家同一个 Tailscale 账号（最省事，但审计分不出人），还是各自账号用用户邀请加入（6 人内免费，能按人审计、按人 ACL）。
2. **节点名**：建议 `xiaoguanjia`；域名在证书透明度日志里可见，不要带个人信息。
3. **阶段 1 的可见范围**：按 §5.2「拥有集成行的家庭 / owner 家庭」，还是干脆只做服务器级、只给 owner。
4. **凭据形态**：OAuth client（推荐）还是 90 天 API 令牌。
5. **要不要做阶段 2**：如果家人换手机的频率很低，阶段 1 加一条「去控制台授权」的链接可能就够了。

---

## 10. 参考

- 总体方案 §12（中兴网络设备）、§16（安全与隐私）、§19.2（家庭长期运行）、§23（待确认事项）。
- [production-deployment.md](production-deployment.md) §1、§4。
- [home-assistant-plan.md](home-assistant-plan.md) §3、§6：连接器存储与安全边界的现成模式。
- [m5-guest-wifi-acceptance.md](m5-guest-wifi-acceptance.md)：高风险网络操作的确认与审计约定。
- [m4-media-user-mappings-acceptance.md](m4-media-user-mappings-acceptance.md)：外部账号与成员显式映射的做法。
- Tailscale 官方：Serve（身份头 `Tailscale-User-Login` / `-Name` / `-Profile-Pic`，会先删外来同名头）、控制面 API（`/tailnet/{tailnet}/devices` 需 `devices:core:read`，`/device/{id}/authorized`、`/device/{id}/key` 需 `devices:core`，`/tailnet/{tailnet}/keys` 需 `auth_keys`）、ACL 语法、OAuth clients、Docker Desktop host 网络限制。源码核对：`ipn/ipnlocal/serve.go` 注入 `X-Forwarded-For`、`X-Forwarded-Proto`、`X-Forwarded-Host`。
