# 小管家 · 新客户端收尾执行计划（交接给执行 agent）

> 这份文档是**自包含的交接书**：读完它就能在没有任何对话上下文的情况下开工。
> 规划依据是 `docs/refactor-plan.md` 5.5 节（2026-09-17 复盘）。本文件只写「做什么、怎么做、怎么算做完」，
> 不重复讲为什么；想知道为什么去读 5.5 节。
>
> **执行顺序不可调换：A → B → C → D。** A 是安全网，B 的每一页都依赖它；C 依赖 B 全部完成；D 依赖 C。
> 每个任务做完要在文末「进度表」打勾并写一句备注，再开始下一个。

---

## 0. 三十秒看懂现状

- 仓库 `github.com/cnxin/family-app`（私有），本机 `~/AI/family-app`，工作分支 **`refactor/phase-0-safety-net`**（领先 main 51 个提交，不要合到 main，用户自己决定什么时候合）。
- pnpm monorepo：`apps/api`（NestJS 10 + TypeORM + PG16）、`apps/mobile`（**旧客户端**，Expo 57 + RN Web，本机跑在 :8088）、**`apps/web`（新客户端，Vite 7 + React 19 + TanStack Query 5 + React Router 7.9 + Tailwind 4，dev :5180，`/api` 代理到 :8088）**、`packages/contracts`（275/275 端点 Zod 契约）、`packages/shared`。
- 新客户端已经搬好 **10 页 / 24 分段**：今天、点菜、厨房、菜谱、购物、库存、日历、任务、提醒、消息。**剩 14 个分段**还挂在「在旧版打开」的桥接页上。
- 框架已定型，**不要再动框架**：五场景信息架构（今天/吃饭/日程/家务/我的）、桌面左侧栏 + 手机底部 5 个 tab 气泡菜单、`Page/Panel` 控制台骨架、`SoftLink` 视图过渡、按下预取、⌘K。用户对这些已经点头，改它们要先问用户。
- CI 四个 job 全绿（静态检查 / API 黑盒 / Playwright 旧客户端 / 镜像构建）。**但 CI 一行都不保护 `apps/web`**——这就是为什么 A 必须先做。

---

## 1. 硬规矩（违反任何一条都算没做完）

### 1.1 命令与环境
- pnpm 一律 `corepack pnpm`，**禁止 `npx pnpm`**（版本对不上会让 `expo lint` 假红）。
- 新客户端 dev：`corepack pnpm --filter web dev`（:5180，需要本机 :8088 那套 Caddy + API + 旧客户端在跑）。演示账号 **爸爸 / family1234**（管理员）、**妈妈 / family1234**（普通成员）。登录接口有限流，脚本里反复登录会 429，等 45 秒。
- 改了 `packages/*` 先 `corepack pnpm build:packages` 再测。
- 提交前全量：`corepack pnpm typecheck && corepack pnpm lint`；动了 API 的域再跑 `corepack pnpm --filter api test:api`（全量，不是 `--only`）。
- `.github/workflows/*` 如果工具拒绝写入，**把 diff 原样给用户自己贴，不要绕过保护**（包括让子 agent 去写）。
- 删文件用真实 shell（`rm`），沙盒 shell 可能没有删除权限；不要用「移到 `_to_delete/`」糊弄。

