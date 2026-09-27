# F5b 半成品盘点（2026-09-22）

> 2026-09-22 用户已拍板，决定见 `docs/ia-plan.md` §3「2026-09-22 已拍板」。下文是拍板前的盘点，保留作交接记录。
>
> 给下一位执行者。这是盘点结论，不是新的产品决定。
> 基线：分支 `refactor/phase-0-safety-net`，与 `origin/refactor/phase-0-safety-net` 一致，HEAD `4040e71`（`docs: 回填 F5a 验收进度`）。没有未推送提交。
> 盘点时工作区只有未提交改动，没有改代码、没有提交。结论：**部分续用**。今天页已去掉「动态」和「未读统计」，但没有按拍板重排；桌面宽度下右栏在没有留意卡时也不会收起。
> 第 E 节的五个问题已于同日答复，见 ia-plan §3，不要再按「待拍板」处理。

## 工作规矩（之后每轮都适用）

- `pnpm` 一律用 `corepack pnpm`。工作分支 `refactor/phase-0-safety-net`，不合并 `main`，不开新的长期分支。
- 一个任务一个功能提交。功能提交 push、CI 绿之后，可以再补一个只回填进度表的 docs 提交。
- 提交信息中文。`Co-Authored-By` 写执行者自己，不要沿用上一任的署名。
- CI 失败后若未改代码重跑变绿，必须在汇报里单列，并说明根因或列为待查。
- `docs/ia-plan.md` §2「不做的事」和 §3 要当真。遇到要拍板的事停下来问，不要顺手做。
- 每轮开始先 `git status` 和 `git log origin/refactor/phase-0-safety-net..HEAD`。有未 push 的提交先 push。
- 工具拒绝写 `.github/workflows/` 时把 diff 贴给用户，不要绕过。

先读：`docs/ia-plan.md`（§0、§3「已拍板」、F5、文末进度表）、`docs/execution-plan.md` §1–§3、`docs/timezone-audit.md`「已拍板」、`packages/shared/src/date.ts`。F5a 实现在 `apps/api/src/today/` 和 `packages/contracts/src/today.ts`。

## A. F5b 要做的事

服务端 `GET /today/attention` 已在 F5a 算好。F5b 只把这份结果变成今天页和家里页上的卡片，并在相关数据变化后让它过期。

1. 一个查询 `useAttention()`：`staleTime` 1 分钟，窗口重新聚焦时重取。凡是会改变留意结果的写入，成功后都要让这个查询失效。可以并进现有的 `invalidateModules()`，但必须逐域核对。
2. 一份与 React 无关的文案函数：输入一条留意，输出域标签、标题、时间说明、主动作文案、跳转路径。只有 1 件时用具体名称（如「净水器滤芯 3 天后该换了」），多于 1 件用合并说法（如「3 件资产快到期」）。路径都走 `routes.ts`。能放 `packages/shared` 就放；依赖方向不允许就放 `apps/web/src/lib`，并说明原因。配 Vitest。
3. 卡片：域标签、时间说明、标题、主动作、「稍后」。用现有 `Card` / `Button` 和 token，暗色可用，触控区至少 44px。
4. 「稍后」写在 `localStorage` 的 `{ key, until }`。`until` 是响应里那个 `today` 在家庭时区的下一日零点，不是从现在起 24 小时。读写都要 `try/catch`。到点自己回来。
5. 四条硬规矩：一个域一张卡；每张卡都有一步到位的动作；不落库、不做已读未读；最多 5 张，多出来折成「还有 N 件」；一张都没有时整块不渲染，也不放「一切安好」。
6. 今天页保留现有聚合和「全家任务」口径。去掉「动态」和「未读统计」。顺序改为：三餐 → 任务（我的在前、全家在后）→ 当日日历与提醒 → 购物 → 需要留意。桌面 ≥1024px 时留意单独放右栏；没有卡时左栏撑满，不留空列。其他区块内部不动。动手前要核对消息未读是不是已经有导航角标。
7. 家里页图块的状态行用该域留意的短句；没有条目就不显示这一行，也不为状态行另开一组列表请求。`/` 和 `/home` 预取 `/today/attention`。
8. 端到端：造一件 3 天后要维护的资产，今天页出卡，主动作进到这件资产，用默认今天完成维护，回到今天页卡片消失；点「稍后」后刷新仍不出现；普通成员看不到管理员卡片；收起资产后卡片消失；桌面没有卡时主区没有空白列。截图至少覆盖两张卡，以及没有卡的桌面。

## B. 半成品对照

盘点时工作区：14 个已修改文件、6 个未跟踪文件，都在 `apps/web`，外加 `pnpm-lock.yaml` 里的 Vitest。没有 API 改动。

已修改：

