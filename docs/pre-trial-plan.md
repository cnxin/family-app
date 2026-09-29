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
3. ~~今天页设备卡：扫地机（状态 + 清扫/回充）、客厅窗帘（开/关）、洗衣机/烘干机（只读剩余时间）、净水器滤芯（只读，且只在寿命低于阈值时显示）。空调那格等 VRF 网关，本期不做。~~
   **2026-09-29 改写**（智能家居页重做 §8-1）：今天页设备卡 = `pinnedToToday` 的设备，最多 4 张，与智能家居页同一个卡片组件；滤芯低**不**做条件设备卡，走 E5 留意规则「需要留意」。
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

1. **I1 位置字典 + 三处引用**（`item-location-plan.md` §3）：E5 之后、King 自用一周之前做；I2、I3 等试用反馈再动；
2. 演示栈升到最终 main，King 用一周（自己 + 至少一位家人）；
3. 按 `deploy-c2.md` 迁到 NAS；
4. C2 家庭试用两周（反馈走微信群，`usage-report.mjs` 出三档数据）。

## 5. 明确后置（King 排除或本轮不做）

- 远程访问（IPv6 + 域名 + DDNS + Caddy DNS-01）；托管中继不做。
- 购物清单离线勾选（Service Worker + 查询持久化 + 离线 mutation 队列）。
- `links` 之外的联动扩展、传感器类联动（家里没有传感器）。
- 三菱空调 VRF 网关。
- agent 重建（自研 loop、工具按模块裁剪）。
- **H1 盘点后置**（2026-09-28 King 答复）：
  - e2e：小管家对话 / 提案 / 提案组渲染的 mock 用例；厨房主厨与操作历史、菜谱做法版本的用例。
  - 智能菜单：界面与 API 已删（从未正式使用），`smart_menu_*` 实体与数据表保留，需要时从 git 找回 `apps/api/src/smart-menu/` 与 `packages/contracts/src/smart-menu.ts`。
  - 小管家页面上下文：已删，⌘K「交给小管家」替代。
  - 后端 targetPath 仍按旧一层路径生成，靠新端 `toNewRoute` 换算；改成在源头直接生成新路径（换算层已放行新路径，见教训 31）。部分参数新端不消费（`assetId`、`taskId`、`eventId`、`visitId` 等，见 ia-plan §4）。
  - 只有旧端调用、新端尚无入口的端点：`GET /ingredients`、`GET /media/viewing-progress`、`GET /shopping-items/:id/inventory-preview`、`GET /agent/proposal-groups/:id`；新端是否需要，待定。
  - 知识库编辑「放弃未保存的修改」确认：旧端有、新端没有，待 King 定要不要补。
  - 登记食品批次弹窗文案与 API 不符：文案说「登记后会同时增加库存余量」「登记并入库」，API 只从现有未分批库存里划出一批，库存为 0 时 409。改文案还是改行为，待 King 定。
  - 邀请兑换时本人不能改称呼（兑换接口只收登录名和密码，称呼沿用邀请时定的）；要改需扩接口。
  - 批次登记、资产表单等处的默认日期仍按设备日期（timezone-audit T3 其余部分）。

## 进度表

