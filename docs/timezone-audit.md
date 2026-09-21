# F4.5 · 时区与日期口径盘点

> 2026-09-21；基线 `643a363`；仅盘点，**没有修时区代码、迁移数据或开始 F5**。
> 本文的修法和排期均为建议，须用户确认。路径均相对仓库根；行号对应上述基线。

## 已拍板（2026-09-21）

以下决定覆盖本文原先的「建议 / 待拍板」表述，F4.6 按此验收：

1. 纯日期全程 `YYYY-MM-DD` / DB `date`，**业务上永不转换为时间点**；真实时刻使用带 offset 的 ISO / `timestamptz`。日期函数内部的 UTC 日历运算仅作实现细节，不作为业务时间点。
2. 资产维护新增 `performedOn`（`date`）为业务事实，保留 `performedAt`。服务端两者都接受：有 `performedOn` 以它为准；只有 `performedAt`（旧端）则按家庭时区取日期。`performedOn` 不得晚于家庭今天，下次到期日由它做纯日期加法。历史行从 `performedAt` **按所属家庭的时区**回填 `performedOn`。旧端不改。
3. 来访 / 日程等「约定时刻」的录入与显示一律按家庭时区。仅当设备与家庭时区不一致，时间旁显示「家里时间」，一致时不显示。行程内时刻例外：属目的地当地时间，不套家庭时区；本轮不动，后置。
4. F5「稍后」按家庭**下一日零点**恢复，不是经过 24 小时。
5. 家庭时区可修改、新建家庭默认采用浏览器时区属于 F7，本轮不做；现有家庭沿用已存时区，缺失时的现行上海默认保持不变。
6. 小管家夜间汇总、周报及工具上下文迁移，和本轮不涉的日期显示整理，均后置；本轮不重构显示组件。
7. F4.6 按 a 地基 → b 维护 → c 来访 → d 资产/库存/财务 → e 提醒测试 → f 手机跳过用例六个独立提交执行，之后全量 API / 新端验收、push、CI；完成后停在 F5 前。如发现盘点未涉及的**新一类**时区问题，先记录并请用户拍板，不扩大范围。

## 1. 结论与计数口径

- 不是「没有家庭时区」：`households.timezone` 已存在，默认 `Asia/Shanghai`，bootstrap 校验 IANA 时区；但只有部分功能使用它。
- 上午维护失败的直接原因不是 UTC 零点：两个客户端把纯日期转为**本地中午**，API 又把它当真实完成时刻检查；默认今天在本地 **11:55 前**会超过 `now + 5min`。
- 当前有三种「今天」：浏览器本地、固定上海、UTC 截日；另有真正按家庭时区的备份调度。改 NAS 的 TZ 不能统一它们。
- 实体共 **26 个 `date` 列**，下表全部覆盖；另审查维护完成、来访、提醒、定时事件等 `timestamptz` 字段。不要把所有时间点都改成日期。
- 测试盘点按**有业务日期输入 / 默认日期写入 / 时间边界断言**计数，不把每个登录请求的 JWT 时效、轮询 timeout、随机名称后缀算成一条日期用例。确认 **22 条日期相关 E2E 定义**，另有 **2 条仅填当前时间戳的 mock 定义**；API 按可定位业务场景分组计 **29 组、12 个脚本**。逐项见 §5；不是 `Date` 关键字命中数，也不是 Playwright 多设备实例数。

## 2. 「现在 / 今天」与运行环境

