# 小管家 · 信息架构收敛执行计划（Phase F，交接给执行 agent）

> 放进仓库 `docs/ia-plan.md`。自包含：读完就能开工。
> 硬规矩、SOP、提交格式全部沿用 `docs/execution-plan.md` §1～§3，这里不重复。
> 设计稿（结构示意，配色字体不算数）：https://claude.ai/artifact/3wPCxr9NFSFBjauGCpmPRJ
>
> **本文件覆盖 `execution-plan.md` §0 里「框架已定型、不要再动框架」这一条中关于导航的部分。**
> 用户已于 2026-09-20 点头：五场景导航改成下面这套。`Page/Panel`、`SoftLink`、预取、骨架屏、动效规范都不动。
>
> **排期：插在 C1 之后、C2 家庭试用之前。** 家里人的第一印象应该是收敛后的样子，试用反馈才有用。
> E（Home Assistant）排在 F 之后，HA 的「今天页卡片」直接用 F5 的机制，不另做一套。

---

## 0. 为什么做、做成什么样

问题：24 个分段全是同等权重的「目的地」，五场景只是给功能清单分了组。功能都有用，但一堆摆着头疼。

原则一句话：**高频功能你去找它，低频功能它来找你。**

| 层 | 是什么 | 怎么到达 |
| --- | --- | --- |
| 常驻（core） | 每天用的：今天、点菜、厨房、购物、日历、任务、消息 | 桌面侧栏固定项；手机底部 4 个 tab |
| 架上（shelf） | 有用但低频：菜谱、库存、提醒、投票、积分、观影、资产、财务、访客、出行、知识库、回忆、家庭动态、问问小管家、（将来）智能家居 | ① 今天页有事才出卡片 ② ⌘K 搜页面或动作 ③ 上下文里的入口 ④「家里」启动台 ⑤ 成员自己钉到导航 |
| 设置（settings） | 家庭运维：成员、备份、观影连接器、家庭通知渠道、助理管理设置；个人资料与成员偏好另走本人入口 | 家庭运维由管理员在「家庭设置」集中进入；成员自己的三类设置从头像 → 个人页始终可达（见 §3） |

**不删任何页面，不改任何页面内部。** 这次只动「怎么到达」。

收敛后的形态：

- **手机**：底部 4 个 tab——今天 / 吃饭 / 日程 / 家里。「我的」缩成今天页右上角头像。吃饭、日程仍按下弹气泡，但气泡里只列 core 分段（吃饭 = 点菜·厨房·购物；日程 = 日历·任务·消息）。今天、家里直达，不弹气泡。
- **桌面**：侧栏不再是手风琴。从上到下：品牌 → ⌘K 搜索框 → 7 个 core 平铺 →「我钉住的」→（弹性空白）→ 家里（全部功能）→ 家庭设置 → 成员头像。
- **家里页** `/home`：三段——我钉住的 / 家里在用的 / 还可以开启。
- **今天页**：新增「需要留意」区，低频域在这里按需冒出来。

---

## 1. 任务清单

工作量档位同 execution-plan：S ≤ 半天，M ≈ 1 天，L ≈ 2 天。按 F0 → F8 顺序做，每个一个提交。

### F0 · 盘点 ［S］

- **先读**：`apps/web/src/lib/nav.ts`、`components/shell.tsx`（及它拆出去的文件）、`components/command-palette.tsx`、`pages/today.tsx`、`lib/prefetch.ts`、`lib/routes.ts`、`App.tsx`。
- **产出**：在本文件末尾「盘点表」里，给现有每个分段填一行：
  路径 · 归哪一层（按 §0 的表，有异议写备注）· 现在有哪些上下文入口（从哪些别的页能跳进来）· 是否支持 `?create=1` 之类的深链 · 有没有「空态」判断可以复用。
- **同时确认三件事并写进备注**：
  1. `today.tsx` 现在已经聚合了哪些东西（别重做）；
  2. `system` 模块里有没有现成的「家庭级设置」存储（F3 要用）；
  3. 成员级偏好现在存哪（`/me/profile` 的「经常掌勺」「启用记忆」走的哪个端点、哪张表——F4 的置顶要不要跟着存服务端，看这个）。
- **不改代码。** 提交：`docs: 信息架构收敛盘点`

### F1 · `nav.ts` 分层模型 + 导航外壳 ［M］

- **改 `lib/nav.ts`**：每个分段加 `tier: 'core' | 'shelf' | 'settings'`，加 `glyph`（一个汉字，家里页图块用，如 资/账/客/行/影/票/分/库/知/忆）。保留 `SCENES` 以便气泡菜单和旧路径换算继续工作，但新增导出：
  - `coreSegments()`：按固定顺序返回 7 个 core；
  - `shelfSegments(member)`：返回 shelf，已按 `managerOnly` 过滤；
  - `settingsSegments(member)`。
- **改 `shell.tsx`**：
  - 桌面 Sidebar 按 §0 的顺序重排，去掉手风琴；「我钉住的」这一组 F4 才有数据，F1 先留空组件（空就不渲染标题）。
  - 手机 BottomTabs 从 5 个改 4 个；今天、家里 `onPointerDown` 直接导航，吃饭、日程保留气泡但只列 core。
  - 头像入口：今天页 `Page` 的 `actions` 里放头像按钮 → `/me/profile`（手机端唯一的「我的」入口；桌面在侧栏底部）。
- **路由**：URL 一律不变（`/house/assets` 还是 `/house/assets`）。新增 `/home`（F2 做页面，F1 先放占位）和 `/settings`（F7）。旧场景根按 §3 已拍板口径：`/eat` → `/eat/order`、`/schedule` → `/schedule/calendar`，仅原家务 `/house` 与我的 `/me` → `/home`；原生活 `/life` 恢复原有观影落点 `/life/media`。F1 实际曾统一跳 `/home`，F2 一并修正并补 e2e。
- **⌘K 不受影响**：它本来就搜全部分段，这一步之后它是 shelf 的主要入口之一，确认 shelf 分段全部搜得到。
- **测试**：`e2e/nav.spec.ts` 改写——桌面侧栏点「任务」；手机 4 个 tab 都在、按「吃饭」弹气泡且只有 3 项、按「家里」直达 `/home`；⌘K 输「资产」能到 `/house/assets`。冒烟的路径数组不变（页面都还在）。
- **验收**：390 / 1280、亮 / 暗四张截图；手机底栏 4 项等宽、触控区 ≥ 44px。
- **提交**：`feat(web): 导航分层，常驻项收敛到七个`

### F2 · 「家里」启动台 `/home` ［M］

- **页面** `pages/home.tsx`（≤ 400 行，图块拆 `components/home-tile.tsx`）：
  - 顶部：标题「家里」+ 右侧「编辑置顶」（F4 接线，F2 先不渲染）+ 一条点了就开 ⌘K 的搜索条。
  - 「家里在用的」：shelf 分段的图块网格（手机 3 列、桌面 `repeat(auto-fill, minmax(140px, 1fr))`）。图块 = 汉字 glyph 方块 + 名称 + **一行状态**。
  - 底部一行「家庭设置 ›」→ `/settings`（只给 `isManager`；普通成员这一行是「个人」→ `/me/profile`）。
- **状态行的规矩**：只用**已经在缓存里**的数据派生（今天页的留意区会把这些查询拉下来），没有现成数据就不显示这一行。**禁止为了状态行新增请求**——这页的价值是一眼扫完，不是又一个仪表盘。
- F2 阶段「还可以开启」先不做，所有 shelf 都列在「在用的」。
- **预取**：`prefetch.ts` 给 `/home` 配的就是留意区那几条查询。
- **测试**：冒烟数组加 `/home`；一条用例：从家里点「资产」到达 `/house/assets`。另按 §3 修正 F1 旧场景根落点，并用 e2e 覆盖 `/eat`、`/schedule`、`/house`、`/me`、`/life`。
- **提交**：`feat(web): 家里页，低频功能的启动台`

### F3 · 后端：模块状态端点 ［M］

「空域隐身」需要知道一个域有没有数据。客户端挨个打列表接口是 14 个 shelf 域的请求，不可接受；加一个聚合端点。

#### F3 hasData 映射（2026-09-21，先于实现确认）

所有 SQL 分支都按当前家庭过滤；现有表实际列名为 `"householdId"`，新 overrides 表按要求用 `household_id`。
同一域多张表用一个 `SELECT EXISTS(… UNION ALL … LIMIT 1)`，各域与 override 查询并行；activity 是明确的常量例外。
历史 / 已归档业务记录仍算「用过」，不把当前列表筛选当存在性判断。