### 1.2 提交
- 每个任务**一个独立提交**（Zod 迁移子任务再单独一个），中文提交信息，格式 `feat(web): 搬运投票` / `test(web): …` / `refactor(api): …` / `docs: …` / `chore: …`。
- 提交信息末尾两行固定：
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013z5CFYDXaXcfp4veeibB7L
  ```
  （执行 agent 的会话不同的话换成自己那一套，用户 CLAUDE.md 有规定就以那个为准。）
- 每个任务做完 `git push`，看 CI；红了先修红再开下一个任务。
- `.tmp-shots/` 已在 `.gitignore`，截图放那里，别再提交截图。

### 1.3 搬页面的铁律（来自 refactor-plan 教训 13、14）
1. **先读旧页面，再动手。** 每个分段对应的旧文件在 §4 表里写了路径和行数；旧页的交互模型（谁能改、什么时候写库、哪些是派生状态）是产品定义，契约只是形状。照契约凭空做过一次点菜页，被用户打回重做。
2. **用脚本验证，不用眼睛。** 每页至少：Playwright 冒烟（渲染、零 `pageerror`、不横向溢出）+ 关键写路径看真实响应码 + 390 / 1280 两个宽度、亮 / 暗两套截图存到 `.tmp-shots/` 并用 Read 看一眼。
3. **搬完只翻 `nav.ts` 一行**：把该分段的 `legacy` 换成 `path`、加 `ready: true`。桥接页、侧栏、气泡菜单、⌘K 都会自动跟上。
4. 新文件 ≤ 400 行；页面超了就拆 `xxx-view.tsx` / 组件（购物、库存就是这么拆的）。
5. 教训写进 `docs/refactor-plan.md` 的教训列表（当前编号到 14），和代码同一个提交。
6. 用户在乎的视觉标准：**桌面端不能留大片空白**（两栏时右栏 320px 固定、左栏 `flex-1`；单列内容用 `Panel` 撑满高度）；手机端底部操作条要避开 tab 栏（`bottom-[calc(56px+env(safe-area-inset-bottom))]`）；暗色模式必须能看；动效遵守 `.claude/skills/apple-design/SKILL.md`（ease-out 进场、退场镜像更短、`prefers-reduced-motion` 全关）。

---

## 2. 新客户端骨架速览（改代码前先读这些文件）

```
apps/web/src/
├─ App.tsx                 路由表：<Shell/> 下 / , /eat/*, /schedule/*, /:scene/:segment → LegacyBridge
├─ main.tsx                QueryClient + BrowserRouter + AuthProvider + ThemeProvider
├─ index.css               Tailwind 4 主题 token、视图过渡、气泡菜单动效
├─ lib/
│  ├─ api.ts               fetch 封装：request<T>(path, init)，自动带 token、解 {data}/{error}
│  ├─ auth.tsx             useAuth(): { member, isManager, login, logout }
│  ├─ queries.ts           全部数据 hook（TanStack Query），queryKey 约定 ['域', ...参数]
│  ├─ nav.ts               SCENES 五场景配置；landingPath / sceneOf / segmentOf / legacyUrl / visibleSegments
│  ├─ prefetch.ts          路由 → 要预取的 query 列表（key 必须和 hook 里的完全一致，否则预取白做）
│  ├─ cart.tsx / theme.ts / toast.ts
├─ components/
│  ├─ shell.tsx            桌面 Sidebar / 手机 BottomTabs + SceneMenu 气泡 / Shell / LegacyBridge
│  ├─ soft-link.tsx        SoftLink + useSoftNavigate（startViewTransition 包一层 navigate）
│  ├─ command-palette.tsx  ⌘K
│  ├─ ui/index.tsx         Button Input Card SectionTitle Checkbox selectClass Segmented Dialog Page Panel EmptyState
│  ├─ skeleton.tsx         Skeleton / ListSkeleton / StatsSkeleton
│  ├─ toast.tsx
│  ├─ calendar-*.tsx event-form.tsx reminder-form.tsx recipe-editor.tsx inventory-*.tsx stock-dialog.tsx
└─ pages/
   today order kitchen recipes shopping(+shopping-view) inventory(+inventory-view) calendar tasks reminders notifications login
```

**一页的标准长相**（照 `pages/reminders.tsx` 或 `pages/notifications.tsx` 抄）：

```tsx
export default function XxxPage() {
  const { data, isLoading } = useXxx(...);
  return (
    <Page title="投票" subtitle="……" actions={<Button>新建</Button>} toolbar={<Segmented …/>}>
      <Panel title="进行中">            {/* 主列 flex-1 */}
        {isLoading ? <ListSkeleton/> : rows.length ? rows.map(…) : <EmptyState emoji="🗳️" title="还没有投票" hint="…"/>}
      </Panel>
      <aside className="lg:w-[320px] shrink-0"> … </aside>   {/* 需要第二栏才加 */}
      <Dialog open={…} onClose={…} title="…" footer={…}> … </Dialog>
    </Page>
  );
}
```

数据 hook 的标准长相（照 `queries.ts` 里 `useReminders` / `useUpsertReminder` 抄）：契约类型从 `@family/contracts` 拿（`import type { Poll } from '@family/contracts'`），`useMutation` 的 `onSuccess` 里 `invalidateQueries({ queryKey: ['polls'] })`，并给 `lib/prefetch.ts` 加一条路由 → `[{ queryKey, queryFn }]`。

跨域跳转用现成的：`useOpenEntry`（日历条目 → 对应页）、`legacyUrl(targetPath)`（还没搬的目标）。消息页的 `NEW_ROUTE` 映射表每搬一页要补一行。

---

## 3. 每个搬页任务的标准流程（SOP，B 阶段每个任务都走一遍）

1. **读**：旧页面全文（§4 表里的路径）+ `packages/contracts/src/<域>.ts` + `apps/api/scripts/<域>.mjs`（黑盒脚本里有每个端点的真实调用顺序和数据形状）+ 旧 Playwright 里和该域相关的 spec（如果有）。把旧页的**功能清单**列成 checklist 写在任务备注里，搬完逐条对。
2. **hooks**：`lib/queries.ts` 加该域 hook（读 + 写 + invalidate），`lib/prefetch.ts` 加路由。
3. **页面**：`pages/<key>.tsx`（超 400 行拆 view/组件），用 `Page/Panel/Dialog/Segmented/EmptyState/Skeleton`。
4. **路由**：`App.tsx` 加 `<Route path="/house/points" element={<PointsPage/>}/>`；旧客户端的一级路径（如 `/points`）加一条 `<Navigate to="/house/points" replace/>`，保证消息/通知里的老链接还能打开。
5. **翻 nav**：`lib/nav.ts` 该分段 `legacy:` → `path:` + `ready: true`。
6. **补映射**：`pages/notifications.tsx` 的 `NEW_ROUTE`、`pages/calendar.tsx` 的 `useOpenEntry`（如果该域会出现在通知/日历里）。
7. **测试**：`apps/web/e2e/` 加该页冒烟 + 1～2 条写路径用例；本地 `corepack pnpm test:web:next` 全绿。
8. **截图**：390×844 与 1280×800、亮 / 暗，各一张到 `.tmp-shots/`，Read 看一眼有没有空白、溢出、撞色。
9. **（可选但推荐）Zod 顺路迁移**：把 `apps/api/src/<域>/…module.ts` 里的 class-validator DTO 换成 `@ZodBody/@ZodQuery/@ZodParam`（`src/common/zod.ts`），逐条对照 DTO 装饰器，契约缺的约束补进 `packages/contracts`，黑盒脚本补断言；`build:packages` → `test:api` 全量。**单独提交** `refactor(api): <域>请求校验换成契约 schema`。做不做由执行者按时间定，做了就在进度表里记。
10. **记录 + 提交 + push + 看 CI**。

---

## 4. 任务清单

工作量档位：S ≤ 半天，M ≈ 1 天，L ≈ 2 天，XL ≈ 3 天+。行数是旧页面大小，只是难度提示。

### Phase A · 安全网（A1 → A2 → A3，做完才能开 B）

#### A1 · 新客户端的 Playwright 套件 ［L］
- **目标**：CI 里有一套指向 `apps/web` 的浏览器回归，覆盖登录 + 已搬 10 页冒烟 + 5 条写路径，复用现有随机库隔离。
- **先读**：`apps/api/scripts/run-web-tests.mjs`（隔离库 + 起 API 的方式）、`apps/mobile/playwright.config.ts`、`apps/mobile/e2e/auth.setup.ts`（登录方式，新客户端登录页占位符是「输入账号」「输入密码」，按钮「登录」）、`apps/web/vite.config.ts`（代理）、`apps/web/src/lib/auth.tsx`（token 存哪，决定 storageState 能不能复用）。
- **改**：
  - `apps/web/package.json`：devDeps 加 `@playwright/test`（版本和 mobile 对齐）；scripts 加 `"test:web": "playwright test"`。
  - `apps/web/playwright.config.ts`：`baseURL` 取 `FAMILY_WEB_URL`（默认 `http://localhost:5180`）；projects：`setup`（登录一次，存 `e2e/.auth/desktop.json` / `mobile.json`）、`desktop-chrome`（1280×800）、`mobile-chrome`（390×844，hasTouch）；`workers: 1`；`webServer` 起 `vite --port <FAMILY_WEB_URL 的端口> --strictPort`，环境变量把 `/api` 指到隔离 API。
  - `apps/web/vite.config.ts`：新增 `FAMILY_API_STRIP_PREFIX=1` 时代理 `rewrite: p => p.replace(/^\/api/, '')`（直连 NestJS 时没有 Caddy 帮忙剥前缀）。
  - `apps/api/scripts/run-web-tests.mjs`：加 `--client web`（或环境变量 `E2E_CLIENT=web`）分支：`FAMILY_WEB_URL=http://localhost:5181`、`FAMILY_API_ORIGIN=http://127.0.0.1:<API_PORT>`、`FAMILY_API_STRIP_PREFIX=1`，跑 `corepack pnpm --filter web test:web`。默认分支行为不变（旧客户端继续跑）。
  - 根 `package.json`：`"test:web:next": "corepack pnpm --filter api test:web -- --client web"`。
  - `apps/web/e2e/`：
    - `auth.setup.ts`：用鼠标登录一次（和旧的一样先查 `/health/ready`），两份 storageState。
    - `smoke.spec.ts`：对 `/`、`/eat/order`、`/eat/kitchen`、`/eat/recipes`、`/eat/shopping`、`/eat/inventory`、`/schedule/calendar`、`/schedule/tasks`、`/schedule/reminders`、`/schedule/notifications` 每个：`page.on('pageerror')` 计数为 0、`h1`/标题可见、`document.documentElement.scrollWidth <= clientWidth`。两个 project 都跑。把路径列表写成数组，B 阶段每搬一页加一项。
    - `nav.spec.ts`：桌面侧栏点「日程 → 提醒」URL 变了；手机按下「吃饭」tab 弹出气泡、点「库存」跳转并且气泡关掉；⌘K 输入「购物」回车跳转。
    - `write-paths.spec.ts`：点菜提交一道菜（POST 201）、任务打勾、日历新建 + 删除、提醒新建 + 取消、消息全部已读。**每条用例自己造数据自己清**，不要依赖顺序。