- `apps/web/e2e/home.spec.ts`
- `apps/web/package.json`
- `apps/web/src/components/home-tile.tsx`
- `apps/web/src/lib/attention-prefetch.ts`
- `apps/web/src/lib/prefetch.ts`
- `apps/web/src/lib/queries/backups.ts`
- `apps/web/src/lib/queries/guest-invitation.ts`
- `apps/web/src/lib/queries/index.ts`
- `apps/web/src/lib/queries/modules.ts`
- `apps/web/src/lib/queries/polls.ts`
- `apps/web/src/lib/routes.ts`
- `apps/web/src/pages/home.tsx`
- `apps/web/src/pages/today.tsx`
- `pnpm-lock.yaml`

未跟踪：

- `apps/web/e2e/attention.spec.ts`
- `apps/web/src/components/attention-card.tsx`
- `apps/web/src/lib/attention-copy.test.ts`
- `apps/web/src/lib/attention-copy.ts`
- `apps/web/src/lib/queries/attention.ts`
- `apps/web/vitest.config.ts`

| 要求 | 状态 | 依据 |
| --- | --- | --- |
| `useAttention()`，1 分钟过期，聚焦重取 | 已完成 | `apps/web/src/lib/queries/attention.ts`。全局客户端把聚焦重取关了（`main.tsx`），这个 hook 单独打开 |
| 写入后失效，并逐域核对 | 部分完成 | 统一入口在 `queries/modules.ts` 的 `invalidateModules()`，里面顺手失效留意。仓库里没有核对表。覆盖见下方 |
| 文案纯函数 + 单测 | 部分完成 | `lib/attention-copy.ts`、`attention-copy.test.ts`、`vitest.config.ts`、`package.json` 的 `test:unit`。放在 web 而不是 shared，是因为它要调用 `routes.ts`。句式仍是模板：「净水器滤芯维护快到期」加旁边的「3 天后到期」，不是计划里的「净水器滤芯 3 天后该换了」 |
| 卡片结构、token、44px | 部分完成 | `components/attention-card.tsx` 用了 `Card`。主动作是手写样式的 `SoftLink`（`min-h-11`），「稍后」才是 `Button`。暗色走现有 token。盘点时没有在浏览器里看 |
| 「稍后」按家庭下一日零点 | 已完成 | 同文件 `nextHouseholdMidnight()`：`addDays(today, 1)` 再取 `startOfHouseholdDay()`。读写有 `try/catch`，到点用定时器放回来。时区用会话里的 `householdTimezone`，缺了才落回上海 |
| 一域一卡 | 已完成 | 合并在 F5a 的 `apps/api/src/today/today-attention.service.ts` `merge()`，键是 `assets:attention` 这种域级键。前端按返回的 `items` 一张一条 |
| 必有一步到位动作 | 部分完成 | 每张卡都有链接，路径在 `routes.ts` 的 `attentionPath()`。单件资产、行程、投票、兑换能落到现成详情或已有深链。点菜只拼了 `?date=`，点菜页不读它 |
| 不落库、无已读 | 已完成 | 只有浏览器本地的「稍后」，没有新接口，也没有已读状态 |
| 最多 5 张；没有卡就不渲染 | 已完成 | `AttentionSection`：`slice(0, 5)`，其余写「还有 N 件需要留意」；`visible` 为空则 `return null` |
| 去掉「动态」和「未读统计」 | 已完成 | `pages/today.tsx` 不再请求动态和消息，统计里没有「未读消息」，右栏换成留意。`TodayActivity` 还在 `today-aside.tsx`，今天页已经不用 |
| 按拍板顺序重排，我的任务在前 | 未开始 | 今天页仍是旧骨架：三餐，然后任务和日历并排，右栏是提醒、购物、留意。任务列表没有分成「我的 / 全家」 |
| 桌面 ≥1024px 右栏；无卡时左栏撑满 | 未开始 | `Page` 在 `lg`（Tailwind 默认 1024px）变成左右两列，右列写死 `lg:w-[320px]`。留意只是塞进这条旧右栏。没有卡时提醒和购物还在，右栏不会消失 |
| 家里页状态行，且不另拉列表 | 已完成 | `pages/home.tsx` 用同一条留意查询的标题当状态；没有条目不显示。`home-tile.tsx` 有 `data-home-status`。原来那一组资产/来访/行程/库存/投票/财务/备份列表预取已从 `attention-prefetch.ts` 删掉 |
| `/` 与 `/home` 预取留意 | 已完成 | `prefetch.ts`。`/` 同时去掉了动态预取。导航意图和路由表各预取一次，键相同，会合并成一次请求 |
| 端到端验收 | 部分完成 | `e2e/attention.spec.ts` 写了这些场景，但出卡、维护后消失、收起后消失都是页面里拦截 `/api/today/attention` 再手工把结果清空。没有证明真实端点和服务端收起。桌面无卡用例只断言区块不存在、没有横向滚动，没有断言左栏撑满。`home.spec.ts` 已改成家里页只打留意这一条 |

