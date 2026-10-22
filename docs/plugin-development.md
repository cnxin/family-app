# 写一个插件

本文面向希望向 Family App 贡献新业务域的开发者。这里的“插件”是统一业务域边界、声明和登记方式，不是可下载的扩展包。

## 先理解当前边界

当前插件机制是**仓库内、编译期接入**：

- `packages/contracts/src/plugins/keys.ts` 的 `PLUGIN_KEYS` 显式列出插件 key。
- `packages/contracts/src/plugins/manifests.ts` 显式 import 每份 manifest 并组成 `PLUGIN_MANIFESTS`。
- Nest 模块、React 页面、助理工具和数据库实体仍需在各自入口显式实现或注册。
- `scripts/check-plugins.mjs` 检查声明和实现是否一致，但不会生成业务代码。

因此，目前没有任意运行时安装、插件市场、目录自动发现、热加载或第三方代码沙箱。新增插件通常会同时修改 contracts、API、Web、测试和文档，不能只提交一份 manifest。

建议先阅读两个真实插件：

- `polls`：完整而较小，覆盖契约、API、页面、查询、动作提案、留意和通知。
- `points`：补充能力权限和事务内钩子的参考。

## 接入清单

一个有页面、端点和数据表的插件通常涉及以下位置：

```text
packages/contracts/src/plugins/keys.ts
packages/contracts/src/plugins/<key>.ts
packages/contracts/src/plugins/manifests.ts
packages/contracts/src/<key>.ts
packages/contracts/src/index.ts

apps/api/src/<key>/<key>.module.ts
apps/api/src/<key>/<key>.controller.ts
apps/api/src/<key>/<key>.service.ts
apps/api/src/app.module.ts
apps/api/scripts/<key>.mjs

apps/web/src/pages/<key>.tsx
apps/web/src/lib/queries/<key>.ts
apps/web/src/lib/queries/index.ts
apps/web/src/lib/nav.ts
apps/web/src/lib/actions.ts
apps/web/src/lib/routes.ts
apps/web/src/App.tsx
```

若插件使用实体、迁移、能力、助理工具、设置行或跨插件接口，还要完成后文对应登记。文件名可遵循现有域，不要求机械地与 key 完全相同。

## 1. 选择 key 并登记 manifest

插件 key 是事件域、模块开关和多数登记的统一身份。新增时：

1. 把 key 加入 `PLUGIN_KEYS`。
2. 新建 `packages/contracts/src/plugins/<key>.ts`。
3. 在 `packages/contracts/src/plugins/manifests.ts` 显式 import 并加入 `PLUGIN_MANIFESTS`。
4. 没有历史兼容需求时，不要在 `PLUGIN_ALIASES` 制造另一套 key。

以下是从 `pollsManifest` 裁剪的说明片段，**不是可直接注册的完整插件**：

```ts
import type { PluginManifest } from './types';

export const exampleManifest = {
  key: 'example',
  name: '示例',
  glyph: '例',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'example', label: '示例', glyph: '例', scene: 'life', path: '/life/example' }],
  module: {
    overridable: true,
    hasData: { kind: 'tables', tables: [{ table: 'examples' }] },
  },
  events: {
    routes: [{ prefix: '/examples' }],
    queryKeys: ['examples'],
  },
} as const satisfies PluginManifest;
```

`manifestVersion` 当前固定为 `1`。manifest 只放可序列化声明，不放 Nest、React、TypeORM 或执行函数。

### Manifest 字段

- `key`、`name`、`glyph`、`manifestVersion`、`tier`：插件身份和默认层级。
- `nav`：导航分段声明。Web 仍要在 `SCENES` 的目标位置手工展开该插件。
- `legacyPaths`：后端生成的旧 `targetPath` 到新路径的转换声明；它不会自动创建浏览器路由重定向。
- `module`：模块是否可由家庭覆盖，以及怎样判断已有数据。
- `events`：HTTP 写路由、客户端缓存失效 key，以及本插件发出的进程内事件名。
- `requires`：面向维护者的依赖说明，描述经 contract、event 或 kernel 使用什么；它不是运行时依赖注入。
- `dependsOn`：从 `PluginFacadeRegistry` 获取的其他插件门面，代码与声明会被守门脚本核对。
- `hooks`：订阅的事务内钩子，代码与声明会被守门脚本核对。
- `attention`、`actions`、`queries`：留意、命令动作、助理查询及写提案声明。
- `settingsRows`、`usage`、`notifications`：设置页、用量报告和通知元数据。
- `capabilities`：插件新增的能力名及默认授予角色。