| 位置 | 实际口径 / 证据 | 问题与边界 |
| --- | --- | --- |
| 家庭设置 | `entities/index.ts:392`；`auth/auth.module.ts:293,334,379`：bootstrap 默认上海、Intl 验证后存家庭；`contracts/src/auth.ts:109` 接受 timezone | 在客户端和契约检索中，仅 bootstrap 输入有 timezone，没有供日常日期计算统一消费的会话家庭时区字段，也没有现成修改时区的设置流程；建议先只读暴露，不顺手做设置 UI |
| JS「现在」 | `new Date()` / `Date.now()` 是时间点；`getHours/getDate`、无时区的 Intl 才受进程 / 浏览器时区影响 | 必须区分「时钟错」和「同一时刻投影成不同日期」；本轮未发现需要修改系统时钟的证据 |
| 共享工具 | `packages/shared/src/date.ts`：`todayInShanghai` 固定上海；`parseDateOnly` 用 UTC 零点；`addDays/daysBetween` 用 UTC 日历运算；`dateString` 用 ISO UTC 截日 | UTC 仅作合法性校验或纯日期运算不构成已证实缺陷；把真实时间点交给 `dateString` 才有丢失家庭日界风险 |
| 生产 compose | `docker-compose.prod.yml:17,64,142`：db / api / web 设置 `${TZ:-Asia/Shanghai}`；**backup-worker 没有 TZ**。`docker-compose.agent.yml:40` 有同样默认 | 不要把 web 的第 142 行误认为 worker；无 TZ 不等于调度必错，须看业务 SQL |
| 开发 / CI | `docker-compose.yml`、`docker-compose.dev.yml` 未统一设 TZ；API / Web runner、两个 Playwright config、CI workflow 未固定业务 timezoneId / 时钟 | 开发机、GitHub runner 与浏览器可能采用不同默认值；测试中的 `SMOKE_DATE=2199-12-28` 是例外，不应漏算成冻结整个系统时钟 |
| 本机容器实测 | 2026-09-21 14:41 上海时间，只读执行 `docker exec … date`、Node Intl、`SHOW timezone`：prod API 环境 TZ=上海，**Node Intl=上海**；prod DB OS / SQL=上海；dev DB 无 TZ，OS / SQL=UTC；backup-worker 无 TZ，OS=UTC | prod API 的 shell `date` 却显示 UTC（与 Node 不同）。只设环境变量不足以推断每个运行时；未探查 NAS 远端，不将本机结果冒充 NAS 实测。没有重启 / 改容器 |
| 新前端 | `web/src/lib/queries/tasks.ts:11` 的 `todayISO` 抵消浏览器 offset，得到浏览器本地日期；calendar-month 使用本地日历；menus 用本地小时选餐；assets 用本地中午算天数 | 大多数页面跟着手机走；长时间打开的 useState 日期也不会自动因家庭午夜刷新 |
| 财务例外 | `web/src/lib/queries/finance.ts:47`、`api/src/finance/finance.module.ts:290,609` 均固定上海 | 当前前后端内部一致，但非上海家庭被忽略；撤销流水的 occurredOn 也按上海今天 |
| 旧前端 | `mobile/src/app/(tabs)/assets.tsx:920` 也把完成日期转本地中午；`mobile/src/lib/date.ts:15` 的 todayStr / Intl 多采用设备本地（财务有上海口径） | C3 前仍是可用客户端，修维护时不能只修新端；旧端 mock 不能当作真实时区验证 |

**跨时区的具体表现**：在 `2026-09-21T00:30:00Z`，上海是 9 月 21 日，洛杉矶是 9 月 20 日。
上海家庭的海外成员打开今天页、任务、点菜等会按手机取 20 日，但财务和服务端库存状态仍按上海 21 日；
出差者填写「来访 09:00」会转成**手机所在地**的 09:00 时间点，而不是家庭所在地的 09:00。
单改 NAS TZ 对显式 `Asia/Shanghai` 或浏览器本地逻辑都无效。

## 3. 按用户撞上概率排序的字段 / 风险表

工作量为单人实现 + 对应测试估算，不含产品确认 / 等待 CI；各项有共享基础设施，不能机械相加。
契约的 `dateOnly`=`z.iso.date()`；`isoDateTime` 要求 offset；`isoDateOrDateTime` 目前同时接受日期与时间点（`contracts/src/common.ts`）。
表中 `C`=packages/contracts/src，`A`=apps/api/src，`W`=apps/web/src；服务端旧 DTO 并未全部迁移 Zod，不能只看契约就断言实际拒绝行为。