- **验收**：本地 `corepack pnpm test:web:next` 全绿（隔离库自动建、自动删）；两套 storageState 不进 git（`.gitignore` 加 `apps/web/e2e/.auth/`）。
- **提交**：`test(web): 新客户端接入 Playwright 与隔离库`

#### A2 · CI 覆盖 `apps/web` ［S］
- **目标**：静态检查 job 会 build + lint 新客户端；Playwright job 同时跑新旧两套。
- **先读**：`.github/workflows/ci.yml`（job：`check` / `api-tests` / `web-tests` / `docker-build`）、根 `package.json` scripts。
- **改**：
  - `apps/web/eslint.config.js`：typescript-eslint + react-hooks + react-refresh（参考 `apps/api/eslint.config.*` 的风格，`max-lines: 400` 同样开）；`apps/web/package.json` 加 `"lint": "eslint src"`。先本地跑一遍把现有告警清零。
  - 根 `lint` 脚本加 `&& corepack pnpm --filter web lint`。
  - `ci.yml` `check` job 加两步：`corepack pnpm --filter web lint`、`corepack pnpm --filter web build`；`web-tests` job 加一步 `corepack pnpm test:web:next`（放在旧套件后面，失败截图上传路径加 `apps/web/test-results`）。**这一步如果工具拒绝写 `.github/workflows/`，把完整 diff 贴给用户。**
