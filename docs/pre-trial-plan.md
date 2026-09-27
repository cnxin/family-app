# 小管家 · 试用前收尾计划（Phase H，交接给执行 agent）

> 放进仓库 `docs/pre-trial-plan.md`。硬规矩、SOP、提交格式沿用 `docs/execution-plan.md` §1～§3 和 `docs/f5b-inventory.md` 的工作规矩，不重复。
> 2026-09-28 King 决定：家庭试用（C2）推迟，先做完三件事并在 Mac mini 演示栈上测通，再迁到 NAS。
> 顺序固定：**H1 删旧端 → H2 事件通道 → H3 智能家居**。每个阶段各开短分支，CI 绿后 merge commit 合 main。
> 远程访问、购物清单离线暂不做（King 明确排除），记在 §5。

---

## 0. King 自己做的前置（不是执行 agent 的任务）

| # | 事 | 为什么 |
| --- | --- | --- |
| 0a | 用 `scripts/upgrade-prod.sh` 把 Mac mini 上 8088 演示栈升到 main，按 `deploy-c2.md` 三处确认 | 它有 11 天的真实数据，是最接近 NAS 的升级演练；H1～H3 全部在这套栈上验收 |
| 0b | 在 Mac mini 的 Docker 上装 Home Assistant（方案见 `home-assistant-plan.md` §1 的 C）；建长期访问令牌；装 Roborock 官方集成、HACS 装 `XiaoMi/ha_xiaomi_home` 与 `banto6/haier` | H3 的 E2 之后要打真机。执行 agent 装不了 |
| 0c | 把 HA 的地址和令牌以 `HOME_ASSISTANT_BASE_URL` / `HOME_ASSISTANT_TOKEN_FILE` 放进演示栈的 env（令牌用文件，不进 compose） | E1 验收要连通 |

0b、0c 在 H1、H2 期间做完即可。

---

## H1 · C3 删除旧客户端 ［M］

按 `execution-plan.md` C3 小节执行，补充：

- **删的范围**：`apps/mobile`、Caddy 里的 `/legacy` 路由、`Dockerfile` 里旧端的构建阶段、CI 的旧端 job（`web-tests`）、`docs/ci-pending-*.diff`、根 `package.json` 里只服务旧端的脚本、`pnpm-workspace` 条目。旧端独有的 e2e 全部删除，**先核对**新端套件里有没有等价用例（execution-plan B 阶段的备注列过：agent-ui「新对话不清草稿」、agent-memory、agent-responsive），没有的先补进新端再删旧端。
- **不删的**：contracts、shared、API；`apps/web` 里为兼容旧端保留的路径重定向留着（成本为零，家里人收藏夹里可能有）。
- **API 侧兼容**：F4.6b 让服务端同时接受 `performedOn` 和 `performedAt`，旧端删了以后 `performedAt` 兼容分支也删掉，契约同步收紧。全 API 搜一遍「兼容旧客户端」类注释，逐条删或列进 §5。
- **uitest 分支**：ia-plan §4 记着待 C3 处置。本轮把它的 3 个提交逐个看一遍：只改旧端的直接丢；改了 API 或共享包的列出来问 King。分支本身等 King 点头再删。
- **镜像**：`docker build` 产物只剩 API 与 web；`deploy-c2.md`、`production-deployment.md`、`family-guide.md` 里所有提到 `/legacy` 的句子删掉。
- **CI**：删旧端 job 时 workflow 文件会动，工具若拒绝写就贴 diff。删完 CI 应为四项：静态检查、API 黑盒、新端 Web 回归、镜像构建。
- **验收**：全量 test:api + test:web:next + test:unit；本机 `docker build` 两个镜像；演示栈按 `upgrade-prod.sh` 升一次，`/legacy` 返回 404 或跳转到 `/`。
- 提交：`chore: 删除旧客户端`（一个提交；若 e2e 补用例需要先行，单独 `test(e2e): 补齐旧端独有用例` 在前）。教训照旧续编号。

---

## H2 · `/events` 事件通道 ［L］

目标：把 9 处 `refetchInterval` 轮询换成一条服务端推送通道；**服务端只推「哪个域变了」，不推数据**，客户端收到后让对应查询失效、自己重取。这条通道 H3 的 HA 状态、将来的 agent 运行流、访客点菜请求（F5 备注里靠过期兜底的那条）都要用。

### H2a · 服务端