| 优先级 / 字段（数据库） | 现状：前端 → 契约 → 服务端 / 数据库 | 问题 | 建议修法 | 预估 |
| --- | --- | --- | --- | --- |
| P0 维护完成 `maintenance_records.performedAt`（timestamptz），`nextDueDateBefore/After`（date ×2） | `W/components/asset-completion-form.tsx:68`、旧端 assets:920 将所选日转本地 12:00 再 ISO；C/assets:300 接受 date 或 datetime；A/assets:1304–1314 校验 `<= now+5min`，再 ISO 截日推进计划 | 每天上午 11:55 前默认今天被当未来；极端时区本地中午的 UTC 日期也可不同；API 直接传日期会解释为 UTC 00:00，在上海 08:00 前同样可能被拒绝 | 区分「实际完成日」与「记录时间」：建议独立 performedOn（date）承接表单，时间点另存；旧 API 兼容及历史回填须确认，不能猜用户原始时区 | 1–2 天，含新旧端 / 迁移兼容 |
| P0 今天 / F5 全域比较（非新增列） | W/tasks:11 本地今天；W/assets:36 本地中午差；A/inventory、agent 固定上海；尚无统一家庭 today 输入 | 海外成员日期不同；F5 如果复用现有 helper，会复制错误，午夜「稍后」恢复也会按错日界 | 统一 householdToday(now, zone)；F5 只接收明确的 today / now / zone，不在规则内部读系统时钟；家庭午夜失效 | 1–1.5 天基础设施 |
| P1 来访 `visits.startsAt/endsAt`（timestamptz）；`guest_meal_requests.mealDate`（date） | W/guest-forms:131 本地日期+时刻转 ISO；C/guests:220 接受 date 或 datetime；A/guests:299 按 UTC 截日起止生成点菜日期；A/calendar:228 用 UTC 00:00–23:59 查来访 | 上海 00:00–07:59 的来访可能进入前一天菜单 / 从当天日历漏掉；海外填写时间也无家庭时区提示 | 输入时显式家庭时区；真实时刻保留 timestamptz；按家庭时区生成 mealDate 和日历 `[日初,次日日初)` 查询边界，拒绝模糊纯日期时刻 | 1–1.5 天 |
| P1 资产 `home_assets.purchaseDate/warrantyExpiresOn/renewsOn`（date ×3）；`maintenance_plans.nextDueDate`（date） | 表单直接 YYYY-MM-DD；C/assets dateOnly；A/assets dateOnly 校验后保存，续费省略日期时用 todayInShanghai；临近项 W/assets 用本地日差 | DB 类型正确；今天来源不同导致「已到期 / 还有 N 天」分歧；续费默认上海忽略家庭设置 | 保留字符串和 date 列；默认 / 比较用家庭 today；维护的派生日采用确认后的 performedOn | 0.5–1 天（不含 P0） |
| P1 库存 `inventory_batches.receivedOn/productionDate/expiresOn/openedOn`（date ×4） | W/inventory-editor:190 默认本地 todayISO，直接日期字符串；C/inventory dateOnly；A/inventory-batches:67,83 默认入库日、临期状态固定上海；字符串比较日期 | 上海家庭海外用户录入默认日与服务端临期日不同；非上海家庭始终按上海判断 | 日期传输不变；服务端 has-status 与 F5 共用家庭 today；已过期是否也进入「≤3 天」由 F5 规则明确 | 0.5–1 天 |
| P1 财务 `finance_transactions.occurredOn`（date）；预算 month（YYYY-MM 字符串） | W/finance helper 默认上海；C/finance dateOnly；A/finance:310 UTC 仅验证日期，按字符串月范围查询；默认月份 / 撤销日期显式上海 | 上海家庭当前一致；换家庭时区，月末预算 / 默认记账 / 撤销归月可能不正确 | 月份从家庭 today 推导；月区间保持日期字符串，不把月初转 UTC 时间点；历史记账日不重算 | 0.5–1 天 |
| P1 提醒 `reminders.occurrenceDate`（date），`remindAt`（timestamptz） | W/reminder-form:154 本地日期+时间转 ISO；C/reminders occurrenceDate=dateOnly，remindAt=isoDateOrDateTime；A/reminders:135 new Date，要求真实未来时刻；定时投递比较 now | occurrenceDate 是来源任务的日期，remindAt 才是时刻；date-only 输入提醒在正时区清晨与下午可有不同未来判断；跨时区手机默认时刻歧义 | occurrenceDate 保留纯日期；remindAt 收紧为带 offset 的真实时刻，表单标明家庭时区；已有绝对触发时刻不整体平移 | 0.5–1 天 |
| P2 任务 `household_tasks.startsOn/endsOn`、`household_task_instances.dueDate`（date ×3） | W/tasks todayISO 本地默认；C/tasks dateOnly；A/tasks 使用 UTC 日历加减 / 星期生成实例并按日期范围查询 | 纯日期运算本身无误；两个成员的「今天任务」可能查询不同日；跨午夜页面保留旧日期 | 保留日期列 / recurrence 算法，统一默认今天、到期判定与午夜刷新 | 0.5 天 |
| P2 日历 `calendar_events.date`（date），可选 startsAt/endsAt（timestamptz） | 全天事件直接 date；定时事件本地输入转 ISO；C/calendar dateOnly + datetime 联合；A/calendar:120–145 独立解析日期和时刻、验证先后 | 没有统一说明 date 应按哪个时区投影；可能 date 和 startsAt 的家庭日期不一致；来访聚合另有上述 UTC 查询缺陷 | 全天事件永不时刻化；定时事件显式时区，校验所属家庭日期 / 跨日规则；先修查询边界再改展示 | 0.5–1 天 |
| P2 点菜 / 购物 `menus.date`、`shopping_items.date`（date ×2） | 日期选择直接字符串；C/menus、shopping dateOnly；API 按家庭+date 查询；默认今天和默认餐次来自浏览器 | 数据不串家庭，但海外成员默认点到另一日；演示数据也采用运行机器本地日期 | 统一家庭今天；默认餐次是否按家庭时区一起切换需确认，避免日期按家庭而小时按手机 | 0.5 天 |
| P2 出行 `travel_plans.startDate/endDate`（date ×2） | W/travel-forms 默认本地 today+7/+8；C/travel dateOnly；A/travel:313 以 UTC 验证、比较起止，不当作真实出发时刻 | 当前是计划日期，不含目的地时区；F5 的「7 天内出发」若用本地今天会分歧 | 保持 date，F5 以家庭 today 判定；此轮不扩展多目的地 / 航班时区产品 | 0.25–0.5 天 |
| P2 智能菜单 `smart_menu_plans.startsOn/endsOn`、`smart_menu_candidates.targetDate`（date ×3） | 日期字符串；C/smart-menu dateOnly；A/smart-menu:74,411 todayInShanghai，生成窗口和临期食材采用上海日 | 非上海家庭日期窗口不一致，可能与客户端点菜日错开 | 和库存、点菜一起切家庭 today，保持区间为纯日期 | 0.5–1 天 |
| P3 片单 `household_media.scheduledFor`（date） | W 直接日期输入；C/media dateOnly；服务端按日期保存 / 日历聚合；本地中午仅用于日期显示 | 当前没有已证实未来校验 bug；默认日 / 提醒关联仍需同一语义 | 日期不改类型，显示直接处理年月日；回归非整点时区和 DST | 0.25 天 |
| P3 回忆 `family_memories.happenedOn`（date） | W/memory 表单默认 todayISO；C/memories dateOnly；服务端保存日期，页面本地中午用于展示 | 事件发生日属于用户选择；默认日随手机变化，不能迁移时把旧日期重新投影 | 仅统一默认日并保留用户覆盖；历史 date 原样保留 | 0.25 天 |
| P3 投票关闭 / 邀请到期 / 登录与智能体 TTL / worker 心跳（timestamptz） | 时间点与 now 比较，JWT epoch 秒；它们不是纯日期字段 | 主要是时钟偏差和短超时竞态，不是 UTC 日界错误；F5 投票开放状态要用 now，不用 today | 保持时刻语义，测试注入时钟；不将所有 `new Date` 一刀切删除 | 0.5 天测试整理 |

