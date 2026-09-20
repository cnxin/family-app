# 小管家 × Home Assistant 接入方案（待拍板）

> 状态：**设计稿，等 King 过目后再动手**。写于 2026-09-20。
> 上下文：客户端切换（Phase C）还在试用期，这件事排在 Phase E。
> 你已经定的三件事：范围是**读 + 控 + 双向联动**；先看设计再写代码；**HA 还没装**。

---

## 0. 一句话方案

小管家后端新增一个 `smart-home` 模块，用 **HA 的长期访问令牌 + REST/WebSocket** 连过去；
管理员在设置页挑出**一小撮家里人真正会碰的实体**，起中文名、分组、决定谁能控；
新客户端在「家务 → 智能家居」给一页，「今天」页给一张卡。
联动走两个方向：HA 的自动化用 webhook 打进小管家（生成提醒/家务/通知），
小管家的日程和家务完成时调 HA 的 service（开灯、跑场景）。

**一条重要的产品判断先说在前面**：HA 自己的 App 和面板已经很好，小管家**不该重做一个 HA 面板**。
这个功能的价值只在两处——① 家里人（尤其不装 HA App 的）在已经天天打开的那个页面上，
看得到、按得动那五六个最常用的东西；② 把智能家居的事件接进小管家已有的提醒/家务/通知体系里。
凡是"把 HA 的全部实体搬过来"的需求，答案都是"去用 HA App"。这条决定了下面所有取舍。

---

## 1. 第 0 步：HA 本身装在哪（这件事得先定，且会影响后面）

你还没装，所以这一步是前提，不是可选项。三个选法：

| 方案 | 好处 | 代价 / 坑 |
|---|---|---|
| **A. 独立设备（HA Green / 树莓派 + HAOS）** ⭐推荐 | 官方最完整的形态：能装 Add-on、蓝牙/Zigbee USB 棒直插、自动发现正常、升级一键 | 要再买一台小设备（HA Green 千元内），多一台机器要管 |
| B. NAS 上的 Docker/虚拟机 | 不用加设备；NAS 本来就 24 小时开 | Docker 版**没有 Supervisor，装不了 Add-on**；网络要用 host 模式才能自动发现；NAS 重启/升级会连带影响 |
| C. 这台 Mac mini 的 Docker | 机器现成，和小管家同机，网络最短 | **macOS 的 Docker 没有真正的 host 网络**，mDNS / zeroconf 自动发现基本残废，一大半设备要手填 IP；HAOS 在 macOS 上也不是受支持的安装方式。能跑，但会一路别扭 |

**我的建议是 A。** 智能家居和别的服务不一样：它要常年在线、要插 USB 网关、要自动发现，
和一台你随时会重启去跑构建的开发机放一起，迟早互相添堵。
小管家跑在 Mac mini、HA 跑在独立设备、两者同一个局域网互相调 HTTP——这是最省心的组合，
也和后面"迁到 NAS"的计划不冲突（小管家搬家不影响 HA）。

选定之后我需要知道的只有两件事：**HA 的局域网地址**（比如 `http://192.168.50.x:8123`）
和一个**长期访问令牌**（在 HA 里"个人资料 → 安全 → 长期访问令牌"生成）。令牌**你自己填进小管家的设置页**，
我不碰、也不写进任何文件——和 Plex/Emby 那些凭据一样的规矩。

---

## 2. 怎么连：三条路，选 REST + WebSocket

| 方式 | 结论 |
|---|---|
| **HA REST API**（`Authorization: Bearer <长期令牌>`） | ✅ 主力。读状态 `GET /api/states`、执行动作 `POST /api/services/<domain>/<service>`、健康检查 `GET /api/`、历史 `GET /api/history/period/<时间>`、日历 `GET /api/calendars` |
| **HA WebSocket API**（`/api/websocket`，同一个令牌） | ✅ 第二期加。后端开一条长连，`subscribe_events` 订 `state_changed`，只留白名单里的实体，前端就不用高频轮询了 |
| HA 的 MCP / Assist / 云 | ❌ 这一期不用。MCP 是给对话式 Agent 用的（以后小管家的"问问小管家"要能说"把客厅灯关了"时再说）；Nabu Casa 云要订阅，而且家里两台机器同一个局域网，走云是绕远路 |

**第一期的实时性就用轮询**：后端 10 秒拉一次 `GET /api/states` 存内存缓存，前端 TanStack Query 5 秒一次拿缓存。
和现在备份页、媒体连接器页的做法一致，不引入新机制。等真嫌慢了再换成 WebSocket 推。

---

## 3. 后端：沿用媒体连接器那一整套，不发明新东西

小管家已经有一套成熟的"外部服务连接器"骨架（`apps/api/src/media/integration-settings.service.ts`），
凭据加密、只写不读、家庭设置 vs 服务器默认、连通性测试、回调密钥轮换 + 来源 IP 白名单——全都现成。
**HA 直接复用，不另起炉灶。**