消息角标：侧栏和底栏都只渲染名称，没有未读数。未读数只在消息页自己里面。示意稿桌面「消息」旁边的数字没有对应实现。

四条硬规矩的位置：

- 一域一卡：F5a `today-attention.service.ts` 的 `merge()`。
- 一步到位动作：`attentionPath()` 和 `AttentionCard`。点菜这条还没落到那一天。
- 不落库、无已读：`attention-card.tsx` 的 `family-app.attention-snoozed`。
- 最多 5 张、没有卡不渲染：`AttentionSection`。

一个域合并成一张卡之后，动作只跟排序胜出的那一种 `kind`。访客若同时有「还没菜单」和「待处理点菜」，家里只会看到其中一个动作。

### 逐域失效

`invalidateModules()` 现在会连带失效留意。投票和备份另外直接调了 `invalidateAttention()`。

| 域 | 会改变留意结果的写入 | 失效 |
| --- | --- | --- |
| 资产维护 / 续费 / 保修 | 档案、续费、维护计划、完成维护，经 `invalidateAssets()` | 有 |
| 访客来访、点菜请求的接受/婉拒 | `invalidateGuests()` | 有 |
| 访客「当天还没有菜单」 | 加菜、改菜、完成菜单；另外 `GET /menus?date=` 会懒建当天早中晚三条空菜单 | 没有。公开邀请页上的失效发生在访客自己的浏览器里，家里人的今天页收不到 |
| 出行清单 | 行程、清单项、状态，经 `useTravelMutation()` | 有 |
| 库存临期批次 | 物品、批次、采购收货，经 `invalidateInventory()` | 有。厨房确认扣库 `useConfirmConsumption()` 只刷新库存列表，不刷新留意 |
| 投票 | 新建/关闭/归档走模块失效；投票、改票、撤票在 `useVotePoll()` 里直接失效留意 | 有 |
| 积分兑换审批 | `invalidatePoints()` | 有 |
| 财务预算超支 | 记账、冲销、预算增删，经 `useFinanceMutation()` | 有 |
| 备份失败 | 排队、取消、改策略，经 `useBackupMutation()` | 有。worker 心跳不是页面写入，靠 1 分钟过期和重新聚焦 |
| 收起模块 | `useSetModuleOverride()` | 有 |
| 小管家确认提案 / 提案组 | 确认时走 `invalidateModules()` | 有 |

## C. 类型检查和 lint（2026-09-22，未改代码）

`corepack pnpm typecheck` 通过（退出码 0）：`build-packages --check`、API、mobile、web 都过了。

`corepack pnpm lint` 通过（退出码 0）。API 是 0 error / 43 warning，属既有警告。mobile 和 web 没有新告警。没有修。

Vitest 和 Playwright 这一轮没有跑。

## D. 建议

部分续用。不要整份扔掉，也不要在现有今天页布局上接着补。

留下这些：查询 hook、文案函数和它的测试、Vitest 配置与锁文件、卡片和「稍后」的日界计算、5 张折叠、路径表、家里页状态行，以及把预取从七八个列表收成一个留意请求。失效并进 `invalidateModules()` 这条路是对的，多数域已经盖住。

重做今天页的排布，不要在旧右栏上继续堆。端到端里「出卡 → 做完 → 消失」和「收起后消失」要改成打真实接口；现在的拦截会把没接上的失效和没收起的模块测成绿的。文案在续用时改到计划里的说法，文件不用另起。

菜单失效先别补，等第 E 节第 4 题有答案。补错了只会在空菜单行上反复刷新。

## E. 需要用户拍板、文档里没有答案

1. 导航上没有消息未读角标。今天页的「未读消息」统计已经在半成品里删了。F5b 要补侧栏和底栏角标，还是先维持删除、角标另做？
2. 「我的在前、全家在后」里，待认领算我的、算全家，还是单独一组？已指派给当前成员的算「我的」，这一点按字面执行。
3. 「去点菜（带日期）」现在只是链接上带了 `?date=`。点菜页的日期在购物车里，不读这个参数。要落到那一天就得改点菜页，这超出了「不改页面内部」的边界。允许点菜页消费 `date` 吗？餐次用哪一顿？
4. 访客规则是「来访那天还没有菜单行」。可是打开某天的菜单接口会懒建早中晚三条空菜单，今天页自己就会打今天的这个接口。空菜单算不算「已经有菜单」？若算，当天来访的留意卡会被今天页自己拆掉。改成「有菜品才算」就要动已经提交的 F5a。
5. 「稍后」要不要按成员分开存？计划只要求 `{ key, until }` 和下一日零点。现在是整个浏览器共用一把 `family-app.attention-snoozed`，服务端的 key 又是 `assets:attention` 这种不含家庭、不含成员的域级键。同一浏览器换账号，会把对方的卡一起藏到下一日零点。