### 可复现边界（代码推导 + 独立日期表达式验证，不是端到端实跑）

已用 Node 在 Asia/Shanghai、Pacific/Kiritimati、Etc/GMT+12 三个 TZ 下执行相同日期转换 / 比较表达式：09:00 与 11:54 拒绝、11:55 不拒绝；UTC 输出分别为 21 日 04:00、20 日 22:00、22 日 00:00。未向业务 API 写入数据。

1. 上海 `2026-09-21 09:00`：表单默认完成日 → `2026-09-21T04:00:00Z`（上海中午），当前为 `01:00Z`，超前 3 小时，必过不了 5 分钟容差。11:55 开始才进入容差。
2. API 直接提交 `performedAt: '2026-09-21'`：解析为 `00:00Z`（上海 08:00），07:00 提交仍是未来；因此「只把前端改为日期字符串」不是完整修复。
3. 上海 9 月 21 日 07:00 来访 = `2026-09-20T23:00Z`；当天的 UTC 查询从 `2026-09-21T00:00Z` 开始，查不到它；visitMealDates 也得到 20 日。
4. `UTC+14` 的本地中午在 UTC 前一天，`UTC-12` 的本地中午在 UTC 次日。用「中午」回避常见偏移不能成为通用日期模型。
5. 财务 `monthRange` / 任务 `shiftDays` / 日期合法性校验内部用 UTC，但输入输出仍是日期字符串；不能据此判为上述 1–3 类 bug。

## 4. 定时逻辑