| 任务 | 状态 | 提交 | 备注 |
| --- | --- | --- | --- |
| 0a 演示栈升级（King） | ☑ | | 2026-09-28 随 H1 验收一并由执行 agent 升级，见 H1 行 |
| 0b/0c 装 HA 并配置（King） | ◐ | E1 `586dc9d`（compose 预留） | **执行 agent 已做**（2026-09-28 King 改派）：独立 compose 项目 `~/family-ha`（不在本仓库），`ghcr.io/home-assistant/home-assistant:stable`（装时 2026.9.4），8123 端口、`./config`、TZ=Asia/Shanghai、unless-stopped；HACS 用官方脚本装（2.0.5，先读过脚本：只从 HACS 官方 GitHub release 下 zip 解到 `custom_components/hacs`）并重启；启动 / 停止 / 升级 / 备份与 King 的四步写在 `~/family-ha/README.md`。演示栈 compose 预留 `HOME_ASSISTANT_BASE_URL=http://host.docker.internal:8123`、`HOME_ASSISTANT_TOKEN_FILE=/run/integration-secrets/home_assistant_token.txt`（文件还不存在），API 加 `extra_hosts: host.docker.internal:host-gateway`（NAS/Linux 需要）；API 容器到 HA 实测 401（只差令牌），600 权限的文件容器内 UID 1000 读得到。**待 King**：建管理员、装三个集成、建长期令牌、写进令牌文件。 |
| H1 删旧端 | ☑ | H1-0：`1ca0a42` / `07ec9b0` / `789228f`；修复：`41dd77c` / `5111ebf`；`89d3622`；`e0adfe9` | **H1-0**（King 加的前置）：邀请兑换 `/join` 与首次初始化 `/setup`（CI `36343483076`）、退出吊销服务端会话（`36343707991`）、任务编辑与删除（`36344792682`），均首跑全绿，教训 30。**两处修复**：对话框关闭按钮 44px、资产详情显示实际完成日（`36345094320`）。**补 e2e** `89d3622`：盘点第二节 1–9 + 视口矩阵 + 「新对话不清草稿」；首跑 `36347094138` 两条新用例按机器日期算天数、CI 为 UTC 时差一天而红，改按家庭日期后并入同一提交，`36348306957` 全绿（改了代码，不算未改代码重跑）。**删除** `e0adfe9`：apps/mobile 114 个文件，全提交 177 个文件 +364 / −59,613 行；端点 279 → 272；CI `36350342990` 四项首跑全绿（静态检查 / API 黑盒 / Web 回归 / 镜像构建）。本地：全量 test:api 通过，test:web 319 passed / 41 skipped（36 为视口矩阵仅手机项目），test:unit 16/16；首轮 test:web 有 1 条因本机 `net::ERR_NETWORK_CHANGED` 白屏，**未改代码重跑**通过。本机 docker build API 与 web 镜像通过，`/legacy`、`/legacy/` → `/`，`/legacy/guest/<token>?…` → `/guest/<token>?…`（302）。**演示栈**：此前并未升级（容器 9/16 建、库停在 `AddSubscriptionRenewalCycle`），本次 `upgrade-prod.sh --no-pull` 从旧版升到 `8c10678` 用时 54 秒，两个新迁移在真实数据（含 1 条维护记录）上执行，三处确认通过，12 张业务表行数前后一致，今天 / 家里 / 购物清单点一遍正常、控制台无错。回滚标签 `prod-before-20260928-052029`，备份 `backups-production/20260927-212030Z`。教训 31。 |
| H2a /events 服务端 | ☑ | `b6964f9`；修复 `7b52caf`；合并 `a371752` | 认证选 **①**（fetch + ReadableStream，令牌走 Authorization 请求头，不进 URL）。域 key 24 个（shelf 14 + core 5 + 设置类 5），契约 `packages/contracts/src/events.ts` 为唯一来源。**写端点映射**：api-inventory 的 186 个写端点全部登记——拦截器按路由前缀发 168、业务服务显式发 10（访客公开页 4、两个媒体 webhook、邀请兑换、agent 工具与运行、提醒派发、通知投递、备份监视、MoviePilot 对账）、豁免 8（各带理由）；`scripts/check-event-routes.mjs` 进 CI 静态检查，缺一条或映射表里有失效条目都红。黑盒 `events.mjs`：推送 12–29ms、心跳实测 302ms（测试环境设 300）、第 21 条连接 429、跨家庭收不到（household-isolation）。Caddy：`/api/events` `flush_interval -1` 且不进 `encode`。CI `36367621434` 首跑全绿。**修复 `7b52caf`**（H2b 全量 e2e 暴露）：鉴权是异步的，客户端在鉴权期间挂断时 close 事件早于 `open()` 挂监听，连接登记永不释放，要等令牌到期（15 分钟）；全量 e2e 后半程同一家庭 20 个名额被占满、`/events` 一律 429。`open()` 先看响应是否已销毁；`events.mjs` 加「25 条发完请求立刻挂断后名额一个不少」，修前 1/20。CI `36373711149` 首跑全绿。教训 32。 |
| H2b /events 客户端 | ☑ | `2a8824b`；合并 `7b7454d` | 新建 `packages/api-client`（原先不存在）：`subscribeEvents`，凭据注入、传输层可替换、1s→30s 退避、hello 清零、45 秒无帧视为断线、401 续期一次失败即停。Web 外壳 `useLiveEvents`：域 → 查询前缀表失效；断过再连上全量补齐；回前台立即重连；断开超过 30 秒顶部可关闭提示。**轮询只有 5 处**（计划写 9 处，C 阶段新端里只剩这些）：通知 30s → 任意 changed（常带）；投递记录 30s → notifications（投递落定时显式发）；备份面板 10s → backups（备份监视）；提醒 15s → reminders + notifications（派发）；助手运行中 700ms → assistant（认领、工具调用、结束；认领这一处是 H2b 补的 API 显式发）。e2e `live-events.spec.ts` 三条打真实 `/events`：两家人购物清单 3 秒内同步、断线 30 秒才提示且恢复后补齐、访客点菜后今天页 3 秒内出现留意卡；依赖 networkidle / 请求计数的 5 个 spec 拦掉 `/events`。开发模式 effect 挂两次曾让「已暂停」提示误报，已防并由 e2e 的「连着 31 秒不提示」钉住。单测 5 条（mutation 验证有效；注意 `test:unit` 目前不在 CI 里）。Dockerfile 构建阶段装依赖加 `--filter "./packages/*"`。本地 test:web 328 passed / 42 skipped。CI `36374744614`：首跑 API 黑盒红在 `system-modules.mjs:325`（提醒夹具与 200ms 派发器竞争，`9af1821` 起就有，与本次无关），**未改代码重跑**全绿。**演示栈**：`upgrade-prod.sh --no-pull` 升到 `7b7454d`，回滚标签 `prod-before-20260928-120350`，备份 `backups-production/20260928-040351Z`；经 8088 的 `curl -N`：hello 21ms、写后 changed 119ms（含 curl 起进程）、心跳 20.0s、无 Content-Encoding；两个独立浏览器会话（爸爸桌面 Chromium、妈妈 iPhone 13 仿真）同开购物清单：加 115ms、勾 93ms、取消勾 41ms，两边都未出现暂停提示；非真机。 |
| E1 连接器与只读页 | ☑ | `586dc9d`；合并 `7855e44`；目录修复 `5f84af6`，合并 `9c8c35b` | **真机验收（2026-09-28 King）**：连接测试通过；实体目录能列出 Roborock、米家、海尔三个集成的实体；停掉 HA 后智能家居页显示连不上、其他页面正常。**验收发现**：目录平铺太乱（米家每台设备十几个诊断类子实体），挑白名单几乎不可用 → **修复 `5f84af6`**：目录改用 HA WebSocket 的设备 / 实体 / 区域三张注册表按设备分组（可收起的设备卡、区域名、默认只展开主实体、diagnostic / config 折进「更多 N 项」、搜索 + 类型 chips、「已加」、实体名去设备名前缀、别名默认去前缀后的名字）；WebSocket 读不到退回平铺。CI `36399132591` 首跑全绿，演示栈升到 `9c8c35b`（回滚标签 `prod-before-20260928-165916`）。**真 HA 上的结果**：25 台设备、242 个实体，Roborock 标了 entity_category，折叠有效（G30 U 28 个只展开 1 个）；**米家（xiaomi_home）、海尔集成基本不标 entity_category**，按约定的规则仍有 148 个主实体（「厨下净水」16/16、米家插座 14/19），HA 自带的 Backup / Sun 服务型设备也在目录里——补充规则待 King 定（见本轮汇报），教训 34。9 个端点（连接设置 GET/PUT/DELETE + 测通、实体目录、白名单 GET/PUT/DELETE、状态快照）；webhook 轮换留给 E3。连接设置复用 `integrations`（kind = home_assistant）+ `integration_secrets` 加密存令牌，只写不读；服务器默认的令牌文件不存在只算「没配」、每次重读不用重启。`smart-home` 由设置类域改为第 15 个 shelf 域，`hasData` = 连接配好且白名单非空。门锁 / 安防目录不列、白名单不收、库里 CHECK 也拒；状态只透出 state / 单位 / device_class / 开合 / 电量。所有 HA 调用 3 秒超时、不跟跳转；HA 停掉状态接口仍 200 说「连不上」（实测 20ms），不回时 3.0 秒超时。**E1 不推送 HA 状态**：页面进来读一次、「刷新」按钮重读（服务端按家庭合并 2 秒），不轮询；HA → `/events` 的推送按表归 E2。**e2e 偏离计划**：没用 mock spec，改为真 API + `fake-ha.mjs`（Playwright 进程里起），API 到 HA 走真实 HTTP。黑盒 `smart-home.mjs` 31 条；状态文案单测 7 条；本地 test:api 全绿、test:web 332 passed / 42 skipped。顺带修 `check-module-migration.ts`：重新 up 后应与回退前的全貌比（此前后续迁移只加列不加索引，一直没暴露）。CI：首跑 `36383495315` 镜像构建红——e2e 静态 import 了 `apps/api/scripts/fake-ha.mjs`，前端镜像只带 apps/web，`tsc -b` 解析不到；改为运行时 import、类型就地声明，并入同一提交（改了代码，不算未改代码重跑），`36385028560` 四项全绿。安全 / 质量关卡通过。**演示栈**升到 `7855e44`：迁移已应用，连接显示服务器默认、未配置，`/house/smart-home` 200，家里页不显示智能家居（还没配）。回滚标签 `prod-before-20260928-142559`，备份 `backups-production/20260928-062600Z`。教训 33。 |
| E2 控制 | ◐ | `9213e61`；合并 `8bf5fe9` | 代码与自动化验收完成，**真机验收待 King**（在设置页给扫地机、窗帘开放控制，按「开始清扫」看扫地机真的动；窗帘开合；两台设备同开智能家居页，一边按另一边 3 秒内变）。控制 vacuum（开始清扫 / 暂停 / 回充）、cover（开 / 停 / 关）、switch（开 / 关）、scene（执行）；每次重新校验权限（设备开放控制 + 角色达到 minRole，默认只有管理员），车库门 / 大门类 cover 只读。幂等：`(家庭, requestId)` 唯一，重发取回第一次结果、不再打 HA，并发连点三下 HA 只执行一次。审计表 `smart_home_commands`（迁移 1785232700000），成功 / 失败 / 超时都记，管理员在设置页看「最近的操作」。HA 失败回 502 说清原因；命令超时单独 8 秒（HA 要等云端设备执行完才回）。**推送**：服务端对每个连好 HA 且白名单非空的家庭常驻一条 HA WebSocket 订阅 `state_changed`，只看白名单实体，经 `/events` 推 smart-home（黑盒 185ms）；断了退回 30 秒轮询 `/api/states`（测试环境 0.3 秒，305ms），退避重连后接回推送；白名单清空即断开。**与方案的出入**：场景不单设 `GET /smart-home/scenes` 与 `/scenes/:id/activate`，统一走 command（action = activate），场景在状态页右栏；控制不写家庭动态（量大），只进审计表。黑盒 `smart-home-control.mjs` 25 条；e2e `smart-home-control.spec.ts` 两个上下文打真实 `/events`（一边按另一边 3 秒内变、HA 里直接改两边都变、按角色给按钮、设置页开放控制、审计列表）；本地 test:api 全绿、test:web 338 passed / 42 skipped。首轮全量 test:api 有一条黑盒断言按成员显示名比对，被前面脚本改名后失败，改为按成员 ID（改了代码，不算未改代码重跑）。CI `36404670743` 首跑全绿。**演示栈**升到 `8bf5fe9`（回滚标签 `prod-before-20260928-175503`，备份 `backups-production/20260928-095504Z`），迁移已应用，服务端已对真 HA 进入推送模式（`smart_home_live mode=push`）；King 已挑的 2 台（G30 U、空调插座）都未开放控制，空调插座是 climate，不在本期可控范围（等 VRF，见已定拍板 4）。 **2026-09-28 King 拍板后的两笔**：① 目录折叠 `ef66263`（合并 `7a783f6`，CI `36430861085`）——HA 服务型设备（entry_type = service）不列、米家「* 」前缀的内部实体不算主实体、每台设备最多展开 4 个（可控类优先、剩下给传感器）、HA 里停用 / 隐藏的实体不列；真 HA 上默认展开从 148 降到 67 个（23 台设备、232 个实体）。② 空调试探性纳入控制 `f8e3d2b`（合并 `cdb66e0`，CI `36431797049`）——开关、制冷 / 制热 / 送风 / 自动、设定温度 ±1（以 HA 当前设定温度为准、收在上下限内，到头 409 不打 HA）；climate 一律标「按上次操作显示」（红外只记得上次发了什么）。**King 真机验证后再定去留。** 演示栈升到 `cdb66e0` 时 G30 U 在 HA 里是 unavailable（石头云端 / 网络），验收前先确认它在线。 |
| E3 HA → 小管家 | ◐ | `2c527f7`；合并 `9916dc6` | 代码与自动化验收完成，**真机验收待 King**（「家庭设置 → 智能家居 → 联动」生成密钥与 HA 配置，地址填 `http://host.docker.internal:8088`，把两段 YAML 贴进 HA、重启，选好触发实体后让烘干机 / 扫地机真的完成一次）。`POST /smart-home/webhook/:householdId`，时间戳 ±5 分钟 + 签名 `sha256(密钥 + sha256(密钥 + 时间戳 + "." + 原始请求体))`。**与要求的出入**：要求是 HMAC，但 HA 2026.9 的模板只有 md5 / sha1 / sha256 / sha512（输出十六进制文本）、没有 HMAC，也做不了字节异或，HA 侧拼不出标准 HMAC；改用两层包住密钥的带密钥哈希（防长度扩展），其余要求（可轮换、旧密钥宽限 24 小时、YAML 直接可用）照做。生成的 YAML 在一次性的 HA 2026.9.4 容器里真跑过：4 次请求签名全部对上。去重按 (家庭, 事件 id) 10 分钟（事件 id 用触发的 context id）。收到先推 smart-home、再跑联动、再推联动写到的域（webhook 没有登录用户，拦截器不发，由服务显式发）。三条联动写死在服务端、可开关、选触发实体：洗完 / 烘完 → 通知全家 +「晾衣服」；扫完 → 今天含「扫地」的家务打勾；滤芯低 → 「换净水器滤芯」+ 一分钟后提醒管理员 + 购物清单加「净水器滤芯」；都不重复建。以最早的家庭主人名义执行，显示名「智能家居联动」。新表 `smart_home_webhook_settings`、`smart_home_events`（迁移 1785232800000）。黑盒 `smart-home-webhook.mjs` 19 条；e2e 两条（假 HA 打 webhook → 今天页不刷新出现「晾衣服」；设置页生成配置、改开关、事件列表）；生成器单测 6 条；本地 test:api、test:web（344 passed / 42 skipped）全绿。本地第一轮 test:api 在两个镜像刚构建完、机器负载高时「等待 API 启动超时」（API 无报错），**未改代码重跑**通过。CI `36439271624` 首跑全绿；**注意**：CI 上 Playwright 已跑 14.6 分钟，贴近测试环境 15 分钟的访问令牌有效期，再加用例会一串 401，修法待定（见本轮汇报）。演示栈升到 `9916dc6`（回滚标签 `prod-before-20260928-231106`，备份 `backups-production/20260928-151107Z`）；从 King 的 HA 容器打 webhook（host.docker.internal 与局域网 IP 两条路）未签名都得 401，通路是通的。教训 35。 |
| E4 小管家 → HA | ◐ | `553a4bc`；合并 `0c89c85` | 代码与自动化验收完成，**真机验收待 King**（先在白名单给扫地机开放控制，「联动」页建「打扫 → 扫地机开始清扫」，把标题含「打扫」的家务打勾，看扫地机启动；HA 停掉时日历提醒照常）。links 端点 4 个（管理员）；一条联动 = 触发 + 目标，触发按标题关键词：`task_done`（家务打勾后）、`calendar_before`（有开始时间的日程开始前 0～720 分钟）；目标必须是白名单里开放了控制的设备 + 它有的动作。家务打勾经家务模块新增的进程内 `TaskEvents` 在事务提交后异步触发（打勾接口 24ms 就回，不等 HA；家务模块不依赖智能家居）；日程由联动自己的定时器（默认 30 秒）触发，与提醒派发互不相干，HA 停掉时日历提醒照常（黑盒验过）。执行走 E2 控制链路（权限、审计、8 秒超时），以家庭主人名义、显示名「智能家居联动」。幂等：`(规则, 那一次发生)` 唯一——同一天同一件家务取消再打勾不再跑、同一场日程只跑一次，改期后按新时间再跑。失败只在家庭动态里记「联动「…」没执行成功」。**防自激**：E3「扫完 → 打勾扫地」打的勾不触发 E4（联动身份带 sid 标记）。新表 `smart_home_links`、`smart_home_link_runs`（迁移 1785232900000）。黑盒 `smart-home-links.mjs` 18 条；e2e 一条（设置页建联动 → 家务页打勾 → 假 HA 收到开扫；HA 出错时打勾照常、规则显示没执行成功），只在桌面项目跑以省 CI 时长。本地两次「未改代码重跑」：① test:api 在构建镜像后「等待 API 启动超时」（Docker 占满 CPU；实测平时就绪 4.5～10 秒，`run-api-tests` 现在每次记录就绪用时）；② test:web 里 `guest-invitation` 桌面项目首个请求 `ECONNRESET`（推测是 keep-alive 连接复用撞上服务端 5 秒空闲关闭，未实锤；单独重跑 6/6 通过，与 E4 无关）。CI `36449377679` 首跑全绿。**余量告警**：CI 上 API 就绪 10.5～12.9 秒（上限 20 秒），Playwright 14.5 分钟（测试令牌 15 分钟）。演示栈升到 `0c89c85`（回滚标签 `prod-before-20260929-003052`，备份 `backups-production/20260928-163052Z`），联动调度无报错；截至升级时 King 尚未开放任何设备的控制、未配 webhook，E2～E4 真机验收都还没开始。 |
| R 智能家居页重做（插在 E5 前） | ◐ | 方案 `docs/ui-prototypes/smart-home-redesign.md`（二稿通过，十条拍板见其 §8） | 顺序 T0 → R1 → R1b ∥ R2a → R2b → R2c → R3 → dry-run 给 King → 升演示栈 → E5 |
| E5 今天页与收口 | ☐ | | |
| I1 位置字典 + 三处引用 | ☐ | | 见 `item-location-plan.md` §3；E5 之后、King 自用一周之前 |

状态：☐ 未开始 · ◐ 进行中 · ☑ 完成 · ✗ 放弃（写原因）