### 新增文件

```
apps/api/src/smart-home/            # 命名跟 smart-menu 一致
  smart-home.module.ts
  home-assistant.client.ts          # REST 调用 + 错误归一（照 media/connectors.ts 写）
  home-assistant.config.ts          # HOME_ASSISTANT_BASE_URL / _TOKEN / _TOKEN_FILE 的服务器默认值
  smart-home-devices.service.ts     # 白名单实体的 CRUD（别名、分组、能不能控、上不上首页）
  smart-home-states.service.ts      # 状态缓存 + 轮询
  smart-home-commands.service.ts    # 动作 → HA service 的映射 + 权限 + 审计
  smart-home-events.service.ts      # HA webhook 打进来之后做什么
  smart-home-links.service.ts       # 小管家 → HA 的联动规则
packages/contracts/src/smart-home.ts
apps/api/scripts/smart-home.mjs     # 黑盒脚本（照 media-connector-settings.mjs 写）
```

### 端点（草案，18 个）

```
GET    /smart-home/connector-settings               管理员；令牌只回「配没配」
PUT    /smart-home/connector-settings               地址 + 令牌（只写不读）+ 启用开关
DELETE /smart-home/connector-settings               恢复服务器默认
POST   /smart-home/connector-settings/test          连通性测试（打 HA 的 GET /api/）
POST   /smart-home/connector-settings/webhook       轮换 HA→小管家 的回调密钥（明文只回一次）

GET    /smart-home/entity-directory                 管理员；HA 上所有实体，用来挑白名单
GET    /smart-home/devices                          白名单设备（含中文别名、分组、可控性）
PUT    /smart-home/devices/:entityId                加进白名单 / 改别名、分组、谁能控、上不上首页
DELETE /smart-home/devices/:entityId                移出白名单

GET    /smart-home/states                           当前状态快照（缓存）
POST   /smart-home/devices/:entityId/command        执行动作（幂等键 + 审计）
GET    /smart-home/scenes                           白名单场景
POST   /smart-home/scenes/:entityId/activate        跑场景

GET    /smart-home/links                            联动规则列表
POST   /smart-home/links                            新建
PATCH  /smart-home/links/:id
DELETE /smart-home/links/:id
POST   /integrations/home-assistant/events/:secret  ⬅ HA 打进来的公开端点
```

### 数据表（4 张）

- `smart_home_devices`：`entityId`、`displayName`（中文别名）、`area`（分组）、`kind`、
  `controllable`、`minRole`（谁能控）、`pinnedToToday`、`sortOrder`
- `smart_home_links`：联动规则（方向、触发源、目标、参数、启用开关）
- `smart_home_events`：HA 打进来的事件流水（去重 + 排查用，按天清理）
- `smart_home_commands`：谁在什么时候按了什么、HA 回了什么（**审计必须有**，见 §6）

---

## 4. 前端：一页 + 一张卡

### 4.1 `/house/smart-home`（家务场景下新增一个分段）

左主列按分组（客厅、卧室、厨房…）铺卡片，每张卡一个设备：中文名、当前状态、一个开关或一组按钮。
右侧栏三块：**场景**（一键跑 HA 场景）、**传感器**（温湿度、门窗、有没有人在家，纯展示）、
**HA 连接状态**（和媒体那页的"媒体服务"块一个样）。

设备类型第一期只做这几种，其它一律当只读传感器显示：

| HA domain | 小管家里长什么样 |
|---|---|
| `light` | 开关 + 亮度滑杆（有 `brightness` 才显示） |
| `switch` / `input_boolean` | 开关 |
| `scene` / `script` | 一个"执行"按钮 |
| `climate` | 开关 + 目标温度 ±（不做模式矩阵，要精调去 HA App） |
| `cover` | 开 / 停 / 关 三个按钮 |
| `sensor` / `binary_sensor` | 只读一行 |
| `lock` / `alarm_control_panel` | **只读**，见 §6 |

### 4.2 `/house/smart-home/settings`（管理员）

挑实体进白名单、起中文名、分组、定"谁能控"、定"上不上今天页"。
从 `GET /smart-home/entity-directory` 拉 HA 上的全部实体，搜索 + 勾选，像媒体那页的用户映射。

### 4.3 「今天」页一张卡

只放被标了 `pinnedToToday` 的几个（建议不超过 6 个）+ 一行异常提示（门没关、有人不在家却开着空调之类）。
**这张卡是这个功能的主战场**——家里人 90% 的使用都发生在这里。

### 4.4 权限

- 看：全家都能看
- 控：默认**管理员 + 被标了 `minRole: member` 的设备**普通成员也能控（灯、开关这类）
- 设置页：只有管理员
- 后端每一个 command 都重新校验一次权限，**不信前端**（和现在的做法一致）