| 逻辑 / 证据 | 现状 | 问题 | 建议 / 预估 |
| --- | --- | --- | --- |
| 备份 / 恢复演练：A/system/system.module.ts:611–663 | SQL `now() AT TIME ZONE households.timezone` 计算下一次本地计划，再转回时间点；调度器按到期队列生成任务 | **已使用家庭时区**，不是需要整体重写的模块；DST 不存在 / 重复时刻的策略尚未有专项验收 | 保留 SQL 路线，补 DST 边界及家庭时区测试，0.5 天，可后置 |
| backup-worker：scripts/backup-worker.sh:74,101,227,273 | 轮询领任务、now 心跳、interval 保留期；文件名 `date -u`；没有自己按「每天几点」触发 | worker 无 TZ 不会把家庭计划自动变成 UTC；文件命名 UTC 是合理的 | 保持；注明监控显示区和 retention 是经过时长，0.25 天 |
| 提醒：A/reminders/reminders.module.ts:175,654–659 | setInterval 扫描 `remindAt <= new Date()`，按绝对时间触发 | 调度本身不受日界影响；问题主要在录入时区 / 模糊 date-only 契约。后台停机造成晚发是另一类问题 | 修录入边界，保持触发语义；相对时间测试加裕量，0.5 天 |
| 夜间汇总 / 临期 / 周报：A/agent/agent-routine.service.ts:66–115,519,555,649 | todayInShanghai、`+08:00`、固定上海周界；周报按周日排期、周一日界汇总；每日限额 / 幂等键也按上海日 | 忽略家庭 timezone；搬去海外或自设时区的家庭不会按本地晚间 / 周末收到；固定 24h / 7d 不是支持 DST 的算法 | 后续独立 agent 调度批次迁移：家庭本地日期算下次时刻，明确 DST 策略 / 防重复；1–2 天 |
| 小管家工具与提示词：A/agent/agent-tools.service.ts、agent-runtimes.ts:64 | 默认查询日期、库存临期以及提示词「当前日期」固定上海 | 家庭今天与模型理解可能不同，不能仅改 prompt 文案 | 随 agent 调度批次统一上下文时区；0.5–1 天 |
| 清理 / 通知重试 / 媒体会话闲置 | 以 now、deadline、毫秒 / interval 比较，不按日历日 | 通常无需切家庭日界；「保留 N 天」是经过时长还是本地日仍应保留现有语义 | 不列为 F5 阻塞，不在本轮顺手重构 |

## 5. 测试当前时间依赖清单

### 5.1 方法与覆盖边界

扫描新旧端 `e2e/*.spec.ts`、fixture / helpers 和 API `scripts/*.mjs` 的 Date / now / today / 相对日期，再沿调用处和默认表单核对。
下面 **E1–E22 是 test 定义**（不乘 mobile/desktop，不重复算 setup）；**A1–A29 是脚本内业务场景**（API 没有统一 test() 注册，不能伪报成 29 条框架测试）。
仅截图冒烟「打开会显示日期的页面」但不构造 / 断言日期业务，以及随机 ID、updatedAt 展示、通用 JWT / 等待超时，不纳入日期回归数；其间接数据依赖另说明。
本轮是静态盘点和容器只读检查，**没有把全套用例在多个冻结时钟逐一实跑**，风险不等于已重现失败。