manifest 不会自动把新插件插进 Web 的有序注册表。至少根据实际声明同步：

- 在 `apps/web/src/lib/nav.ts` 的目标 `SCENES[].segments` 位置加入 `...pluginSegments('<key>')`；
- 有 `actions` 时，在 `apps/web/src/lib/actions.ts` 的 `ACTIONS` 中加入 `...fromPlugin('<key>')`；
- 有 `legacyPaths` 时，在 `apps/web/src/lib/routes.ts` 的 `MOVED` 中加入 `...legacyPaths('<key>')`，供通知、日历和提醒等内部 `targetPath` 转换使用。

`scripts/check-plugins.mjs` 会检查部分手工表、API 目录归属和跨插件边界，`apps/web/src/lib/plugins-registry.test.ts` 会核对已经接入的派生结果；两者都不会替你插入上述调用。根据插件能力，还可能需要同步：

- `apps/web/src/lib/nav.ts` 的 core 顺序或 mobile tab 选择；
- `packages/contracts/src/system.ts` 的 `SHELF_MODULE_KEYS`；
- `packages/contracts/src/today.ts` 的留意 domain 枚举；
- `apps/web/src/pages/settings.tsx` 的设置行；
- `packages/contracts/src/activities.ts` 的 activity module 枚举；
- `packages/contracts/src/notifications.ts` 的 notification module 枚举；
- `apps/api/src/auth/capabilities.ts` 的 `Capability` 字面量联合。

不要绕过检查再添加新的手工插件登记；优先从 manifest 派生，确实不能派生时再更新守门逻辑并说明原因。

## 2. 定义 HTTP 契约和端点

在 `packages/contracts/src/<key>.ts` 使用 Zod 定义请求、参数、查询和响应 schema，并用 `defineEndpoint` 登记每个端点。随后在 `packages/contracts/src/index.ts`：

1. 导出该域契约。
2. import 该域契约对象。
3. 把它加入总 `contracts` 登记。

API controller 使用 `@ZodBody`、`@ZodQuery`、`@ZodParam` 消费同一份 schema；不要为新端点另建 class-validator DTO。controller、service、module 仍需正常实现，并在 `apps/api/src/app.module.ts` 显式引入模块。

`scripts/check-plugins.mjs` 还会扫描 `apps/api/src` 的一级目录。目录名等于 `PLUGIN_KEYS` 中的 key 时自动归属于该插件；一个插件使用额外目录时，要在脚本的 `PLUGIN_EXTRA_DIRS` 中声明归属；真正的内核目录才加入 `KERNEL_DIRS`。不要用 `KERNEL_DIRS` 绕过插件间 import 边界。

响应契约会在测试模式由 `ContractsInterceptor` 校验。请求也支持 report/enforce 校验，因此 schema 必须表达真实约束；迁移旧 DTO 时要逐条核对字段、长度、格式、枚举和可选性。

修改 `packages/*` 后先运行 `corepack pnpm build:packages`，否则 API 可能仍加载旧的 `dist`。端点有变化时重新生成并提交 `docs/api-inventory.md`。

每个 service 都要沿用现有家庭隔离方式：从可信认证上下文取得家庭身份，对查询和写入限制 `householdId`，并在访问关联实体时再次校验归属。不要信任请求体传入的家庭或成员身份。

## 3. 能力权限

manifest 的 `capabilities` 声明能力和默认角色，例如 `points` 声明 `manage_points` 并授予 owner/admin。新增能力还要加入 `apps/api/src/auth/capabilities.ts` 的 `Capability` 联合。

声明不会自动保护 HTTP 端点。受限操作必须显式使用：

- controller 的 `@RequireCapabilities(...)`；或
- service 内的 `assertCapability(...)`。

同样，`actions[].capability`、`queries[].capability`、留意 kind 的 `capability` 和 `managerOnly` 主要控制声明层或 UI 可见性，不能替代服务端鉴权。参考 `apps/api/src/points/points.controller.ts`。

## 4. 模块开关与事件路由

`module.hasData` 有三种模式：

- `{ kind: 'always' }`：始终视为有数据。
- `{ kind: 'tables', tables: [...] }`：内核按家庭查询指定表。
- `{ kind: 'server', id: 'plugin.hasData' }`：复杂逻辑由插件在服务端注册实现。

`server` 模式可参考 `smart-home.hasData` 和 `apps/api/src/smart-home/smart-home-has-data.ts`，同时登记到 `apps/api/src/system/module-has-data.registry.ts`。