- **验收**：push 后 CI 四个 job 全绿，`check` 日志里能看到 vite build 输出。
- **提交**：`ci: 静态检查与回归覆盖新客户端`

#### A3 · 演示数据脚本化 ［M］（已完成——实际做法：不改 seed.ts，而是 `scripts/demo-data.mjs` 走 HTTP 造数，业务规则和通知由 API 自己保证）
- **目标**：`corepack pnpm seed -- --demo` 一条命令造出一套像样的家庭数据，本地演示和 Playwright 冒烟都用它，不再手工 curl。
- **先读**：`apps/api/src/seed.ts`（现有：家庭 + 爸爸/妈妈 + 食材 + 菜品，幂等）、`apps/api/src/entities/index.ts`、各域黑盒脚本里的造数方式（`calendar.mjs` `shopping-inventory.mjs` `tasks.mjs` `reminders.mjs` `polls.mjs` `points.mjs` `assets.mjs` `knowledge.mjs` `memories.mjs` `travel.mjs` `finance.mjs` `guests.mjs`）。
- **改**：`seed.ts` 加 `--demo` 参数（`process.argv.includes('--demo')`），拆到 `apps/api/src/seed-demo.ts`（≤ 400 行，再超按域拆）。**必须幂等**（每类数据先查有没有再插）。至少：未来两周 8～10 条日历事件、今明两天三餐点菜（含一道被拒）、5 条库存 + 2 个批次（一个快过期）、3 条购物清单、4 条任务（1 条已完成）、2 条待发提醒、1 个进行中投票、每人一些积分流水、2 件资产（一件有维护记录）、3 条知识库、2 条回忆、1 次出行、本月 5 笔财务、1 个访客邀请。已搬页面用到什么就造什么；B 阶段每搬一域回来补该域。
- **顺手**：`run-web-tests.mjs` 的 `--client web` 分支在起 API 前跑 `seed.ts --demo`，让冒烟有内容可渲染。
- **验收**：对一个空库连跑两次 `seed -- --demo` 不报错、行数不翻倍；新客户端 10 页都不是空态。
- **提交**：`feat(api): 种子脚本支持 --demo 造一套演示数据`

### Phase B · 搬完剩下 14 个分段（按下面顺序，每个走 §3 的 SOP）

新路由固定按 `nav.ts` 的场景前缀：家务 `/house/*`、我的 `/me/*`、日程 `/schedule/polls`、吃饭 `/eat/media`。旧一级路径都要加 `Navigate` 兜底。