| 编号 | E2E（路径省略 apps/；标题保留可定位部分） | 当前时间依赖 / 一天不同时刻的风险 |
| --- | --- | --- |
| E1 | web/e2e/write-paths.spec.ts:19 点菜：明天晚餐 | 文件加载时 isoDate(1)，测试进程本地日；跨午夜后与 UI 今天不同，但显式选日通常仍稳定 |
| E2 | 同上 :51 任务：今天的事 | UI 默认今天、新建后当天列表；跨午夜查询 / 默认日期不同时求值可能看不见 |
| E3 | 同上 :74 日历：全天事件 | 明天日期在文件加载时生成，UI 当前月来自浏览器；月末 / 跨午夜需验证目标日是否仍在网格 |
| E4 | 同上 :112 提醒：事件建提醒 | isoDate(+3)，表单按来源日期给未来时刻；缓冲充足，通常不受上午 / 下午影响 |
| E5 | 同上 :149 消息：划掉点菜 | isoDate(+2) 用于写入菜单；日期参与夹具，断言通知不依赖当天，低风险 |
| E6 | 同上 :555 访客：安排来访 / 邀请 | isoDate(+2) + UI 本地时刻；当前成功不证明家庭日界正确 |
| E7 | 同上 :657 资产维护 | 首次到期=明天；**:705 显式填昨天**，避开上午中午未来缺陷，所以绿灯没有覆盖默认今天 |
| E8 | 同上 :734 财务：记账 / 撤销 | 默认上海今天和当前月；月末跨上海午夜，页面月份快照与撤销日期可不同 |
| E9 | 同上 :788 财务预算 | UI 当前月份；跨月前后如果重新求值，预算所属月可能不同 |
| E10 | 同上 :910 回忆：记一条 | 默认 todayISO；只是校验创建内容，日界通常不致失败，但没有验证家庭发生日 |
| E11 | 同上 :962 出行：建行程 | UI 默认今天+7/+8；正向 CRUD，通常无时段差异 |
| E12 | 同上 :1024 出行模板 | isoDate(+3/+4)，显式传参，低风险；同一夹具跨午夜应共用基准 |
| E13 | 同上 :1184 片单：已排期 | tomorrow 作为观影日，显式提交；一般稳定 |
| E14 | web/e2e/guest-invitation.spec.ts:20 邀请：参加 / 点菜 | 文件级 isoDate(+1)；夹具以该日组织菜单，尚未覆盖上海清晨来访 |
| E15 | mobile/e2e/food-batches-smart-menu.mock.spec.ts:227 食品批次与智能菜单 | today=UTC ISO 截日，UI 本地今天；上海 00:00–07:59 两者不同，mock 可能掩盖真实状态计算 |
| E16 | mobile/e2e/consumer-workbench.mock.spec.ts:193 今日工作台 / 快捷新增 | UTC today 注入任务 / 菜单 / 预算；设备本地 today 可能不同 |
| E17 | 同上 :284 工作台小屏 / 横屏 | 同一 UTC today 夹具；主要布局断言，风险是未覆盖真实按日期过滤 |
| E18 | mobile/e2e/apple-core-ui.spec.ts:208 核心模块原生层级 | UTC today + UTC 中午算偏移，客户端本地日；同 E15，不能代表午夜业务正确 |
| E19 | mobile/e2e/agent-ui.spec.ts:64 管理员使用小管家 | :116 提案日期用 UTC today；上海早晨可能提交昨天任务；应固定业务时钟并断言日期 |
| E20 | mobile/e2e/family-navigation.spec.ts:103 核心页面浏览 | 大型综合用例内包含今天任务、日历「明天」写入；相对 UI 日期随运行时刻变化，长用例跨午夜尤其应固定 |
| E21 | mobile/e2e/finance-ui.spec.ts:338 首次建账 / 预算 / 记账 / 撤销 | mock 固定 2026-08-12，响应又可回显请求月份；UI 默认当前月；能通过不代表真实跨月筛选正确 |
| E22 | mobile/e2e/apple-assets-profile.mock.spec.ts:151 订阅确认续费 | mock 固定旧续费日并返回 2026-09-19，操作仍使用 UI 默认续费今天；掩盖真实推进规则，不是时段边界验收 |

**另 2 条时间戳 mock（不计上面 22 条业务日期定义）**：`web/e2e/media-history.mock.spec.ts:4`、`media-library.mock.spec.ts:16` 用 new Date 填观看 / 同步时间，不断言「今天 / 昨天」边界，目前不因上午 / 下午改变业务结果。

**不在普通 CI 覆盖内的 live 场景**：`mobile/e2e/agent-hermes-live.spec.ts:908–918` 中待办、这周安排、快过期、购物、下周点菜、天气、明天安排共 **7 个相对当前时间的业务场景**；另有本月财务查询（:1032 还假定开发家庭本月真实支出为 0）。这些是 runHermesLiveTest 内场景，注册 test 数随环境筛选改变，不能简单并入 22。
使用真实开发数据 / 外部天气 / 模型，失败可能是数据变了而非时区。固定历史资产保修 / 媒体日期若只断言原值，不算当前时间依赖。