成功加载本家庭的模块状态后，可见性规则是：家庭显式开启，或未显式关闭且已有数据；没有可用状态时，`visible` 默认放行。当前 Web 只在部分入口消费 `useModules().visible`，例如钉住的导航和今天页设备卡片；`App.tsx` 的页面路由和命令面板不会按它统一拦截。因此模块关闭不保证所有入口都隐藏，更不是卸载或 HTTP 端点的通用授权层。需要隐藏的入口要逐处接入并测试，服务端仍必须独立鉴权。

`events.routes` 描述哪些 HTTP 写路径会影响哪些域，`events.queryKeys` 描述 Web 收到域变更后要失效的 React Query key。无登录用户的 webhook 或公开写入口使用 `emit: 'explicit'`，由服务端显式发事件。修改这些登记后运行事件路由检查。

`scripts/check-event-routes.mjs` 只验证每个写端点有路由登记、没有死条目，并统计 `explicit`；它不会证明 `explicit` 路径的业务实现真的发布了事件。`apps/web/src/lib/plugins-registry.test.ts` 对缓存失效登记只验证 `DOMAIN_QUERY_KEYS` 与 manifest 一致，也不会扫描业务 hook 使用的全部实际 query key。两类行为都要用实现审查和跨会话刷新测试补证。

这里的 `/events` 客户端失效路由与后文的事务内钩子、提交后进程内插件事件是三套不同机制。

## 5. 查询、动作与写提案

`queries` 会派生助理读工具的名称、归属和能力要求。默认名称规则是：

```text
<plugin>.<verb> -> get_<plugin>_<verb>
```

`actions[].propose` 会派生写提案工具，默认名为 `propose_<actionType>`。写操作只生成提案，成员确认后才真正写库。顶层 `proposals` 是现有兼容字段；新插件优先把提案挂在真实的 `actions[].propose` 上。

manifest 只派生工具清单，不生成执行实现。每个工具还必须：

1. 在 `apps/api/src/agent/tools/<key>.ts` 使用 `defineTool(...)` 实现。
2. 在 `apps/api/src/agent/tools/index.ts` 显式 import 并加入 `createAgentToolRegistry`。
3. 复用 service 的权限、家庭隔离和输入校验，不另写一套业务规则。
4. 为查询结果和提案确认路径补黑盒测试。

`scripts/check-plugins.mjs` 和 agent 工具检查会核对 manifest 推导集合与实际注册表。当前主线使用共享工具注册表和 Native 助理接入；不要按旧 Hermes 中心的说明新增接入点。

## 6. 跨插件协作

插件目录之间禁止直接 import 对方的 service 或实体实现。按语义选择以下机制。

### 门面：读取或同步调用

1. 在 `packages/contracts/src/plugins/<provider>.facade.ts` 定义最小接口。
2. 把接口加入 `PluginFacades` 映射。
3. 提供方模块初始化时向 `PluginFacadeRegistry` 注册实现。
4. 消费方运行时按 key 获取门面，并在自己的 manifest `dependsOn` 声明提供方。

门面只暴露稳定的业务能力，不泄漏 repository、ORM 实体或内部 service。

### 事务内钩子：同一事务的连带写

在 contracts 登记钩子名和 payload。发起方在事务中调用 `TransactionHookRegistry.run`，订阅方在模块初始化时用 `on` 注册，并在 manifest `hooks` 中声明。订阅回调抛错会让整个事务回滚。

`points` 订阅 `tasks.completed` 和 `tasks.uncompleted` 是真实参考。事务内钩子适合“主操作不成功，连带写也不能成功”的场景。

### 提交后插件事件：已发生事实的异步通知

提供方在 manifest 的 `events.emits` 声明事件，并在事务提交后发布。订阅者失败只记录日志，不回滚已提交事务。当前可参考 `tasks.completed` 的契约和实现。

## 7. 实体、迁移、备份与导出

TypeORM 使用 `ALL_ENTITIES` 和 `ALL_MIGRATIONS`，生产配置 `migrationsRun: true`、`synchronize: false`。

在 J7.4 完成前，实体仍集中登记在 `apps/api/src/entities/index.ts`。新增表时：

1. 新建实体并加入 `ALL_ENTITIES`。
2. 生成或手写一份新的时间戳迁移。
3. 把迁移加入 `apps/api/src/database/migrations/index.ts` 的 `ALL_MIGRATIONS`。
4. 验证全新库、已有数据升级、up/down/up 和 schema drift。

迁移必须线性追加；不要修改已经存在或可能已经部署的旧迁移来“整理历史”。