| # | 分段 | 旧页面（行数） | 契约 | 黑盒脚本 | 新路由 | 档位 | 要点 |
|---|---|---|---|---|---|---|---|
| B1 | 投票 | `apps/mobile/src/app/(tabs)/polls.tsx`（1705） | `polls.ts` | `polls.mjs` | `/schedule/polls` | L | 家庭投票（观影投票在 `media/polls.tsx`，留给 B14）。Zod 已迁完，不用做第 9 步。注意投票的截止/匿名/多选规则以旧页为准。 |
| B2 | 积分 | `(tabs)/points.tsx`（835） | `points.ts` | `points.mjs` | `/house/points` | M | 积分流水、兑换、管理员加减分。Zod 已迁完。 |
| B3 | 成员 | `(tabs)/members.tsx`（506） | `auth.ts` | `members-activities.mjs`、`bootstrap-invitations.mjs` | `/house/members` | M | `managerOnly`。含邀请/停用/角色变更；**不要**在客户端做任何密码明文处理，照旧页调接口。 |
| B4 | 个人 | `(tabs)/profile.tsx`（788） | `auth.ts` | `security-consistency.mjs`、`external-notifications.mjs` | `/me/profile` | M | 头像、改密码、外部通知渠道设置（消息页现在有一个「外部渠道设置」的旧版链接，搬完改成站内链接）。 |
| B5 | 问问小管家 | `(tabs)/assistant.tsx`（1792）+ `(tabs)/agent-memory.tsx` + `agent-memory/[id].tsx` | `agent.ts` | `agent*.mjs`（7 个） | `/me/assistant`、`/me/assistant/memories` | XL | 对话流（看旧页是 SSE 还是轮询）、提案确认、记忆管理、例行任务设置。旧 spec `agent-ui.spec.ts`（有「新对话不清草稿」的回归用例，教训 12）、`agent-memory.mock.spec.ts`、`agent-responsive.mock.spec.ts` 要在新套件里有等价用例。 |
| B6 | 访客 | `(tabs)/guests.tsx`（448）+ `app/guest/[token].tsx` | `guests.ts` | `guests.mjs` | `/house/guests` + **公开页 `/guest/:token`** | M | 公开页在 `<Shell/>` 之外、不需要登录，`App.tsx` 单独一条路由。 |
| B7 | 资产 | `(tabs)/assets.tsx`（2036）+ `app/asset/[id].tsx`；`home-assets.tsx` 只是 re-export | `assets.ts`、`upload.ts` | `assets.mjs` | `/house/assets`、`/house/assets/:id` | XL | 列表 + 详情两页；附件上传（multipart）与二进制下载端点契约是 `z.undefined()`，wire 格式要自己验。旧 spec `apple-assets-profile.mock.spec.ts`。 |
| B8 | 财务 | `(tabs)/finance.tsx`（836） | `finance.ts` | `finance.mjs` | `/house/finance` | L | `managerOnly`。账目、分类、月度汇总、审批。旧 spec `finance-ui.spec.ts` 要有等价用例。 |
| B9 | 知识库 | `(tabs)/knowledge.tsx`（1068） | `knowledge.ts` | `knowledge.mjs` | `/house/knowledge` | L | 条目 + 版本历史 + 附件。 |
| B10 | 回忆 | `(tabs)/memories.tsx`（885） | `memories.ts`、`upload.ts` | `memories.mjs` | `/house/memories` | L | 照片上传/展示（二进制端点）。 |
| B11 | 出行 | `(tabs)/travel.tsx`（1634） | `travel.ts` | `travel.mjs` | `/house/travel` | L | 行程、清单、费用。 |
| B12 | 备份 | `(tabs)/system-backups.tsx`（611） | `system.ts` | `backups.mjs` | `/house/backups` | M | `managerOnly`。触发备份/恢复是危险操作，**只在隔离库验证**，本机演示库不要点恢复。 |
| B13 | 家庭动态 | `(tabs)/activity.tsx`（277） | `activities.ts` | `members-activities.mjs` | `/me/activity` | S | 时间线；点击跳目标页复用消息页的 `NEW_ROUTE` 逻辑（抽成 `lib/routes.ts` 共用）。 |
| B14 | 观影 | `media/index.tsx`（387）、`media/library.tsx`（572）、`media/watchlist.tsx`（3103）、`media/history.tsx`（344）、`media/settings.tsx`（1293）、`media/polls.tsx` | `media.ts` | `media.mjs`、`media-library.mjs`、`media-source-settings.mjs`、`media-connector-settings.mjs`、`moviepilot-webhook.mjs`、`playback-webhook.mjs` | `/eat/media`（概览）、`/eat/media/library`、`/eat/media/watchlist`、`/eat/media/history`、`/eat/media/settings` | XL×2 | **拆成 4 个提交**：B14a 概览 + 片库、B14b 想看 + 观影投票、B14c 观影历史、B14d 连接器设置（`managerOnly`）。三方（TMDB/Plex/Emby/MoviePilot）在隔离库里都是空配置，用 mock spec 的做法（旧 `media-library.spec.ts`、`media-user-mappings.spec.ts`、`viewing-history.spec.ts`、`moviepilot-webhook.spec.ts`）。`nav.ts` 里 media 保持一个分段，子页用页内 `Segmented` 或子路由。 |

**B0（开 B 之前顺手做，S）**：检查旧客户端里 `app/dish/[id].tsx`、`app/dish-edit.tsx`、`app/recipe-edit.tsx`、`(tabs)/canteen/index.tsx` 的功能是否已被新的菜谱/点菜页覆盖；没覆盖的列成额外任务加进进度表，不要默默丢掉。

**每个 B 任务的验收模板**：
- 旧页功能 checklist 逐条打勾（写在进度表备注里）。
- `nav.ts` 对应行已翻 `ready: true`；`/:scene/:segment` 桥接页对该分段不再出现。
- `smoke.spec.ts` 路径数组已加该页；新增 ≥ 1 条写路径用例；`corepack pnpm test:web:next` 全绿。
- `typecheck` + `lint` 干净；CI 全绿。
- 四张截图看过（390/1280 × 亮/暗）。
- `seed-demo.ts` 已补该域演示数据。