| 编号 | API 黑盒脚本（apps/api/scripts/）与场景 | 当前时间与时段风险 |
| --- | --- | --- |
| A1 | assets.mjs:359 维护完成 / 幂等 / 推进 | now-60s，再 UTC 截日造期望；与 API 同错仍绿，上海 08:00 附近会切 UTC 日但不能验证家庭完成日 |
| A2 | assets.mjs:522 维护来源提醒 | now+60s；一般稳定，极慢请求可耗尽裕量；不是早晚差异 |
| A3 | food-batches-smart-menu.mjs §2 批次临期 | 文件级上海 today，造 -1/+2/+30 天；跨上海午夜可能改变状态 / 余日 |
| A4 | 同上 §3 购物入库 | today+10、批次 +15；低时段敏感度，仍依赖动态基准 |
| A5 | 同上 §4 FIFO 扣库 / 撤销 | today+20 菜单及动态批次；一般稳定，未覆盖家庭日界 |
| A6 | 同上 §5 智能菜单 | today+30，远期缓冲；验证生成而非午夜边界 |
| A7 | agent-tools.mjs:122–453 只读工具日期夹具 / 聚合 | 上海 today，资产+15/+30、库存+3、出行等；工具内部再次求今天，跨午夜存在基准漂移 |
| A8 | agent-routines.mjs §1 设置 / 下一次周报 | 按真实 now 计算 nextRunAt，断言上海周日；周日计划时刻前后路径不同 |
| A9 | 同上 §2 每日通知上限 | 上海日计数；跨午夜重新计数，预期可能变化 |
| A10 | 同上 §4 同日幂等 / 晚到事项 | 多轮执行默认同一天；跨上海午夜可能变成两个幂等日 |
| A11 | 同上 §5 订阅 / 药品临期 | :689 上海 today 动态夹具；午夜附近临期窗口偏移 |
| A12 | 同上 §6 周报聚合 | :864 reportDate 动态；跨周、跨日时集合边界可能改变 |
| A13 | 同上 §7 周级幂等 | now 强制到期；如果跨周重算周键，预期不再是同一周 |
| A14 | 同上 :646 停用 owner 仍推进未来运行 | nextRunAt > Date.now；调度阈值 / 请求耗时敏感，未固定时钟 |
| A15 | reminders.mjs:173 到期唯一投递 | now+700ms；机器慢时创建前就过期，是确定的短裕量竞态，不是时区 |
| A16 | 同上 :213 来源失效自动取消 | now+900ms，随后删来源；慢机可能先发出再删来源 |
| A17 | 同上 :205 已发不可编辑 | PATCH now+60s；断言状态不可变，通常与早晚无关 |
| A18 | backups.mjs §1 策略与下一次运行 | 真 now + 家庭 timezone 计算，计划时刻前后走不同分支；已有检查不足以覆盖 DST |
| A19 | 同上 §4 worker / 容量健康 | 写 now 作为 workerLastSeenAt；长停顿可能变离线，属时长阈值 |
| A20 | playback-webhook.mjs:236 Plex / Emby 乱序与去重 | now-20s…now；一般无日界依赖，主要验证事件时间 / 到达顺序 |
| A21 | bootstrap-invitations.mjs:184 过期邀请 | SQL now-1min；正常时钟下稳定，不受早晚影响 |
| A22 | agent.mjs:255–279 运行令牌有效 / 过期 | SQL now+5min / -1min；通常稳定，极慢执行会耗尽 TTL |
| A23 | 同上 :759 过期行动提案 | SQL now-1min；时间点语义正确，低时段风险 |
| A24 | agent-memory.mjs:432 陈旧候选清理 | createdAt=now-15days；经过时长阈值，通常稳定 |
| A25 | 同上 :445 到期记忆 | expiresAt=now-1min；通常稳定 |
| A26 | agent-retention.mjs:242 过期会话清理 | SQL now-1min；异步等待敏感但无本地日界假设 |
| A27 | 同上 :313 保留天数清理 | updatedAt=now-(retentionDays+1)days，expiresAt=now+1day；留足一天裕量，通常稳定 |
| A28 | agent-proposal-groups.mjs:516 提案组过期 | SQL now-1min；低时段风险 |
| A29 | 同上 :650–658 例行任务推进 | nextRunAt=now-1min，等待推进后断言 >now；调度 / 等待阈值敏感 |

其他时钟命中不混入 29 组：
- `smoke.mjs` 单独运行默认 UTC today，但全量 runner 明确设置 `SMOKE_DATE=2199-12-28`，因此全量验收不依赖真实今天；`demo-data.mjs:45,54,269` 是 Web 种子，按运行进程本地日生成日期 / 提醒，间接影响所有读取演示内容的截图冒烟。
- `system-modules-fixtures.mjs`、`household-isolation.mjs` 的 JWT iat/exp；agent-profiles、finance、agent-memory 等造运行令牌的 now+Nmin；system-modules 的 archivedAt 非空标志；随机名称、耗时统计，不是独立日期业务断言。
- API finance 的固定记账夹具、tasks / calendar / guests / travel 的固定日期主要验证存取或顺序；其中实际创建的令牌 / 邀请仍有 TTL。固定「未来」日期也有最终到期风险，应在时钟注入批次统一处理，不宣称永远稳定。

**建议验收矩阵**（待确认后实施）：家庭 Asia/Shanghai / America/Los_Angeles / Europe/Berlin，浏览器时区相同和不同；家庭 00:01、07:59、08:01、11:54、11:56、23:59、月末 / 年末；DST 春季跳时 / 秋季重时。API 注入 clock，浏览器固定 clock + timezoneId，测试进程基准显式传递；不能只改 runner 的 TZ。

## 6. 统一口径建议与批次（待拍板）

### 建议采用的原则