- **端点** `GET /events`，SSE。放 `apps/api/src/events/`（模块名 `events`），不依赖任何业务模块；业务模块依赖它，方向不能反。
- **认证**：浏览器原生 `EventSource` 不能带请求头。**禁止把长期 JWT 放进 URL。** 二选一，写进汇报：① 客户端用 `fetch` + `ReadableStream` 读 SSE，带正常的 Authorization/Cookie；② `POST /events/ticket` 换一个 60 秒一次性 ticket，`EventSource('/events?ticket=…')`。倾向 ①，因为 `api-client` 已经统一了凭据来源（Web 用 Cookie/令牌，将来壳和小程序各自实现）。
- **消息格式**（契约放 `packages/contracts/src/events.ts`）：
  - `changed`：`{ domains: string[], at: ISO, actor?: memberId }`，`domains` 用 nav/contracts 里已有的域 key 枚举（core 域也要有 key：shopping、tasks、calendar、menus、notifications…；把枚举补全，成为「域 key」的唯一来源）；
  - `heartbeat`：每 20 秒一条，内容为空；
  - 连接建立时先发一条 `hello: { serverTime, connectionId }`。
- **谁来发**：
  1. 一个 Nest 拦截器：**任何成功的写请求**（POST/PUT/PATCH/DELETE，2xx）结束后，按「路由前缀 → 域」映射表发 `changed`。映射表是一份显式清单，和 api-inventory 对齐，缺项 CI 里断言失败（写一条脚本：遍历 inventory 的写端点，逐条确认在映射表里或在显式豁免表里）。
  2. 后台任务显式发：提醒触发（reminders）、通知投递（notifications）、备份状态（system）、agent 运行与提案（agent）、MoviePilot 对账（media）。
  3. 公开端点（访客邀请页的点菜请求、H3 的 HA webhook）成功后也发，这样家里人不用等 1 分钟过期。
- **家庭边界**：每个连接绑定家庭；只推本家庭的事件。隔离测试补一条。
- **实现**：进程内 `EventEmitter` 够用（单进程部署）。留一个 `EventBus` 接口，将来换 Redis 只换实现。每家庭连接数上限 20，超了拒绝新连接并记日志。
- **代理**：Caddy 对 `/api/events` 关闭缓冲（`flush_interval -1`）；`deploy-c2.md` 补一句。
- **黑盒** `apps/api/scripts/events.mjs`：建立连接 → 用另一个会话加一样购物 → 1 秒内收到 `changed` 含 `shopping`；跨家庭收不到；ticket/凭据无效 401；heartbeat 间隔正确。
- 提交：`feat(api): /events 事件通道，写操作后按域推送`

### H2b · 客户端

- `packages/api-client` 加 `subscribeEvents(): EventSource-like`，**传输层可替换**（现在 SSE；小程序将来用 WebSocket，载荷一样）。指数退避重连（1s→30s 封顶），页面从后台回前台时若连接已断立即重连并做一次全量失效。
- 外壳级订阅（登录后建立，登出断开）。收到 `changed` → 按「域 → 查询 key 前缀」映射 `invalidateQueries`；同时触发现有的 `invalidateModules()` / `invalidateAttention()`（这两个仍保留供本地乐观更新用）。`actor === 自己` 的事件也照常失效（简单、无害）。
- **删掉全部 9 处 `refetchInterval`**。agent 运行流那两处如果需要更细的进度（工具事件），保留一条 agent 专用的 SSE（refactor-plan 已规划），不要用轮询过渡。逐处列表写进汇报：原轮询 / 现由哪个域事件覆盖。
- 顶部或状态栏：连接断开超过 30 秒显示一条可关闭的「实时更新已暂停」提示，恢复后自动消失；不要弹窗。
- **e2e**：两个浏览器上下文（爸爸、妈妈）同一家庭：A 加一样购物，B 不刷新 3 秒内出现；A 勾掉，B 3 秒内变灰；B 断网（route abort）30 秒后出现提示，恢复后消失且数据补齐；访客邀请页提交点菜请求后，管理员今天页 3 秒内出现留意卡。
- 提交：`feat(web): 用 /events 替代轮询`

### H2 验收

演示栈升级后，两台设备（手机 + 电脑）同时开购物清单，一边勾一边看。Caddy 缓冲没关的话手机端会 20 秒才动，这条要实测。

---

## H3 · 智能家居（E1～E5）

方案已在 `home-assistant-plan.md`，本节只写**在 Phase F 之后需要修正的地方**，其余按那份文档。

### 对原方案的修正