---

## 5. 双向联动

### 5.1 HA → 小管家（用 webhook，不用轮询）

在 HA 里建自动化，动作用 "发送 webhook 到 `http://<小管家>/api/integrations/home-assistant/events/<密钥>`"。
密钥由小管家生成、**明文只在生成那一次显示**、可随时轮换，并且校验来源 IP——
和刚做完的 MoviePilot / Plex 回调完全一样的机制，代码能抄。

小管家收到之后能做的事（在联动规则里配）：

- 发一条家庭通知（"洗衣机洗完了"）
- 建一条提醒（"垃圾车 20 分钟后到"）
- 建/完成一件家务（"扫地机器人跑完了" → 把"扫地"打勾）
- 往家庭动态里记一条（"爸爸到家了"）

HA 侧要不要 `local_only`：**保持默认的 true**（只允许同局域网打进来），不要为了图方便关掉。

### 5.2 小管家 → HA（调 service）

挂点就三个，不贪多：

- **日程**：日历事件开始前 N 分钟 → 跑一个场景（"家庭电影夜"开始前把客厅灯调暗）
- **家务**：某件家务被打勾 → 跑一个场景或关一个开关
- **菜单**：今晚有人做饭 → 打开厨房灯（这条纯粹是好玩，可以砍）

实现上复用现在的提醒调度器（`apps/api/src/reminders/`），到点调 `POST /api/services/<domain>/<service>`。
**失败一律不阻塞主流程**：HA 连不上，日历事件照常提醒，只在动态里记一句"联动没执行成功"。

---

## 6. 安全与兜底（这一节不接受妥协）

1. **白名单制**。小管家只认管理员显式加进来的实体。HA 上新增设备**不会**自动出现在小管家里。
2. **危险域默认只读**。`lock`（门锁）、`alarm_control_panel`（安防）、`cover` 里的车库门——
   第一期**一律只读**。家里的门锁不应该因为小管家的一个 bug 或一次误触就开。要控，单独再谈，
   而且得配二次确认 + 只限管理员。
3. **每条控制指令都落审计**：谁、什么时候、按了什么、HA 回了什么。出事能查。
4. **令牌只写不读**，存库加密（复用 `INTEGRATION_SECRET_KEY`），任何接口都不回明文。
5. **HA 离线不能拖垮小管家**：所有调用带 3 秒超时，失败就在页面上显示"连不上 Home Assistant"，
   其它页面完全不受影响。
6. **幂等**：每个控制按钮带幂等键，连点两下不会开了又关。

---

## 7. 拆成 5 个提交

| # | 内容 | 档位 | 验收 |
|---|---|---|---|
| E1 | 连接器 + 设置页 + 实体白名单（**只读**） | L | 填地址/令牌能测通；能挑实体、起中文名；`/house/smart-home` 能看到状态 |
| E2 | 控制（灯、开关、场景、空调、窗帘） | L | 按一下 HA 那边真的动了；权限和审计都在；断网不炸 |
| E3 | HA → 小管家（webhook + 联动规则） | M | HA 里建个自动化打过来，小管家生成通知/提醒/家务 |
| E4 | 小管家 → HA（日程、家务触发场景） | M | 日历事件到点跑了场景；HA 挂了不影响提醒 |
| E5 | 今天页卡片 + 异常提示 + 收口 | S | 首页卡片能按；四张截图看过；黑盒脚本和 Playwright 全绿 |

每个提交照老规矩：先读、hooks → 组件 → 页面 → 路由 → e2e → typecheck/lint → 截图 → 隔离套件 → 提交 → CI。
HA 在隔离库里必然是空配置，所以回归用 mock spec（和媒体那几页一样的做法）。

**排期建议**：E1 可以和 C2 试用期并行（只改 `apps/web` 和 API，不碰旧客户端）；
E2 之后涉及真实设备，最好等 C3 把旧客户端删干净、代码只剩一套了再做，省一半心智负担。

---

## 8. 需要你拍板的三件事

1. **HA 装哪**（§1 的 A/B/C）。定了我才能写 E1 的连通性部分。我推荐 A。
2. **门锁和安防要不要进来**。我的建议是第一期一个都不放，只读都不放——
   门锁状态显示在家庭页面上，本身就是个信息泄露面。
3. **今天页那张卡放哪几个设备**。你说几个具体的（比如客厅灯、空调、扫地机器人、门窗传感器），
   我按那个做布局；不然我只能做个通用格子，大概率不好用。

另外顺嘴一问：家里现在有哪些牌子的设备（米家？HomeKit？Zigbee？），
这决定 HA 要装哪些集成，也决定第 1 步选设备时要不要预留 USB 网关的位置。