1. **纯日期全程 YYYY-MM-DD + DB date**；业务含义是家庭日历日（回忆 / 出行允许用户显式选别的日），不转换成实际时间点。日期校验 / 加减可在封装内部用 UTC 算术，但不得泄漏 Date 给业务层或与 Date.now 比较。
2. **真实时间点保持 offset ISO + timestamptz**：来访起止、定时日程、提醒触发、创建时间、令牌 TTL。不把它们变成 date；date-only 不应成为这些字段的含糊替代输入。
3. **复用 households.timezone** 作为家庭「今天 / 本月 / 本周」单一来源，默认上海用于现有家庭；只读传给前端和 agent。手机时区只影响明确标记的个人本地显示，不隐式改变共享日期。
4. F5 rules 接收显式 `{today, now, timeZone}`；纯日期字符串比较，先算日历阈值再筛选；off 的域仍不出卡。「稍后」到**家庭下一日 00:00 的时间点**，不要用 now+24h；按 household+member 隔离，跨时区 / DST 要测试。
5. 实际时间点转为家庭日时使用显式时区；查询家庭某日使用 `[家庭日初, 下一日初)`，不拼 `T00:00Z`、不固定加 86,400,000ms。
6. 历史 date 原样保留。维护 performedAt 的历史真实意义不确定，不能批量按新时区重写 / 猜原始日期；需选择兼容和回填规则。

### 分批建议

| 批次 | 建议范围 | 为什么 / 验收 | 估算 |
| --- | --- | --- | --- |
| T0，**F5 前必须** | 家庭时区只读上下文、共享纯日期 / 家庭日界 helper、注入 now、前端家庭午夜失效、规则测试时钟 | F5 today、7天/3天窗口、预算本月、「稍后」有一致输入；新增非上海 / DST / 月界测试 | 1–1.5 天 |
| T1，**F5 前必须** | 维护完成日模型 / 默认今天 bug，新旧端兼容；访客家庭日界查询 / 点菜日期；F5 读取的资产、库存、财务默认 / 状态统一 | 否则维护卡主动作上午失败，访客卡漏人，库存 / 预算卡与详情矛盾；默认今天上午和上海清晨来访必须回归 | 2–3 天，取决于迁移选择 |
| T2，F5 前完成所需测试，其余后置 | 上述用例固定时钟 / 浏览器时区；reminders 700/900ms 竞态单独精确修，不用重跑掩盖 | F5 四种日期边界有确定性保障；全套 API + 两端 CI；不以昨天夹具代替默认今天验收 | 0.5–1 天 |
| T3，可 F5 后独立做 | agent 夜间 / 周报 / 工具切家庭时区；备份 DST 明确化；不被 F5 消费的日期显示、旧端其余默认日与完整测试迁移 | 范围较大、不把 agent 重建夹带进 F5；记录过渡期 agent 仍固定上海的限制 | 2–3 天 |

**需要用户确认**：是否按 T0/T1/T2 先修再 F5；维护增加 performedOn 并保留 performedAt 的兼容路线和历史回填策略；输入真实日程 / 来访默认按家庭时区（而非手机时区）；家庭午夜的「稍后」与 DST 歧义策略（建议不存在时刻顺延、重复时刻只执行一次）。本轮仅建议，不实施。

## 7. 本轮前置任务记录

- `b212e47`：模块刷新失败有同家庭缓存就保留（包括 off）；无可用缓存才全放行；真实先成功、收起后 500 的 e2e 已补。typecheck / lint 通过（43 个既有 API warning）；新端 179 passed / 5 skipped；CI `35560665929` 首跑四项全绿。
- `643a363`：独立 `web-next-tests` job，用独立 PostgreSQL 服务和 runner 临时库 / API / Vite，旧端保留。CI `35561356642` **首跑五项全绿**；新 job 实测 **8分37秒**，预计常态约 7–13 分钟（缓存 / runner 负载影响），与旧端并行；并非再串行增加 8 分钟。
- 5 个 skip 是项目实例，不是五个功能完全未测：nav:22 桌面侧栏在手机跳过；nav:46 手机四栏在桌面跳过；nav:81 手机直达 / 头像在桌面跳过；write-paths:470 记忆、:520 小管家设置在手机跳过，桌面执行。后两条既有理由是共享唯一记忆键 / 设置版本冲突；**目前 workers=1、fullyParallel=false，注释的并发理由已不是当前配置事实**，本轮不顺手扩大测试范围，后续可单独评估取消跳过。
- 以上两次没有 CI 失败后未改代码重跑；本次日期盘点不以「全绿」宣称时区正确。

- F4.5 文档提交前重新执行 `corepack pnpm typecheck` / `corepack pnpm lint` 均通过（API 43 个既有 warning），`git diff --check` 通过；本次不改 API / packages，不额外启动迁移或日期修复。