**提交信息**：`feat(web): 搬运投票` / `feat(web): 搬运积分` / … / `feat(web): 搬运观影（1/4）概览与片库`。

### Phase C · 切换与下线（B 全部完成后）

#### C1 · 生产镜像切到新客户端，旧客户端挂到 `/legacy` ［M］
- **先读**：`Dockerfile.web`（现在 build 的是 `apps/mobile` 的 `expo export`）、`deploy/Caddyfile`、`docker-compose.prod.yml` 的 `web` 服务、`apps/web/src/lib/nav.ts` 的 `legacyUrl`。
- **改**：
  - `Dockerfile.web`：build 阶段改成 `pnpm install --filter web... --filter "./packages/*"` + `pnpm --filter web build`，产物 `apps/web/dist` → `/srv`；再加一个 stage 构建旧客户端（`expo export --platform web`，`app.json` 的 `experiments.baseUrl` 设成 `/legacy`）→ `/srv-legacy`。构建参数 `VITE_LEGACY_ORIGIN=/legacy`（`legacyUrl` 是字符串拼接，传一个路径前缀就能工作，不用改代码）。
  - `deploy/Caddyfile`：`handle_path /legacy/* { root * /srv-legacy; try_files {path} /index.html; file_server }` 放在默认 `handle` 之前。
  - CSP 头检查新客户端有没有被拦（Tailwind 4 / Vite 产物是纯静态，应该没事；有内联脚本就调整）。
- **验收**：`docker build -f Dockerfile.web .` 成功；本机用 prod compose 起一次，`/` 是新客户端、`/legacy/` 是旧客户端、`/api/health/ready` 通；新客户端里任何残留的「在旧版打开」链接（理论上 B 做完就没有了）能跳到 `/legacy/...`。
- **提交**：`build: 生产入口切到新客户端，旧客户端保留在 /legacy`
- **用户要做的**：把 `ci.yml` `docker-build` job 里缺的两步补上（`docker build -f Dockerfile.web -t family-app-web:ci .`、以及一条 `docker run --rm family-app-web:ci caddy validate --config /etc/caddy/Caddyfile`）。这个文件受保护，执行 agent 给 diff，用户自己贴。

#### C2 · 家庭试用两周 ［日历任务，不占开发时间］
- 部署后家里人用两周；每个问题记进 `docs/manual-acceptance.md`（已有格式），修一个记一个。
- 期间不删任何旧代码。

#### C3 · 删除旧客户端 ［M］
- **前提**：C2 两周内没有需要回到 `/legacy` 的问题。
- **改**：删 `apps/mobile/`、`Dockerfile.web` 的 legacy stage、Caddy 的 `/legacy` 块、`run-web-tests.mjs` 的旧分支（`--client web` 变成唯一行为，根 `test:web:next` 改名回 `test:web`）、根 `package.json` 的 `mobile` / `lint:mobile` 脚本、`typecheck` 里的 mobile、`ci.yml` 里旧 Playwright 步骤（给 diff）、`nav.ts` 的 `legacy` 字段与 `LegacyBridge`、`App.tsx` 的 `/:scene/:segment` 路由、`pnpm-workspace.yaml` 若有显式列出。`corepack pnpm install` 刷新 lockfile。
- **验收**：`typecheck` / `lint` / `test:api` / `test:web` 全绿；`docker compose -f docker-compose.dev.yml config` 通过；仓库里 `grep -r "apps/mobile"` 只剩 docs 历史记录。
- **提交**：`chore: 下线旧 Expo 客户端`

#### C4 · 文档改写 ［S］
- `README.md`、`CLAUDE.md`（「结构」段的 `apps/mobile` 换成 `apps/web`；「常用命令」里的 `npx pnpm` 全部改成 `corepack pnpm`，这是现存文档的一个错误）、`docs/refactor-plan.md` 加 5.6 节「切换完成」记录数据（新客户端行数、页面数、Playwright 用例数、切换日期）。
- **提交**：`docs: 客户端切换完成，更新结构与命令说明`

### Phase D · 之后（C 完成后再开，先问用户要不要开）

#### D1 · AI 自动找菜谱 ［L，需要用户确认范围］
- 用户原话：「AI agent 自动从网上找菜谱」。套现有 agent 的「提案 → 家人确认 → 执行」机制（`agent.ts` 里 proposal 相关端点、`agent-proposal-groups.mjs`），不要绕开确认直接写菜谱库。
- 先出一页设计（触发方式、来源、去重、确认 UI 放在哪一页）给用户过目再动手。

#### D2 · 重开 Phase 2 换栈决策门 ［讨论任务］
- 用切换后两周的真实数据回答：API 冷启动时间、内存、改一个域平均动几个文件、黑盒全量耗时。把数据写进 `docs/refactor-plan.md` 3.3 节下面，给用户做决定；执行 agent 不自作主张换栈。