| key（与 nav shelf 一致） | 表 / hasData 条件 | 家庭前导索引（已核对迁移及隔离库 pg_indexes） |
| --- | --- | --- |
| recipes | `dishes` 存在记录，包含下架菜 | `IDX_dishes_household_active` |
| reminders | `reminders`：未取消，且 `status='scheduled' OR remindAt > now()`；已发送过去 / 已取消不算 | `IDX_reminders_household_status` |
| polls | `polls` 存在记录，含关闭 / 归档 | `IDX_polls_household_active` |
| inventory | `inventory_items` 存在记录，零库存也算 | `IDX_inventory_household` |
| assets | `home_assets` 存在记录，含停用 | `IDX_home_assets_household_status` |
| finance | `finance_accounts` / `finance_transactions` / `finance_budgets` 任一有记录；懒建默认分类不算 | `IDX_finance_accounts_household_active` / `IDX_finance_transactions_household_occurred` / `IDX_finance_budgets_household_month` |
| points | `points_ledger` / `rewards` 任一有记录；懒建零余额 `points_accounts` 不算 | `IDX_points_ledger_household_created` / `IDX_rewards_household_active` |
| guests | `guests` / `visits` 任一有记录，含历史 | `IDX_guests_household_name` / `IDX_visits_household_start` |
| media | `household_media` 片单有记录，或 `integrations`（plex / emby / moviepilot）有非空 baseUrl，或 `household_media_source_configs` 有非空 baseUrl / credentialHint；已保存但停用的连接配置仍算，部署级默认源不算家庭配置 | `IDX_household_media_household_status` / `IDX_integrations_household` / `IDX_household_media_source_configs_household` |
| travel | `travel_plans` 有记录，含完成 / 归档；单独模板不算 | `IDX_travel_plans_household_dates` |
| memories | `family_memories` 有记录，含归档 | `IDX_family_memories_household_date` |
| knowledge | `knowledge_articles` 有记录，含归档 | `IDX_knowledge_articles_household_active` |
| activity | 固定 true，不读活动表 | 不适用 |
| assistant | `agent_settings.enabled=true`；未建设置时与 `/agent/status` 默认一致：`agentDataKey()!=null`。只读，不懒建设置、不探测 runtime | `UQ_agent_settings_household`；默认分支 `households` 主键 |

- **边界说明**：media 只算家庭明确保存的配置，避免默认可用 Bangumi 导致所有空家庭恒真；这点在汇报单列，若以后要把部署默认也计入，需再统一口径。reminders 将取消排除在「未来」之外。积分、财务按上述实体口径，不靠默认空账户 / 分类制造非空。
- **PATCH 权限**：沿用 `manage_integrations`（现有家庭连接 / 配置管理 capability，owner/admin 有、member 无），不新增 capability，不写角色判断。
- **范围**：仅 apps/api、packages/contracts、docs；F4 前不改 nav 或前端接线。前置修复 `776e1d3`、`7a9a519` 已完成，最新 CI `35524045838` 四项全绿；首笔 CI 被后续推送并发取消，不记为通过。

- **端点**（放 `system` 模块）：
  - `GET /system/modules` → `{ modules: [{ key, hasData, override }] }`。`key` 与 `nav.ts` 的分段 key 对齐（assets / finance / guests / travel / knowledge / memories / polls / points / media / inventory / recipes / reminders / activity / assistant）。`hasData` 用 `SELECT EXISTS(… WHERE household_id = $1 LIMIT 1)` 逐域算，一次请求内并行；`override` 是 `'on' | 'off' | null`。
  - `PATCH /system/modules/:key` body `{ override: 'on' | 'off' | null }`，使用现有 `manage_integrations` capability。
- **存储（2026-09-20 已拍板）**：按 F0 结论使用独立表 `household_module_overrides(household_id, key, override, updated_at, updated_by)`，主键 `(household_id, key)`；不向备份专用表塞通用设置。迁移照旧走 TypeORM。
- **契约**：`packages/contracts/src/system.ts` 加两组 schema；`key` 用枚举，`docs/api-inventory.md` 同步（275 → 277）。
- **校验直接用 Zod 管道**（`@ZodBody/@ZodParam`），不要再写 class-validator DTO。
- **黑盒**：`apps/api/scripts/system-modules.mjs`——空家庭业务域 `hasData=false`，activity 恒 true、assistant 与 status.enabled 一致；造一件资产后 assets 变 true；override 写入/清除；普通成员 PATCH 403；`household-isolation.mjs` 补一条跨家庭看不到对方的 override。
- **显示规则**（写进契约文件头注释，客户端照这个算）：`visible = override === 'on' || (override !== 'off' && hasData)`。
- **提交**：`feat(api): 模块状态端点，支撑空域隐身`

#### F3 本轮验收备注

- 契约统一导出 14 个 shelf key，与 nav.ts 逐个比对值及顺序一致；GET 成员可读、PATCH 使用 `manage_integrations`，未知 key / 非法 override 返回 400。
- 每个有查询的域只有一条 EXISTS，各 UNION 分支均带家庭边界；模块黑盒逐表覆盖其他家庭不可见，隔离脚本另验证 override 不串家庭。
- `household_module_overrides` 只允许 on/off，null 删行，保留 updated_at / updated_by；没有改任何现有表结构、没有新增现有表索引。映射涉及表均有家庭前导索引，缺索引清单为空。
- 隔离库 `family_app_test_3be6a1ef415a4b7f8bd2d9c2c0478d4f` 实跑 up → down → up 成功：down 删除新表、再次 up 只恢复该迁移，其他表索引定义不变，随后 schema drift 与全量 API 通过。
- 本地验证：先 build:packages；最终 typecheck / lint 通过（43 条既有 warning），完整 test:api 通过、test:web:next 157 passed / 5 skipped / 0 failed；四张家里页截图重新生成到 `.tmp-shots/f2-*` 并逐张复看，无空白页、横向溢出或撞色。
- 两次本地 API 失败均已改代码再验收：旧迁移演练写死尾迁移；新财务流水夹具试图 DELETE 不可变记录。分别补回退入口、采用随隔离库销毁的独立流水家庭，不跳断言或关闭触发器；见 refactor-plan 教训 21。
- 2026-09-21 已确认：媒体 hasData 不计部署级默认源，仅计家庭明确配置或片单；PATCH 沿用 `manage_integrations`，**语义略偏，仅影响显示，暂不新增 capability**。

### F4 · 空域隐身 + 手动开启 + 每人置顶 ［M］

- **hook**：`useModules()`（`['system','modules']`，`staleTime` 5 分钟）。**对照 F3 映射，每个域的新建、删除和影响 hasData 的配置 / 状态 mutation 成功后调用统一 `invalidateModules()`**——否则加完第一件资产它还躺在「还可以开启」里。用一个 `invalidateModules()` 小函数统一，别散写。
- **家里页**：shelf 按上面的 `visible` 分成「家里在用的」和「还可以开启」。后者是列表行：glyph + 名称 + 一句话说它是干什么的 + 「开启」按钮（管理员 PATCH `override:'on'`；普通成员点开是直接进那一页，不写 override）。管理员在图块的长按 / 右键菜单里有「收起来」（`override:'off'`）。
- **2026-09-21 已拍板 · 收起来**：管理员主动 `override:off` 隐藏家里页和侧栏，并抑制该域 F5 留意卡片；空域的自动隐身不抑制留意卡片。⌘K 与深链始终可达，数据不动。收起无确认框，用可撤销 toast；在「还可以开启」标注「已收起」，重新开启 PATCH null（恢复按数据判断），而非 on。普通空域开启 PATCH on；普通成员只显示「去看看」，直接导航且不写 override。
- **错误 / 加载**：外壳级预取模块状态；2026-09-21 修订：失败时沿用本家庭最后一次成功缓存（包括 off）；仅没有可用缓存时全部 shelf 放行。加载中沿用缓存，首次加载骨架，不能先闪进「还可以开启」。
- **置顶边界**：读写 localStorage 均 try/catch；最多 4 个，其他图钉置灰并提示，触控区 ≥44px。被收起的置顶从显示中消失但不删本机记录，重开自动恢复。nav 的 shelf key 引用 contracts 枚举。
- **置顶**：
  - 存储（2026-09-20 已拍板）：只存本机 `localStorage`（键 `fa.pins.<memberId>`，try/catch，读不到当空），每台设备各自记；本阶段不做服务端同步，不扩成员偏好字段，不开新表。
  - 入口：家里页「编辑置顶」进入编辑态，图块右上角出现钉子切换；上限 4 个。
  - 效果：桌面侧栏「我钉住的」列出来；手机在家里页最上面单独一组「我钉住的 · 只有你看得到」。core 分段不可钉（本来就在）。
- **测试**：空库里家里页「在用的」为空或只有少数、「还可以开启」有内容；造一件资产后资产图块上移；钉住观影后桌面侧栏出现「观影」，刷新仍在。
- **提交**：`feat(web): 空域隐身、手动开启与个人置顶`