| 原方案 | 改为 | 原因 |
| --- | --- | --- |
| §4.1 挂在「家务」场景下的新分段 | shelf 层分段 `smart-home`，`hasData` = 家庭已配置连接器且白名单非空；未配置时躺在家里页「还可以开启」 | ia-plan 的分层模型 |
| §4.3 今天页「一张卡」 | 两样东西：① **设备卡**（`pinnedToToday` 的设备，可控），作为今天页一个独立区块，放在「今晚吃什么」之后、任务之前；② **留意规则**（F5 的 attention provider）：净水器滤芯低于阈值、烘干/洗衣完成后 2 小时没人处理、HA 离线超过 1 小时（管理员）。留意卡遵守 F5 四条硬规矩 | 设备卡是「操作」，留意卡是「待办」，性质不同 |
| §3 状态缓存 + 轮询 | HA 状态变化经 H2 的 `/events` 推到客户端（`domains: ['smart-home']`）；服务端对 HA 的订阅优先用 WebSocket `subscribe_events state_changed`，退化为 30 秒轮询 | 有了 H2 就不该再轮询 |
| §5.1 webhook 进来后的动作 | 复用 H2：先发 `changed`，再执行联动规则 | 一处发事件 |
| §4.2 设置页 | 归入 F7 的「家庭设置」页一行「智能家居」→ 现有设置页路径 | 设置统一入口 |
| 18 个端点 | 逐个对照 F3 的模式：`connector-settings` 那 5 个照媒体连接器抄；`links` 4 个先不做（E4 时再加，见下） | 先读后控，控通了再联动 |
| E1 与 C2 并行的排期建议 | 作废：H3 整体在 C2 之前，顺序 E1→E5 | King 决定 |

### 已定的拍板（home-assistant-plan §8）

1. HA 装 Mac mini Docker（方案 C）；将来搬家用 HA 自身备份迁移。
2. 门锁、安防：家里没有，第一期契约里也不放这两个 domain。
3. 今天页设备卡：扫地机（状态 + 清扫/回充）、客厅窗帘（开/关）、洗衣机/烘干机（只读剩余时间）、净水器滤芯（只读，且只在寿命低于阈值时显示）。空调那格等 VRF 网关，本期不做。
4. VRF 网关本期不买。契约里 `climate` 类型照常定义，页面上没有实体就不显示。

### 拆分与验收

| # | 内容 | 档 | 验收（演示栈 + King 家真机） |
| --- | --- | --- | --- |
| E1 | 连接器设置 + 实体目录 + 白名单 + `/house/smart-home` 只读页 | L | 填地址/令牌测通；挑出扫地机、窗帘、洗烘、净水器起中文名；页面显示真实状态；HA 停掉后页面显示「连不上」且其他页面不受影响 |
| E2 | 控制：`vacuum`、`cover`、`switch`、`scene`；幂等键 + 审计表 + 权限；状态经 `/events` 推送 | L | 按「开始清扫」扫地机真的动；窗帘开合；两台设备同时开着页面，一边按另一边 3 秒内变 |
| E3 | HA → 小管家 webhook + 首批三条联动（烘干完成→通知+家务；扫地完成→打勾家务；滤芯低→提醒+加购物清单） | M | HA 自动化打过来，小管家真的生成对应对象；密钥轮换后旧密钥 401 |
| E4 | 小管家 → HA：家务打勾跑场景；日历事件前 N 分钟跑场景。`links` 端点在此加 | M | 打勾「打扫」扫地机启动；HA 停掉时日历提醒照常 |
| E5 | 今天页设备卡 + 留意规则 + 家里页图块 + 收口 | S | 四张截图；黑盒 + Playwright 全绿；`home-assistant-plan.md` 标「已实施」并指向本文件 |

隔离库里 HA 必然是空配置：黑盒用一个假的 HA HTTP 服务（`apps/api/scripts/fake-ha.mjs`，实现 `/api/`、`/api/states`、`/api/services/*` 和 WebSocket 的最小子集）；e2e 用 mock spec。真机验收由 King 在演示栈上做，结果记进各阶段的进度备注。

---

## 4. 全部做完之后

1. 演示栈升到最终 main，King 用一周（自己 + 至少一位家人）；
2. 按 `deploy-c2.md` 迁到 NAS；
3. C2 家庭试用两周（反馈走微信群，`usage-report.mjs` 出三档数据）。

## 5. 明确后置（King 排除或本轮不做）

- 远程访问（IPv6 + 域名 + DDNS + Caddy DNS-01）；托管中继不做。
- 购物清单离线勾选（Service Worker + 查询持久化 + 离线 mutation 队列）。
- `links` 之外的联动扩展、传感器类联动（家里没有传感器）。
- 三菱空调 VRF 网关。
- agent 重建（自研 loop、工具按模块裁剪）。

## 进度表

| 任务 | 状态 | 提交 | 备注 |
| --- | --- | --- | --- |
| 0a 演示栈升级（King） | ☐ | | |
| 0b/0c 装 HA 并配置（King） | ☐ | | |
| H1 删旧端 | ☐ | | |
| H2a /events 服务端 | ☐ | | |
| H2b /events 客户端 | ☐ | | |
| E1 连接器与只读页 | ☐ | | |
| E2 控制 | ☐ | | |
| E3 HA → 小管家 | ☐ | | |
| E4 小管家 → HA | ☐ | | |
| E5 今天页与收口 | ☐ | | |

状态：☐ 未开始 · ◐ 进行中 · ☑ 完成 · ✗ 放弃（写原因）