完整备份由 PostgreSQL 自定义格式 dump、整个 uploads 归档、manifest 和 SHA-256 校验组成。插件数据放在同一 PostgreSQL 库、插件文件放在现有 uploads 根目录时，会被当前 dump/归档物理包含；但 manifest 没有通用的备份或恢复接入钩子，这不等于该域已经验证为可恢复。必须核对迁移、文件布局、权限和恢复后的业务读取，并把该域纳入恢复演练。若引入独立卷或外部对象存储，必须手工扩展备份、恢复脚本和恢复演练。

用户可下载的 JSON/CSV 导出同样没有通用插件接入机制，不会由 manifest 自动生成，也不能替代完整备份。需要可携带导入或导出时，分别实现契约、controller/service、权限、家庭隔离、格式安全（包括 CSV 公式注入）、兼容策略和黑盒测试。

## 8. Web 接入

manifest 为导航、命令动作、旧路径转换和事件后的 query key 失效提供声明；现有 helper 能把单个插件的声明转换成 Web 数据，但新插件仍要手工接入有序注册表，也不会生成页面或动态挂载路由。

1. 在 `apps/web/src/pages/<key>.tsx` 实现页面。
2. 在 `apps/web/src/App.tsx` 显式 import 并添加 `<Route>`。
3. 有导航分段时，在 `apps/web/src/lib/nav.ts` 的目标场景加入 `...pluginSegments('<key>')`；有命令动作时，在 `apps/web/src/lib/actions.ts` 加入 `...fromPlugin('<key>')`。manifest 本身不会完成插入。
4. 有 `legacyPaths` 时，在 `apps/web/src/lib/routes.ts` 的 `MOVED` 加入 `...legacyPaths('<key>')`，处理应用内部收到的旧 `targetPath`。浏览器直接访问旧 URL 是另一条链路，还要在 `App.tsx` 的 `REDIRECTS` 或专用 `<Route>` 中显式实现；`scripts/check-plugins.mjs` 不检查 `App.tsx` 路由覆盖。
5. 在 `apps/web/src/lib/queries/<key>.ts` 实现 React Query hooks，并按现有约定从 queries index 导出。逐项核对 hook 的 `queryKey[0]` 是否包含在 `events.queryKeys`，注册表单测不会自动发现漏项。
6. 有设置项时，在 `apps/web/src/pages/settings.tsx` 实现真实设置行，并让它与 `settingsRows` 一致。
7. 覆盖禁用、无数据、无权限、加载、错误和空状态。模块关闭时还要检查直接 URL 和命令面板，因为它们当前没有统一的可见性闸门。

`apps/web/src/lib/plugins-registry.test.ts` 会核对已接入的 manifest 派生登记，但不能证明页面 Route、业务 hook 的实际 query key 或页面流程已经可用；仍需对应的单元测试和 Web 黑盒场景。

## 9. 验证

所有命令都从仓库根目录执行。先用局部检查缩短迭代周期：

```bash
corepack pnpm build:packages
corepack pnpm typecheck
corepack pnpm api:inventory
corepack pnpm plugins:check
corepack pnpm events:check
corepack pnpm --filter web test:unit
corepack pnpm --filter api test:api -- --list
corepack pnpm --filter api test:api -- --only polls
corepack pnpm api:inventory:check
```

把 `polls` 换成 `--list` 显示的实际脚本名；脚本名不保证等于插件 key。`--only` 会跳过全新库、升级夹具和迁移演练，只适合开发迭代，不能作为提交前唯一证据。

不要把静态守门的绿色结果扩大解释：`plugins:check` 不覆盖 `App.tsx` 页面 Route；`events:check` 不验证 `emit: 'explicit'` 的发布调用；Web 注册表单测不检查业务 hook 实际使用的全部 query key。新增插件的验收证据应另外覆盖这三项。

提交前运行全量 API/Web 验收：

```bash
corepack pnpm build:packages
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm api:inventory:check
corepack pnpm events:check
corepack pnpm plugins:check
corepack pnpm --filter web test:unit
corepack pnpm --filter api test:api
corepack pnpm test:web
```

新增迁移时还应检查登记状态：

```bash
corepack pnpm --filter api migration:show
```

全量 API 测试必须覆盖全新数据库初始化、有数据的迁移夹具、up/down/up 升级演练和 schema drift。Web 黑盒还应覆盖导航入口、主要读写流程、权限差异和模块关闭后的表现。

## 当前限制

插件 manifest 已统一大部分登记，但执行代码、路由、实体和少量 key 表仍是编译期显式接入。指南描述的是当前仓库契约，不代表稳定的第三方插件 ABI。J6 的其他工作仍以 `docs/architecture.md` 当前进度表为准；完成本指南本身不表示 J6 已完成。