#### F4 · 逐域失效核对（2026-09-21）

`invalidateModules(client)` 统一刷新 `['system','modules']`；外壳常驻订阅，家里和侧栏共用缓存。
表中的停用 / 归档仍按 F3 全量实体口径存在，不擅改 hasData 规则；无硬删除入口的域明确标出。

| key | 对照 F3 的新建 / 删除及相关 mutation | 统一接线 / 结论 |
| --- | --- | --- |
| recipes | 菜品新建、更新、删除（软停用） | `menus.ts` 的 create / update / remove dish 均失效；做法 / 熟练度不独立产生 dishes |
| reminders | 新建、改时间、取消 | `reminders.ts` 两个 hook 均失效；资产维护、来访、出行、日历、任务、投票派生更新也失效；小管家单提案 / 提案组确认同样覆盖 |
| polls | 新建 / 修改、关闭 / 重开、归档 DELETE | `invalidatePollSideEffects`；投票改票不改变存在性 |
| inventory | 物品新建 / 修改 / DELETE；批次与采购收货可创建物品 | `invalidateInventory`，包含 `shopping.ts` 收货入口；零数量仍有数据 |
| assets | 登记、更新 / 停用、续费；维护计划 / 资料变更 | `invalidateAssets`；现有客户端无资产硬删除入口；维护相关写入沿同一 helper |
| finance | 账户新建 / 停用、记账 / 冲销、预算 upsert / DELETE | `useFinanceMutation` 统一失效；分类不算数据，但复用同一刷新入口 |
| points | 奖励新建 / 停用、积分调整 / 冲销、兑换审批等 | `invalidatePoints`；任务完成可生成 ledger，同步失效；无 ledger 硬删除入口 |
| guests | 客人新建 / 编辑 / 匿名化、来访新建 / 修改 | `invalidateGuests`；现有客户端无客人 / 来访硬删除入口；邀请 / Wi-Fi 复用刷新 |
| media | 片单新建 / 修改 / DELETE、媒体库加片单、连接器 / 搜索源保存及重置 DELETE | `useWatchlistMutation` 成功回调、`useMediaMutation`、`useSettingsMutation`；不计部署默认源 |
| travel | 行程新建 / 更新 / 归档 / 状态变更 | `useTravelMutation`；归档仍有数据，模板不单独算数据；无行程硬删除入口 |
| memories | 家庭回忆新建 / 更新 / 归档及照片增删 | `useMemoryMutation` / 照片 hook；归档仍有数据，无回忆硬删除入口；智能体私有记忆不属于本表 |
| knowledge | 文章新建 / 更新 / 归档 / 版本恢复 | `useKnowledgeMutation`；归档仍有数据，无文章硬删除入口 |
| activity | 固定 true | 无独立创建 / 删除 mutation，无需额外失效 |
| assistant | 家庭智能体 enabled 设置更新 | `useUpdateAgentSettings`；个人 profile / 配对不影响家庭 status.enabled |

#### F4 · 验收方式

- 空域回归不是依赖演示库恰巧为空：仅在 `family_app_web_test_*` 隔离库复用 F3 鉴权夹具创建新家庭，其他场景用真实 PATCH 构造 on / off，库销毁时清理；不碰演示家庭。
- 资产从真实空域用现有登记表单 POST 创建，经导航返回家里验证自动上移，不刷新页面；覆盖 on / off / null、撤销、普通成员只导航、无缓存时 500 全放行、有缓存时 500 保留 off、初始骨架和后台保留缓存、4 个置顶上限、44px 点击区、本机持久化 / 成员隔离 / 存储失败、长按 / 右键 / Escape。
- F2 原结构 / 导航意图回归固定模块查询为全可见，避免新状态规则改变旧断言；F4 状态测试则用真实 API。截图 `.tmp-shots/f4-{390x844,1280x800}-{light,dark}.png` 使用真实家庭状态，不照搬示意稿数据或样式。
- 前置一致性修复独立提交 `97c30e4`；原问答断言 30/30、全量 API、typecheck / lint 通过，CI `35555080712` 首跑四项全绿。F4.5 仅登记，F5 未执行。

### F4.5 · 时区与日期口径盘点 ［S］

- **起因**：「上午用默认今天完成资产维护被判为未来时间」。仅盘点，不改代码。2026-09-21 已完成，见 [时区与日期口径盘点](timezone-audit.md)；建议待用户确认，不开始修复或 F5。
- **产出一张表**：
  1. 服务端如何得到「现在」和「今天」：容器 TZ 环境变量、compose 配置、是否有家庭级时区配置。
  2. 所有纯日期字段（资产维护 / 保修 / 续费、财务记账、库存保质期、任务截止、出行、来访、提醒等）：前端发法、契约定义、服务端解析 / 比较、数据库 date 或 timestamptz。
  3. 把纯日期当 UTC 零点的校验 / 查询风险，按用户会不会撞上排序。
  4. 备份计划、提醒触发、周报等定时逻辑采用的时区。
  5. 前端「今天」的来源，以及手机 / NAS 时区不一致、出差 / 海外成员的表现。
  6. E2E / API 黑盒对当前时间的依赖：按明确计数口径列用例，区分日界、短超时竞态与仅时间戳夹具。
- **表格与排序**：按用户撞上概率排序，每项列现状 / 问题 / 建议修法 / 预估工作量；统一方案与分批建议区分 F5 前必修和可后置。
- **建议与确认**：给出统一口径建议；用户倾向纯日期全程 `YYYY-MM-DD` 字符串，按家庭时区的「今天」比较，永不转成时间点。等待用户确认后再决定修复范围。
- **依赖**：F5 的 `rules.ts` 必须建立在已确认的日期口径上。

### F4.6 · F5 前家庭日期口径修复 ［a–f，2026-09-21 已拍板］