---

## 5. 用户自己要做的事（执行 agent 做不了或不该做的）

1. `ci.yml`：A2 和 C1、C3 会各给一份 diff，用户自己贴进去（文件受保护）。
2. 生产部署：C1 之后用户自己在 NAS/服务器上 `docker compose -f docker-compose.prod.yml up --build`；执行 agent 不碰生产。
3. 任何账号/密码/密钥（TMDB、Plex、MoviePilot、通知渠道）都由用户自己填，执行 agent 只留空或用 mock。
4. 决定什么时候把 `refactor/phase-0-safety-net` 合进 main。

---

## 6. 已知的坑（别再踩）

- React Router 的 `viewTransition` 属性在 `<BrowserRouter>` 下无效，所以有 `SoftLink`；新页面里所有站内跳转都用 `SoftLink` / `useSoftNavigate`，不要直接 `<Link>`。
- `prefetch.ts` 里的 queryKey 和 hook 不一致 = 预取白做；加 hook 时复制粘贴 key。
- 手机气泡菜单是 `onPointerDown` 打开的；页面里如果有自己的浮层，关闭逻辑用 `onNavigate` 回调而不是 `pointerdown`，否则 click 永远打不到。
- 嵌套 `<button>` 是 DOM 非法（日历格子踩过）：容器要可点又要包按钮，用 `div role="button" tabIndex={0}`。
- `str.replace` 批量改 JSX 时锚点要带上下文，`</div>) : null}` 这种模式一个文件里经常有两处。
- 旧客户端 `family-navigation.spec.ts` 有一条偶发 401 的 flaky（首页零 console 错误断言），一次红一次绿，不改旧客户端代码就再跑一次；**不要放宽断言**。
- 演示库（本机 8088 那套）里有我之前手工造的测试数据（9 条日历、5 条库存、2 批次、2 购物项、2 条划菜通知）；A3 做完后可以清库重新 `seed -- --demo`。
- Playwright 的 `webServer.reuseExistingServer` 是个陷阱：vite 没有 `--strictPort` 时端口被占会**静默换端口**，
  于是隔离跑复用到一台代理去 8088（演示库）的 dev server，症状是登录 401「账号或密码不正确」，
  跟密码、seed、限流全都没关系。现在隔离跑传 `E2E_ISOLATED=1` 禁用复用，`web dev` 也加了 `--strictPort`。
- `test:api -- --only <域>` 单跑可能假红：`agent-memory` 单跑必失败（memoryEnabled=false 那条断言依赖前面脚本落下的数据），
  全量跑是绿的。CLAUDE.md 早写了「--only 只用于迭代，验收必须全量跑」，别被单跑的红吓到。
- 老页面字段名别猜：点菜项是 `requestedById`（不是 `orderedById`），`/menus?date=` 一次返回三餐，提醒来源 `/reminder-sources?start&end`。

---

## 7. 进度表（执行 agent 维护；每完成一个改状态、写一句备注、附提交哈希）