决策与盘点：[docs/timezone-audit.md](timezone-audit.md#已拍板2026-09-21)。**六个按顺序独立提交，每一步 typecheck + lint + 相关测试通过再进入下一步；旧端仅保证不打坏，不为它修时区问题。**

| 步骤 | 范围、最低验收 | 独立提交 |
| --- | --- | --- |
| a 地基 | 契约 PlainDate 校验真实日期；共享无日期库函数 householdToday/addDays/diffDays/compare/startOfHouseholdDay/monthRange；API 可注入 Clock（先覆盖 b–d）；Web 家庭 today 跨家庭零点更新；单测覆盖午夜、月末闰年、LA 夏令时、UTC+13/−11、异地设备 | `feat(core): 纯日期类型与家庭时区的「今天」` |
| b 资产维护 | performedOn date + 保留 performedAt，家庭日校验、旧端兼容、历史按家庭时区回填；迁移 up→down→up；默认今日 07:00 / 23:30 冻结时钟 e2e、明天拒绝、API 旧请求兼容 | `fix: 资产维护按日期记录，修复上午无法用默认今天完成` |
| c 访客日界 | 日历来访查询、可点菜日期按家庭日界；上海 07:00 当天可见可点菜、前一天不出现 | `fix: 来访按家庭时区归日` |
| d F5 消费口径 | 仅资产临近、库存保质期、财务月界的上海硬编码/设备日改家庭日期，其余列后置 | `refactor: 资产、库存、财务统一家庭日期口径` |
| e 提醒测试 | 消除 700/900ms 机器速度竞态，循环 20 次全绿 | `test: 提醒用例不再依赖机器速度` |
| f 小管家手机回归 | 两条旧 skip 尝试取消，连续 5 次全绿才放开；否则保留并写真实跳过理由 | `test(e2e): 重新评估小管家手机端跳过项` |

完成后全量 `corepack pnpm test:api` 与 `corepack pnpm test:web:next`、push、等 CI、回填进度表；**不开始 F5**。家庭时区修改 / 新家庭浏览器时区默认归 F7；目的地时刻、小管家定时 / 工具、其余显示归后置。遇见新一类时区问题先问，不顺手扩范围。

#### F4.6 本轮验收备注（2026-09-21）

- a 的 `PlainDate` 与纯日期函数放在 `packages/contracts/src/system.ts`（契约类型）及 `packages/shared/src/date.ts`（API / Web 共用实现）：shared 已是两端共同依赖，避免 API / Web 各复制日期算法；不引入日期库。Web 的 `useHouseholdToday()` 在 `apps/web/src/lib/use-household-today.ts`，跨家庭零点自动刷新。
- b 资产维护迁移在隔离库实跑 up → down → up；默认今天在家庭 07:00 / 23:30 成功、明天拒绝，旧端仅 `performedAt` 兼容黑盒通过。c 覆盖上海家庭 07:00 的来访归日、当日日历与点菜。
- d 只改 F5 会消费的资产临近、库存保质期 / 入库默认日、财务月界路径；库存 `presentAllocation()` 的流水展示仍使用旧 `todayInShanghai()`，列为后置，未扩大范围。
- API 全量首次失败根因是旧 agent 迁移演练把“最新迁移”写死；`63dcd9d` 只补三处回退维护日期迁移及迁移检查脚本，随后全量通过。新端全量为 185 passed / 3 skipped；3 条 skipped 是视口限定（桌面侧栏、手机底栏 / 手机导航）或既有的单视口共享状态用例，不是本轮新增跳过。
- e 将提醒 700ms / 900ms 改为 3s / 10s，并延长来源失效轮询窗口；连续 20/20 通过。f 取消两条小管家手机端 skip，workers=1 下连续 5/5 通过。
- Clock 本轮注入覆盖 `assets`（维护完成、订阅续费默认日）、`inventory`（列表 / 汇总 / 入库日期）、`finance`（默认月份 / 撤销记账日），访客 / 日历改用家庭日界函数但仍直接读取业务时间点；其余 API `new Date()` / `Date.now()`（邀请、提醒生产逻辑、访客状态时间点、附件签名 TTL、agent / worker 定时等）留后置。Web 日期输入、资产临近、财务表单 / 预取已改用 `useHouseholdToday()`。

### F5 · 今天页「需要留意」 ［L］

这是整套方案里最要紧的一块：低频域靠它「来找你」。

- **先读**：F0 记下的 `today.tsx` 现状；`pages/assets.tsx` 右栏「临近事项」的派生逻辑（搬出来复用，别再写一份）。
- **形态**：`components/attention/` 目录。
  - `rules.ts`：一组纯函数，每条规则 `(data, member, today) => AttentionItem | null`。`AttentionItem = { key, domain, title, when, to, actionLabel, dueAt }`。**纯函数、不碰 React**，将来要进 `packages/core`，现在就按那个标准写，配 Vitest 单测。
  - `use-attention.ts`：拉各域查询（全部复用现有 hook），喂给规则，按 `dueAt` 升序，返回列表。
  - `attention-card.tsx`：域标签 + 时间 + 一句话标题 + 主动作按钮 +「稍后」。
- **规则清单**（阈值写成 `rules.ts` 顶部的常量）：

  | 域 | 出卡条件 | 主动作 | 谁看得到 |
  | --- | --- | --- | --- |
  | 资产 | 维护 ≤ 7 天或已逾期；订阅续费 ≤ 3 天或已逾期；保修 ≤ 30 天到期 | 看这件资产 | 全家 |
  | 访客 | 来访 ≤ 7 天且当天还没有菜单 | 去点菜（带日期） | 全家 |
  | 访客 | 有待处理的访客点菜请求 | 去处理 | 管理员 |
  | 出行 | 出发 ≤ 7 天且清单有未处理项 | 看清单 | 全家 |
  | 库存 | 有批次 ≤ 3 天过期 | 看库存 | 全家 |
  | 投票 | 进行中且我还没投 | 去投票 | 本人 |
  | 积分 | 有待审批的兑换 | 去审批 | 管理员 |
  | 财务 | 本月某分类预算已超 | 看预算 | 管理员 |
  | 备份 | 最近一次失败，或 worker 离线 | 看备份 | 管理员 |
  | 智能家居 | 预留，E 阶段接 | | |

- **四条硬规矩**：
  1. **一个域最多一张卡**，多条合并（「3 件资产快到期」），点进去再看明细。
  2. **每张卡必须有一个一步到位的动作**，没有动作的信息不配出卡，那是消息页的事。
  3. **卡片是派生状态，不是消息**：事情办了卡就自己没了，没有已读未读，不落库。它和消息页的分工——消息说「发生了什么」，留意说「还有什么没办」。
  4. **最多显示 5 张**，多的折成「还有 N 件」展开。没事的时候这一区整个不渲染，不要放「一切安好」的空态。
- **稍后**：`localStorage` 记 `{ key, until: 明天 0 点 }`，到点自己回来。不做服务端。
- **布局与范围（2026-09-20 已拍板）**：保留现有聚合区块和「全家任务」口径，不按示意稿删减；仅新增「需要留意」、移除今天页「动态」与「未读统计」两块（动态在家里架上，未读数由导航消息角标承接）。手机顺序：**三餐 → 任务（我的在前，全家在后）→ 当日日历与提醒 → 购物 → 需要留意**。桌面 ≥1024px 时「需要留意」放右栏，没有卡片时左栏撑满不留空白。除此之外不重排、不改各区块内部；上面的规则与四条硬规矩继续生效。
- **性能**：这几条查询同时是 `/` 和 `/home` 的预取内容；普通成员不要拉管理员才用得到的那几条。
- **测试**：`rules.ts` 每条规则一组单测（到期前一天 / 当天 / 逾期 / 已办）；e2e 一条：造一件 3 天后要维护的资产 → 今天页出现卡片 → 点主动作到资产详情 → 完成维护 → 回今天页卡片消失。
- **提交**：`feat(web): 今天页「需要留意」，低频功能有事才出现`

### F6 · ⌘K 搜动作 ［M］

- **`lib/actions.ts`**：动作注册表。每条 `{ id, label, keywords[], domain, to }`，`to` 是带深链参数的路径。首批：
  记一笔支出 / 记一笔收入（财务）、加个来访（访客）、新建行程（出行）、登记一件资产、发起投票、记一条回忆、写一篇说明（知识库）、加一条提醒、加日程、加任务、加到购物清单、新建菜品。
- **统一深链约定（2026-09-20 已拍板）**：`?create=1`（需要区分类型的加 `&kind=expense`）表示「到达该页并进入现成的新建状态」：已有新建弹窗就打开；任务、购物等页内输入则滚动到输入框并聚焦，不为此新增弹窗。处理完把参数从 URL 上抹掉，不改现成表单 / 弹窗内部。只修 F6 动作注册表用到的页面；F0 发现的其他“链接带参但页面未消费”情况仅留盘点备注，不在本轮修。
- **`command-palette.tsx`**：结果分三组——动作 / 页面 / 菜品（现有）。动作排最前。手机上从今天页和家里页的搜索条打开，同一个组件，底部上推的 sheet 形态。
- **「交给小管家」**：只有 `agent status.enabled === true` 才在结果末尾出现一行，把当前输入带到 `/me/assistant?draft=<输入>`（对话页读到 `draft` 填进输入框，不自动发送）。没启用就完全不出现，不要放灰掉的入口。
- **没开启的域也能搜到动作**：用一次之后该域 `hasData` 变真，自然出现在家里页——这是「功能随着用而长出来」的闭环，e2e 要覆盖。
- **测试**：⌘K 输「记一」→ 回车 → 到 `/house/finance` 且记账弹窗是开的、URL 上没有残留参数；空库里输「回忆」→ 新建一条 → 家里页出现回忆图块。
- **提交**：`feat(web): ⌘K 支持搜动作，低频功能一句话直达`

### F7 · 「家庭设置」集中页 `/settings` ［S］

- 一页列表，每行：名称 + 一句话 + 当前状态（如「备份：昨天 03:00 成功」「3 位成员」，同样只用缓存里有的）。
  行：成员 → `/house/members`、备份 → `/house/backups`、观影连接 → `/life/media/settings`、外部通知渠道 → 消息页的「外部渠道」分段、小管家设置 → `/me/assistant`（打开设置弹窗的深链）、功能开关 → 家里页的「还可以开启」。
- `managerOnly`。普通成员访问 `/settings` → `Navigate` 到 `/me/profile`。
- **家庭时区（2026-09-21 已拍板）**：F7 增加管理员可修改家庭时区，以及新建家庭时以浏览器时区为默认值；F4.6 只读取已有家庭时区，不抢做设置或新家庭流程。
- **成员可达性（2026-09-20 已拍板，硬约束）**：个人资料、消息接收偏好、小管家成员渠道配对三样属于成员本人，必须对普通成员始终可达，统一从头像 → `/me/profile` 进入，不能随着管理员家庭设置一起隐藏；只补必要入口 / 深链接线，不改原页面内部布局。
- **测试**：用普通成员身份登录，从头像进入个人页，能到达个人资料、消息接收偏好、小管家成员渠道配对三处，同时不能访问管理员 `/settings`。
- **提交**：`feat(web): 家庭设置集中页`

### F8 · 收口 ［S］

- `e2e`：全量 `test:web:next` 绿；手机 / 桌面、亮 / 暗把今天、家里、⌘K、设置四处截图过一遍。
- 文档：
  - `docs/refactor-plan.md` Phase 4 里「信息架构已定（2026-09-17）」那几段后面补一段「2026-09-20 收敛」，指向本文件；教训列表续编号，至少写一条：**功能多不等于导航多——导航的容量按每天用的算，其余靠事件、搜索和上下文到达**。
  - `docs/execution-plan.md` §0 那句「不要再动框架」改成指向本文件；进度表加 F0～F8。
  - `docs/home-assistant-plan.md` §4.3「今天页一张卡」改成「接入 F5 的 attention 规则」，§4.1 的分段归到 shelf。
- **提交**：`docs: 信息架构收敛收口`

---

## 2. 不做的事（别顺手做）

- 不删页面、不合并页面、不改任何页面内部布局；唯一明确例外是 §3 已拍板的 F5 区块增删 / 顺序及 F6 进入现成新建状态的接线，不得扩大到其他重排或新造弹窗。
- 不改视觉语言。设计稿的配色和字体只是为了看结构，实现沿用现有 token 与 `.claude/skills/apple-design`。
- 不按模块开关去裁剪小管家的 28 个工具——有道理，但属于 agent 重建那一轮，先记在这里。
- 不做「使用频率统计后自动调整导航」。置顶是人手动钉的，导航不会自己变，家里人才记得住东西在哪。
- 留意卡片不落库、不推送。要推送的走现有提醒 / 通知。

## 3. 需要用户拍板的（执行 agent 遇到就停下来问）

### 2026-09-20 已拍板

以下决定优先于早期任务文字、示意稿与 F0 / F1 的历史备注；后续执行不得再套用已否决的分支。

1. **收尾提交**：F1 验收通过，允许补交进度表。以后每个任务固定按「一个独立功能提交 → push → CI 全绿 → 可补一个仅回填进度表（实现哈希 + CI 结果）的 docs 提交」执行；这个 docs 提交不违反“一个独立提交”。新教训仍与功能代码同提交。现有未跟踪的 `docs/ia-mockups/` 一并提交，提交标题为 `docs: 信息架构收敛结构示意稿`。
2. **规范路径与旧根路径**：以当前代码中的 `/house/*`、`/life/*` 等为规范路径，保留现有旧重定向；文档路径例子若与代码不同，修正文档，不搬 URL。旧根 `/eat` 应到 `/eat/order`，`/schedule` 应到 `/schedule/calendar`；只有原家务 `/house` 与我的 `/me` 跳 `/home`，原生活 `/life` 保持原有 `/life/media` 落点。F1 实现的全部跳 `/home` 在 F2 提交里修正，并补 e2e。
3. **F5 今天页范围**：保留现有聚合区块与「全家任务」口径，不按示意稿删减。只做三件事：① 按 F5 规则及四条硬规矩新增「需要留意」；② 从今天页移除「动态」与「未读统计」（动态在家里架上，未读数由导航消息角标承接）；③ 手机顺序为三餐 → 任务（我的在前，全家在后）→ 当日日历与提醒 → 购物 → 需要留意，桌面 ≥1024px 时留意放右栏，无卡片时左栏撑满不留空白。除此之外不重排、不改各区块内部。执行 F5 前核对消息角标的接线现状，不能仅凭示意稿认定已有；F2 不补角标或调整今天页。
4. **F6 新建动作**：`?create=1` 表示到达页面并进入现成新建状态；有弹窗就打开，任务 / 购物等页内输入就滚动并聚焦，不新增弹窗，处理后清参。只修 F6 动作注册表用到的带参入口；其余未消费的参数留在盘点备注，不在本轮修。
5. **F7 成员可达性**：`/settings` 仅管理员可用。个人资料、消息接收偏好、小管家成员渠道配对属于成员本人，必须从头像 → 个人页始终可达，不能跟着家庭设置一起隐藏；F7 添加普通成员登录后能到达这三处的 e2e。
6. **F3 存储**：使用独立的 `household_module_overrides` 表，按 F0 盘点结论执行。
7. **置顶存储**：按默认存本机 `localStorage`，不做服务端同步。

### 仍需按边界提问

- 若认为分段应提升 / 下沉，先列异议再问，不自行改层；本轮没有改变 core 7 / shelf 14 / settings 3。
- 留意规则的 7 / 3 / 30 天仍为初值，C2 试用期间按家庭反馈调整；本轮不改阈值。
- 上述拍板仅规定后续任务边界，不授权在 F2 提前实现 F3–F7。

---

## 盘点表（F0 填）

### 盘点口径（2026-09-20）

- 基线：`refactor/phase-0-safety-net`，代码提交 `1828cdc`；仅盘点，不修改路由、权限、页面或分层实现。
- 现有导航共 **24 项**：`SCENES` 内 21 个分段 + 独立「今天」+ `PINNED` 的小管家、个人设置。下表逐项列出，按 §0 标为 **core 7 / shelf 14 / settings 3**；层是计划归属，不表示代码已有 `tier`。观影连接器、外部通知渠道、助理设置另列为内嵌设置入口，不冒充独立导航分段。智能家居尚未接入，不计入现有项。
- 已读 F0 指定文件，并追到 `bottom-tabs.tsx`（含 `SceneMenu`）、`nav-prefetch.ts`、`account-menu.tsx`、`legacy-bridge.tsx`，以及相关页面、拆分视图、查询 hook、后端目标链接与实体。当前工具未提供 fast-context 搜索，采用本地源码检索交叉核对。
- 共用入口：21 个场景分段均可从桌面手风琴 / 手机气泡进入（`managerOnly` 过滤）；⌘K 搜索 `SCENES` 的页面和菜品，**未收录 `PINNED` 两项，且使用 `visibleSegments(scene, true)`，未按成员身份过滤管理员项**。下表侧重这些全局入口以外的上下文入口。
- 「动态链接」指家庭动态及今天页「家里最近」按记录的 `targetPath` 跳转；「消息链接」指消息记录的目标链接；「助理结果」指对话结果/提案中的跳转。它们不是每个域必有的固定按钮，只在返回相应目标时出现。`routes.ts` 能映射路径不等于目标页能消费查询参数。
- 空态均按**查询成功后**判断；当前筛选、日期区间、权限范围内无结果，不等于全家庭从未使用该域。不能直接把页面的 `data ?? []` 或筛选空态当 F3 的 `hasData`，也不能把加载失败算空库。
- 结构稿已按 README 读完四份 HTML；只记录区块和顺序，不采纳样式或示例数据。示意稿资产卡的「加进购物清单」与 F5 的「看这件资产」不同，以 F5 为准；搜索稿省略了「菜品」，F6 明确保留。

| 分段 | 路径（当前规范路径） | 层 | 现有上下文入口 | `?create=1` / 其他深链 | 可复用空态与备注 |
| --- | --- | --- | --- | --- | --- |
| 今天 `today` | `/` | core | 外壳品牌按钮、手机中央「今天」、⌘K；桥接错误页「回今天」 | 不适用；无新建参数 | `today.tsx` 的 `todays.length`、`events.length` 及侧栏各数组空态；不是单一域的空库判断。现有聚合详见下文与 F0 进度备注。 |
| 点菜 `order` | `/eat/order` | core | 厨房「回去点菜」；菜谱可加菜到共享购物车，但该动作本身不导航到点菜 | 否；未读 `date` / `mealType`；日期、餐次来自 `CartProvider`，不是 URL | `order.tsx`：`visible.length === 0` 为菜品筛选空态，`cart.entries.length === 0` 为购物车空态；基础菜品可用 `dishes.data`，菜单是否有菜需另判。F5 的「去点菜（带日期）」现不能直接复用。 |
| 厨房 `kitchen` | `/eat/kitchen` | core | 点菜「去厨房」、今天三餐卡及标题入口、购物空态、日历菜单条目、提醒来源；菜单动态/消息和助理结果 | 否；入口虽带 `?date=…&mealType=…`，页面仅 `useState(today)`，未消费日期/餐次参数 | `kitchen.tsx`：所选日无菜品（`!anyItems`，不等于无菜单）、`menu.items.length` / 活跃菜品数；只表示所选日/餐次。生成购物清单只写数据并 toast，不是到购物页的链接。 |
| 菜谱 `recipes` | `/eat/recipes` | shelf | ⌘K 的菜品结果会导航到 `?dish=<id>`；未发现其他页面的固定跨页菜谱入口 | 否；`?dish=` 实际未读取，不能称为详情定位已支持 | `recipes.tsx`：`visible.length === 0` 含关键词/分类筛选；基础 `recipes.data` 可判当前菜谱列表。已有 `dishEdit='new'` 的新菜品弹窗，尚未接 URL。 |
| 日历 `calendar` | `/schedule/calendar` | core | 今天「今天还有」标题入口；提醒来源；助理日程结果、日历目标消息 | 否；支持 `?view=month/week/agenda`；未读 `date` / `eventId` | `calendar.tsx`：`rows` 为当前视图区间，`dayRows.length` 为单天空态；不可代表全库没有日程。已有事件新建弹窗。 |
| 任务 `tasks` | `/schedule/tasks` | core | 今天统计及「全部任务」、日历任务条目、提醒来源；任务动态/消息、助理结果 | 否；未读 `taskId` / `date` | `tasks.tsx`：`byDate.size === 0` 为当前任务区间空态；新建任务是页内输入，不是弹窗，F6 不能直接套“打开现成弹窗”。 |
| 提醒 `reminders` | `/schedule/reminders` | shelf | 今天统计/右栏、日历条目铃铛、投票卡、资产详情维护计划、行程详情 | 不支持裸 `create`；已支持 `sourceModule` + `sourceId` + 可选 `occurrenceDate` 打开并预选来源；关闭时清参 | `useReminders('all')` 的全列表可复用；页面 `rows` 另有状态筛选、`pending` 为待提醒数。`ReminderForm` 是已有新建弹窗。提醒“查看来源”仅菜单/任务/日历走新版，其余仍 `legacyUrl` 打开旧版，不可误记为全域新版入口。 |
| 投票 `polls` | `/schedule/polls` | shelf | 观影概览「观影投票」；投票动态/消息（含提醒消息）；提醒页来源仍去旧版 | **是**，`?create=1` 开表单；但关闭表单才清 URL，非打开即清。`?pollId=` 高亮目标，已结束投票切全部 | `usePolls()` 拉 `status=all`，`rows.length` 可判接口全列表；`visible.length` / `openCount` 只代表状态筛选或进行中。 |
| 消息 `notifications` | `/schedule/notifications` | core；外部渠道管理另列 settings | 今天未读统计、个人页「去消息页设置渠道」；全局导航 / ⌘K | 不适用通用新建；`view` / `scope` / `module` 均为本地 state，未读取 `?view=settings` / `?view=deliveries`；渠道新建弹窗未接 URL | `notifications.tsx`：`rows.length === 0` 受未读/全部及业务域筛选影响，只代表当前成员消息；`channelRows.length`、投递列表另有空态，不能互相替代。 |
| 库存 `inventory` | `/house/inventory` | shelf | 全局导航/⌘K；未发现其他页固定跳入链接。购物入库、资产维护耗材会改库存，但不是导航入口 | 否；无记录定位参数 | `inventory-view.tsx`：`list.length` 为库存物品空态；另有批次 `activeBatches`、`expiring`、`expired`，不能只凭物品列表否定批次有数据。当前批次 hook 用 7 天临期窗口，F5 的 3 天规则不能直接照搬该状态。 |
| 购物 `shopping` | `/house/shopping` | core | 今天统计和购物侧栏；助理购物结果。厨房生成、库存补货、资产维护加耗材是写入清单，不是固定跳转 | 否；未读 `date`；日期是页面本地 state | `shopping-view.tsx`：`items.length` 是所选日期清单空态；`!checked` 可派生待买数。手动添加是常驻页内表单，非新建弹窗；F6 已获准滚动并聚焦现成输入，处理后清参（见 §3）。 |
| 资产 `assets` | `/house/assets`；详情 `/house/assets/:id` | shelf | 日历维护条目及今天对应条目；资产动态/消息、助理结果；详情有返回列表；提醒来源仍去旧版 | 不支持 `create`；支持详情路径 `/:id`；旧目标的 `assetId` / `planId` 查询参数在列表页未读取 | `useAssets('all')` 的 `rows.length` 可复用；`visible` 为状态/分类筛选。`nextPlan`、`dueLabel` 和临近事项派生可参考，但当前阈值是维护 30 天、续费 14 天，且不含保修，详见备注。 |
| 财务 `finance` | `/house/finance` | shelf（保留 `managerOnly`） | 财务动态及助理结果 | 否；不读 `kind`，现有 `TransactionForm` 由 `recording` 控制 | `finance.tsx` 的 `rows` 是账户，不是流水；`finance-ledger.tsx` 的 `rows.length` 是当月筛选流水，预算/分类又独立。没有现成单一的域级空态；已有默认账户/分类时尤其不能据此认定有使用数据。 |
| 积分 `points` | `/house/points` | shelf | 积分动态、奖励兑换消息 | 不支持 `create`；`?redemptionId=` 切兑换记录并标记目标 | `rewardRows`、`redemptionRows`、积分流水各有空态；`pendingCount` 可供留意规则。账户/零余额不是“用过积分”的充分证据，不能只数 `points_accounts`。 |
| 访客 `guests` | `/house/guests`；公开邀请 `/guest/:token` | shelf | 日历来访及今天对应条目；访客动态/消息；公开邀请链接是给访客的独立页面，不是家庭导航项 | 否；后端会给 `?visitId=`，但 `guests.tsx` 未消费；公开 token 路由已支持 | `visitRows` / `guestRows` / `wifiRows` 各有空态；`upcoming`、`pendingMeals` 已派生。安排来访的 `VisitForm` 已有；不能只看未来来访数判断整个域无数据。 |
| 成员 `members` | `/house/members` | settings（`managerOnly`） | 个人页「管理成员」；成员动态目标链接 | 否；邀请/编辑由本地弹窗 state 控制 | `rows`、`visible`、`activeCount`、`pendingInvites` 可复用；正常已登录家庭至少有自己，不按空域隐藏。 |
| 备份 `backups` | `/house/backups` | settings（`managerOnly`） | 备份操作动态/失败和容量消息 | 否；备份/恢复演练通过现有确认弹窗，不应套通用新建动作 | `useBackupDashboard(canManage)` 的 `runs.length === 0` 为尚无运行记录；不等于没有策略。状态、worker、容量已有 dashboard 数据可供 F5；本轮未触发备份或恢复。 |
| 观影 `media` | `/life/media`；子页 `/library`、`/watchlist`、`/history`（均在此前缀下） | shelf；连接设置子页单列 settings | 投票卡 → 片单 `?mediaId=`；日历/今天日历条目、观影动态/消息、助理结果；概览与片库/片单/历史互链 | 不支持 `create`；片单支持 `?mediaId=` 打开编辑框并清参、`?filter=`；概览不读 `mediaId`，后端 `/media?mediaId=` 只到概览 | 概览 `rows` / `scheduled.length`、片库与历史列表各自有空态；“未排片”不等于没有片单、片库或播放历史，F3 需明确聚合口径。 |
| 出行 `travel` | `/life/travel`；详情 `/life/travel/:id` | shelf | 日历行程及今天对应条目；行程动态、提醒消息、助理结果；详情返回列表；提醒来源仍去旧版 | 不支持 `create`；`?planId=` 跳详情；支持 `/:id`；`?view=templates` 未读取 | `travel.tsx` 当前状态列表 `rows.length`，打包模板独立查询/空态；可复用行程清单状态但不能把“计划中为空”当整域为空。 |
| 回忆 `memories` | `/life/memories` | shelf | 回忆动态、助理结果 | 不支持 `create`；`?memoryId=` 在当前查询结果命中时开详情并清参，未命中（例如已归档）不会自动切筛选 | `memories.tsx` 的 `rows.length` 受状态/分类/关键词限制；已有 `MemoryEditor` 新建弹窗。详情的来源链接可回到关联域。 |
| 知识库 `knowledge` | `/life/knowledge` | shelf | 知识库动态、助理结果 `?articleId=` | 不支持 `create`；`?articleId=` 在当前查询结果命中时开详情并清参；未自动切到归档记录 | `knowledge.tsx` 的 `rows.length` 受状态/分类/关键词限制；已有 `KnowledgeEditor` 新建弹窗。 |
| 家庭动态 `activity` | `/life/activity` | shelf | 今天「家里最近」的「全部动态」 | 不适用；无新建弹窗、不读筛选参数 | `useActivities(scope)` + `groupByDay` 的 `groups.length`，受 scope 和 `limit=100` 约束；可用成功的 `scope=all` 列表判当前是否有动态，不要新增空态端点请求。 |
| 问问小管家 `assistant` | `/me/assistant`；个人记忆 `/me/assistant/memories` | shelf；家庭助理设置弹窗单列 settings | 桌面搜索下方固定入口、手机顶栏按钮、个人页「去问问小管家」、记忆页返回对话；**当前不在 ⌘K** | 不支持 `create`；`draft` 和“打开设置”参数均未实现；记忆有独立路径 | `assistant.tsx` 的会话 `rows.length`、当前消息 `messages.length` 和 `useAgentStatus()` 状态可复用，但“无对话”和“未启用”不是同一回事。 |
| 个人设置 `profile` | `/me/profile` | settings（本人可访问，非 `managerOnly`） | 桌面固定入口、手机头像菜单；助理个人档案结果；`/me` 重定向 | 不适用；密码/退出为本地确认弹窗，无 URL 开关 | 来自登录 session 和 `useAgentProfile()`，没有整页“家庭空库”含义。必须保留普通成员入口，不能随管理员家庭设置一起隐藏。 |

### 内嵌设置入口（不是新增分段）

| 设置内容 | 当前路径 / 宿主 | 现有入口与权限 | 深链、空态与后续边界 |
| --- | --- | --- | --- |
| 观影连接器 / 搜索数据源 / 用户映射 | `/life/media/settings`（旧 `/eat/media/settings` 已重定向） | 观影概览管理入口；媒体设置动态/消息；管理员才能操作 | 支持 `?section=services/sources/users`；各设置面板按连接配置/映射显示状态，没有统一模块空态。F7 不应改回旧规范路径。 |
| 外部通知渠道 | `/schedule/notifications` 的「外部渠道」 | 消息页分段、个人页「去消息页设置渠道」；新增/管理渠道需管理员，但个人接收范围对普通成员仍有意义 | `view` 只是本地 state；旧目标 `?view=settings` / `?view=deliveries` 不会切分段，`channelRows.length` 只表示渠道列表。F7 的直达目前缺 URL 接线，不得将成员接收偏好一并移到管理员独占入口。 |
| 助理设置 | `/me/assistant` 内 `AssistantSettings` 弹窗 | 对话页「设置」按钮所有成员可见；运行方式、配对码管理仅管理员可见，成员仍可查看可见渠道，并按 `canRevoke` 解绑；个人记忆偏好在个人页 | `settingsOpen` 为本地 state，无打开设置深链；管理员读取 `/agent/settings`，渠道使用独立查询；未配置/不可用状态不能当作整个 assistant 域无数据。 |

### F0 核实结论与待确认项

**A. 今天页已聚合的内容（不要重做）**

- `pages/today.tsx` + `components/today-hero.tsx` / `today-meals.tsx` / `today-aside.tsx`：日期与问候；4 项统计（今日待办、待买、当天待提醒、未读消息）；早中晚三餐的菜品/主厨/完成进度；今日全家任务（不是只限“我的”，按 `canUpdate` 控制勾选），并列出接下来两天 pending 任务最多 4 项；当天日历非 task/menu 条目；当天 scheduled 提醒最多 5 条、当天未购清单最多 6 项、近期家庭动态最多 8 条。
- 现用查询：`useMenusOfDate(today)`、`useTaskRange(today, today+2)`、`useReminders('scheduled')`、`useShoppingList(today)`、`useCalendarEntries(today, today)`、`useActivities('all')`、`useNotifications()`；任务勾选复用 `useUpdateOccurrence()`。提醒实际上按 `remindAt.slice(0,10) === today` 筛选，未再比较当前时刻，勿把注释“还没到点”当成额外实现。
- `/` 的预取已覆盖菜单、任务、当天日历、动态 **4 组**，尚未覆盖今天页另用的提醒/购物/消息；`prefetch.ts` 只做完整路径精确匹配，`/home` 和 `/settings` 均不存在。当前没有 attention 规则/卡片机制。

**B. 家庭级设置存储**

- `apps/api/src/system/system.module.ts` 仅注册 `BackupPolicy`、`BackupRun`、`Member`、`Notification`；现有家庭级配置是备份专用 `backup_policies`（`householdId` 唯一），不是通用设置表，另有执行记录 `backup_runs`。没有通用 `household_settings`、`module_overrides` 或现成模块状态端点。
- `entities/index.ts` 的 `households` 仅名称、slug、timezone 和时间戳；`agent_settings`、`household_media_source_configs` 等是其他域的专用配置，不是 system 的通用家庭设置。F3 应按“无通用表”的既定分支考虑独立 `household_module_overrides`，不把导航开关塞进备份策略或助理配置。本轮不建表、不改迁移。

**C. 成员偏好存储**

- 「经常掌勺」：`profile.tsx` → `lib/queries/profile.ts::useUpdateCookingPreference` → `PATCH /members/me/preferences`（body `{ prefersCooking }`）→ `auth/auth.module.ts::updatePreferences` → `members.prefersCooking`。后端以当前 `memberId + accountId + householdId` 查本人。
- 「启用记忆」：`useAgentProfile` / `useUpdateAgentProfile` → `GET/PATCH /agent/profile`（PATCH 带 `{ memoryEnabled, expectedVersion }`）→ `agent/agent.service.ts::updateProfile` → `agent_member_profiles.memoryEnabled`，唯一约束 `(householdId, memberId)`、`version` 乐观锁。二者都是服务端偏好，但并无通用任意偏好 JSON / 现成置顶字段。
- F4 置顶仍按 §3 **默认本机**记录，不因“已有服务端偏好”就擅自扩字段。若要跨设备同步，需要你确认后才评估成员端点/契约/迁移；不借助智能体档案存通用导航偏好，不为本轮增加新表。2026-09-20 已明确只存本机，F4 中原“便宜就存服务端”的分支已移除。

**D. 仅记录，不自行调整的差异 / 疑问**

1. **规范路径与计划例子有漂移**：当前购物/库存是 `/house/*`，观影/出行/回忆/知识库/动态是 `/life/*`；旧 `/eat/shopping`、`/eat/inventory`、`/eat/media/*`、`/house/travel`、`/house/knowledge`、`/house/memories`、`/me/activity` 已由 `App.tsx` 保留重定向。F1 应理解“URL 一律不变”为保留当前规范路径和旧兼容入口，而不是把代码改回计划里的旧例子；此口径已于 2026-09-20 拍板，根路径修正见 §3 / F2。当前 `/house` 落库存、`/life` 落观影、`/me` 落个人，不能沿用旧五场景假设漏掉 `/life`。
2. **今日布局有新增内容**：当前三餐、全家今日待办、当天其他安排与右栏提醒/购物/动态，已多于示意稿的“今晚 + 我的任务”。2026-09-20 已拍板：按 §3 保留全家口径与既有区块，仅移除动态 / 未读统计并新增留意区，按指定顺序排列，不照稿删成“今晚 + 我的任务”。
3. **分层异议**：24 个顶层项均先按 §0 归层，本轮不提出擅自提升/下沉；但 settings 不全是家庭管理员配置：个人设置、消息页个人接收偏好及小管家设置中的成员渠道入口必须保留普通成员可达性。这属于入口/权限边界，不把消息整页归 settings，也不把小管家对话整页归 settings。
4. **F6 的最小改动边界**：任务、购物已有的是页内新建输入，不是弹窗；2026-09-20 已允许用 `?create=1` 聚焦/滚到现成输入并清参，不新造弹窗（见 §3）。投票需补“打开即清参”；F7 的渠道分段/助理设置、F5 的点菜日期也缺深链接线，盘点表已区分，不能只做链接就宣称一步直达。
5. **F5 派生复用边界**：资产当前只筛 active 资产，启用维护计划 ≤30 天（含逾期）、订阅续费 ≤14 天（含逾期），排序后到详情；已有 `daysUntil`、`nextPlan`、`dueLabel`，未纳入保修。F5 的 7/3/30 天是另一组规则，不能原样复制当前 `upcoming`，也不在 F0 调阈值。
6. **F3 空域口径**：积分账户、默认财务账户/分类、懒建助理配置，以及已归档记录/媒体片库/出行模板等，会影响 `hasData`。这里仅标出不能拿 UI 筛选空态代替 EXISTS 的原因；F3 应先明确各域存在性查询的业务表与状态范围。计划文字称“13 个请求”，实际 key 清单是 **14 个 shelf 域**，实现按枚举逐项核对，不漏 assistant/activity。
7. **范围与验证**：本轮仅填写本文件。`corepack pnpm typecheck && corepack pnpm lint` 通过；API lint 为 0 error / 43 条既有 warning，mobile/web lint 通过。没有改 API、没有运行写数据的业务验收或页面视觉验收，没有开始 F1。结构稿当前为用户提供的未跟踪文件，未修改、未代为加入本提交。

## F1 实现备注（2026-09-20）

- **模型与入口**：24 项均补齐 `tier` / 单字 `glyph`，按 F0 的 core 7 / shelf 14 / settings 3 落地，无提升或下沉。桌面七项平铺，底部家里 / 管理员家庭设置 / 本人头像；「我钉住的」保留空组件，不渲染空标题。手机四项等宽，今天 / 家里按下直达，吃饭 / 日程各三项 core；键盘 Enter / Space 也可操作。
- **路径口径**：按 F1 的“URL 一律不变”保留当前规范叶子 URL 和旧兼容重定向。购物仍是 `/house/shopping`，但归手机「吃饭」，菜单归属不再由 URL 前缀决定；F1 实现曾把五个旧场景根 `/eat`、`/schedule`、`/house`、`/life`、`/me` 统一去 `/home`；2026-09-20 用户已要求在 F2 按 §3 修正。`/home` 与 `/settings` 只有占位及搜索出口，不提前做 F2 / F7；普通成员不能进入家庭设置占位页。
- **搜索与成员权限**：纠正计划中“⌘K 本来就搜全部分段”的现状假设：补入小管家、个人设置，改为使用按成员过滤的分层列表；管理员全部 14 个 shelf 均有导航测试，普通成员保留本人设置 / 小管家，隐藏财务 / 成员 / 备份。菜品搜索保留，没有增加 F6 的动作或分组。
- **头像与主题**：手机固定的个人导航入口移至今天页 `Page.actions`，桌面留在侧栏底部；全局搜索仍可搜到个人设置。主题按钮保留在手机顶栏 / 桌面底部，退出仍走现有个人页；同步调整主题冒烟交互，既有冒烟路径数组不变。今天既有三餐、任务、日历与右栏内容未改，截图中的空餐卡 / 无安排面板保留既有布局，F5 布局已于 2026-09-20 拍板，见 §3，F2 不提前实现。
- **验收范围**：`corepack pnpm typecheck && corepack pnpm lint` 通过（API 43 条既有 warning，0 error）；`corepack pnpm test:web:next` 全量 139 passed / 5 skipped（3 个视口限定用例、2 个既有手机端助理用例），无失败。新增四张亮 / 暗、390×844 / 1280×800 的截图测试，覆盖横向溢出、零 `pageerror`、导航触控区 ≥44px、手机头像同行；人工复看未见白屏、导航溢出或亮暗撞色。截图保存在 `.tmp-shots/f1-{390x844,1280x800}-{light,dark}.png`，不提交。无 API、`packages/*` 或 workflow 改动；未开始 F2，置顶存储 / 空域规则 / 留意阈值均未实现。
- **经验**：本轮新增教训 17（导航层级不要绑 URL，搜索补齐独立入口与权限），与代码同提交；本机需用原生 arm64 运行测试以匹配已安装的 Rollup 原生包，未为此改依赖或锁文件。

### F2 实施备注（2026-09-20）

- **范围**：`/home` 用现有 `Page/Panel/SoftLink` 与 token 实现；搜索条打开同一个 ⌘K，手机三列 / 桌面自适应图块，管理员 14 项、普通成员 13 项（不含财务）。页底分别到家庭设置 / 个人；不提前做编辑置顶、空域隐身或设置内容。
- **缓存与预取**：2026-09-21 收尾修正：移除「已载入」计数及订阅，没有面向家人的有意义状态就不显示；F5 再用留意数据派生。`/home` 导航意图预取资产、来访（已含点菜请求）、进行中出行、在库批次、投票，管理员额外预取兑换、当月财务概览、备份看板；查询键和端点复用现有 hook。F5 再接消费者、按来访日期查菜单和今天页预取，本轮不实现留意规则 / 卡片。
- **兼容修正**：按 §3 恢复 `/eat` → `/eat/order`、`/schedule` → `/schedule/calendar`、`/life` → `/life/media`；`/house` / `/me` → `/home`，五个根路径均保留查询参数；现有叶子与旧路径重定向不变。
- **验收清单**：新增 `/home` 冒烟；双视口覆盖资产直达、搜索、成功缓存与异步预取均不显示载入计数、冷启动无请求、按角色过滤预取 / 图块 / 页底入口、五个根落点和旧深链。四张图输出 `.tmp-shots/f2-{390x844,1280x800}-{light,dark}.png`；最终结果回填进度表。无 packages / API 改动。教训 18 与功能代码同提交。
- **边界**：没有需要新增拍板的产品决策；后续 F3–F7 均未开始。

## 进度表

| 任务 | 状态 | 提交 | 备注 |
| --- | --- | --- | --- |
| F0 盘点 | ☑ | `c2d9ea9` · `docs: 信息架构收敛盘点` | 24 项逐行完成（core 7 / shelf 14 / settings 3），内嵌设置另记。① 今天已聚合三餐、今日及后两天任务、当日日历、提醒、购物、动态和未读统计；② system 只有备份专用 `backup_policies` / `backup_runs`，无通用家庭设置，F3 按独立 overrides 表分支；③ 掌勺经 `PATCH /members/me/preferences` 存 `members.prefersCooking`，记忆经 `GET/PATCH /agent/profile` 存 `agent_member_profiles.memoryEnabled`（版本锁），置顶仍默认本机，服务端同步待用户确认。无顶层归层调整；路径漂移、今日既有区块、成员设置可达性及页内新建的深链边界详见上方 D。typecheck / lint 通过（API 43 条既有 warning）；仅文档，不开始 F1。 |
| F1 导航分层 | ☑ | `f5e096f` · `feat(web): 导航分层，常驻项收敛到七个` | 导航分层、桌面七项 / 手机四项、今天头像及路由占位完成；typecheck / lint 通过，全量新端浏览器验收 139 passed / 5 skipped，四图已人工复看，已 push，CI `35504482867` 四项全绿；详见上方 F1 备注，未开始 F2。 |
| F2 家里页 | ☑ | `bd4b7d7` · `feat(web): 家里页，低频功能的启动台` | 启动台、缓存状态、角色过滤预取及旧根落点修正完成；typecheck / lint 通过（API 43 条既有 warning），全量新端 157 passed / 5 skipped / 0 failed，四图已复看；已 push，CI `35520971609` 第 2 次四项全绿（首跑旧端任务备注定位器匹配到日历缓存页与任务页两处，未改代码重跑通过）；详见 F2 备注，未开始 F3。 |
| F3 模块状态端点 | ☑ | `9af1821` · `feat(api): 模块状态端点，支撑空域隐身` | 14 key 及两个端点完成；typecheck / lint（43 条既有 warning）、全量 API、新端 157 passed / 5 skipped 通过，277/277 契约；隔离库 up → down → up 与 schema drift 通过，仅 API / contracts / docs；已 push，CI `35525677173` 首跑四项全绿；回填提交 `a62595c` 的 CI `35550675759` 首跑旧 `agent.mjs:156` 问答消息断言失败，未改代码重跑 API 后全绿。2026-09-21 已定位并独立修复：detail 原为 messages/runs 并行读，回答与 completed 原不在同一事务；`97c30e4` 改为事务写入、先 runs 后 messages，原用例循环 30/30 及全量 API 通过，CI `35555080712` 首跑四项全绿。媒体不计部署默认源；manage_integrations 语义略偏，仅影响显示，暂不新增 capability。 |
| F4 隐身 / 开启 / 置顶 | ☑ | `82827a5` · `feat(web): 空域隐身、手动开启与个人置顶` | 外壳级模块缓存、无缓存失败放行（有缓存保留 off）、开启 / 收起 / 撤销及每人本机 4 项置顶完成；逐域失效核对见 F4 表。typecheck / lint 通过（43 条既有 warning），全量新端 179 passed / 5 skipped / 0 failed；四张亮暗截图已逐张复看，无白屏、溢出或撞色。仅 apps/web / docs；已 push，CI `35556935338` 首跑四项全绿，无未改代码重跑。后续缓存边界修复 `b212e47`（CI `35560665929` 首跑全绿）；新端 CI `643a363`（CI `35561356642` 首跑五项全绿，新 job 8分37秒）。F4.5 见下行，未开始 F5。 |
| F4.5 时区与日期口径盘点 | ☑ | 本提交 · `docs: 时区与日期口径盘点` | [盘点报告](timezone-audit.md)：26 个 date 列及时间点边界、容器实测、22 条日期相关 E2E + 2 条时间戳 mock、29 组 API 场景；确认维护中午转换与来访 UTC 日界风险，统一家庭时区和分批修法待拍板；仅文档，未修时区，未开始 F5。 |
| F4.6 家庭日期口径（a–f） | ☑ | `4e2c57b` / `fbf899a` / `bf9ec21` / `c000598` / `328ccbe` / `96e3403`（另：`63dcd9d` 验收脚本兼容修复） | 六步按序完成；a–d 各自通过 typecheck / lint / 相关测试，e 提醒 20/20、f 手机小管家 5/5；全量 `test:api`、`test:web:next`（185 passed / 3 skipped）通过；CI `35613750741` 五项全绿，已 push。Clock 覆盖维护 / 资产续费 / 库存 / 财务及 b–d 日期路径；库存流水展示仍保留旧上海日期，其他后置项见 F4.6 备注。|
| F5 需要留意 | ☐ | | |
| F6 ⌘K 动作 | ☐ | | |
| F7 家庭设置 | ☐ | | |
| F8 收口 | ☐ | | |

状态：☐ 未开始 · ◐ 进行中 · ☑ 完成 · ✗ 放弃（写原因）