| 任务 | 状态 | 提交 | 备注 |
|---|---|---|---|
| A1 Playwright 新套件 | ☑ | | 48 用例（setup 2 + 冒烟 13 + 导航 5 + 写路径 5，两视口），隔离库 48 秒；顺手修了手机端对话框被标签栏盖住的 bug（教训 15） |
| A2 CI 覆盖 web | ◐ | | 仓库侧完成：web 有 eslint（max-lines 400 是 error，已把 queries.ts / shell.tsx / kitchen.tsx 拆到 400 行内，react-hooks 全清）、根 lint 含 web；**等用户贴 `docs/ci-pending-A2.diff`**（`git apply docs/ci-pending-A2.diff`），CI 绿了再打勾 |
| A3 seed --demo | ☑ | | 改成走 HTTP 的 `apps/api/scripts/demo-data.mjs`（`corepack pnpm demo`，本机加 `API_URL=http://localhost:8088/api`）：13 个域、幂等、日期相对今天；`test:web:next` 起隔离 API 后自动跑一遍，冒烟不再是空态 |
| B0 检查 dish/recipe-edit/canteen 覆盖情况 | ☑ | | `canteen` 是旧客户端给普通成员的入口页（新 IA 用今天页 + managerOnly 覆盖）；`dish/[id]` 的做法版本/谁会做/加菜篮、`recipe-edit` 的食材/步骤/链接都在新菜谱页；**缺的是 `dish-edit` 的菜品基本信息**（菜名/分类/难度/耗时/口味/照片/下架）——已补 `components/dish-editor.tsx` + 菜谱页「+ 新建菜品」「编辑」，写路径用例 +1 |
| B1 投票 | ☑ | | `/schedule/polls`：列表筛选、发起/编辑（有人投过就锁候选项）、单多选投票/改票/撤票、结束/重开/删除、?pollId= 聚焦、?create=1；新增 `lib/routes.ts` 把后端 targetPath 换算成新路径（通知、日历条目共用）；旧一级路径跳转现在保留查询串 |
| B2 积分 | ☑ | | `/house/points`：余额条 + 三段（家庭奖励 / 兑换审批 / 积分流水）；奖励增删改停用、申请兑换（带「预计积分变化」）、管理员确认/拒绝、申请人取消、撤销已确认、反向冲销流水；?redemptionId= 聚焦。顺手修了一个坑：Playwright 的 `reuseExistingServer` 会复用「恰好在这个端口上」的别的 dev server，把 /api 代理到错后端 → 登录 401；隔离跑现在传 `E2E_ISOLATED=1` 不复用，`web dev` 也加了 `--strictPort` |
| B3 成员 | ☑ | | `/house/members`（managerOnly）：成员行（角色/掌勺/账号/停用状态）、编辑（不能改自己的角色，改别人角色会提示对方要重新登录）、停用/恢复访问、角色权限说明；**邀请从旧客户端的「个人」页搬到这儿**（生成一次性邀请码 + 复制 + 撤销，侧栏列待接受的）——B4 个人页因此只剩密码和外部通知渠道 |
| B4 个人 | ☑ | | `/me/profile`：档案（名字/头像去成员页改）、经常掌勺开关、小管家「启用记忆」（乐观锁，冲突会提示刷新）、管理员的「主动提醒」夜间汇总开关（同时校验两个版本号）、改/设密码、退出登录。旧页的「家庭内容」链接堆不搬——侧栏和底部 tab 已经是导航；**外部通知渠道留给 B4b**（它在旧客户端属于消息页） |
| B4b 外部通知渠道（补在消息页） | ☑ | | 消息页改成三段：消息 / 外部渠道 / 投递记录。渠道增删改停用、发测试消息、每个人自己的「收哪些模块」偏好、投递记录与重投；旧版链接删掉。顺手把 setup 改成「令牌还有效就不重新登录」——本机登录限流 5 次/分钟，反复跑必撞 429（隔离跑每次新库，照样会真的走一遍登录页） |
| B5a 小管家：对话 | ☑ | | `/me/assistant`：会话列表（新建/切换/归档）、消息流、发送、运行中的工具进度、停止、失败重试、Hermes 不可用时的本地摘要提示、工具结果卡片（点进对应页面）、单条操作提案确认/放弃（乐观锁 + 幂等）。轮询按旧客户端的 700ms（后端是排队 + worker，没有 SSE）。**注意**：演示栈和隔离库里 agent 都没启用（`status.enabled=false`），所以只有冒烟覆盖，发消息这条路要等接了 Hermes 才能端到端验 |
| B5b 小管家：多步骤提案组 + 记忆页 | ☑ | | 提案组卡片（按步骤列出、整组确认/放弃）接在对话流里；`/me/assistant/memories` 把旧的两页（列表 + 详情路由）合成一页 + 详情弹窗：我的/共享、已生效/待确认、主动记一条、确认、改内容、共享到家庭、忘掉、清空。**顺手补了一个契约缺口**：`DELETE /agent/memories/:id` 的控制器读 `dto.expectedVersion`，契约里却没声明 body，客户端照契约写就会版本冲突 |
| B5c 小管家：助理设置（运行时 + 渠道绑定） | ☑ | | 对话页右上「设置」弹窗：启用开关、本地摘要 / Hermes 切换（乐观锁）、消息渠道绑定（签发一次性配对码，明文只回一次；解绑已绑定的渠道；作废没用掉的配对码）。**至此 B5「问问小管家」整段完成** |
| B6 访客 + 公开页 | ☐ | | |
| B7 资产 + 详情 | ☐ | | |
| B8 财务 | ☐ | | |
| B9 知识库 | ☐ | | |
| B10 回忆 | ☐ | | |
| B11 出行 | ☐ | | |
| B12 备份 | ☐ | | |
| B13 家庭动态 | ☐ | | |
| B14a 观影：概览 + 片库 | ☐ | | |
| B14b 观影：想看 + 投票 | ☐ | | |
| B14c 观影：历史 | ☐ | | |
| B14d 观影：连接器设置 | ☐ | | |
| Zod 顺路迁移（记录做了哪些域） | ☐ | | 已完成：common、polls、points、tasks、agent（部分）；未完成 19 个域见 `grep -rl class-validator apps/api/src` |
| C1 镜像与 Caddy 切换 | ☐ | | |
| C2 家庭试用两周 | ☐ | | 起止日期： |
| C3 删除旧客户端 | ☐ | | |
| C4 文档改写 | ☐ | | |
| D1 AI 找菜谱 | ☐ | | 需用户确认范围 |
| D2 换栈决策门 | ☐ | | 需用户决定 |

状态：☐ 未开始 · ◐ 进行中 · ☑ 完成 · ✗ 放弃（写原因）
