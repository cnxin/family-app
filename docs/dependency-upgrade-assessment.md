# 依赖升级评估（2026-10-23；第 3～5 步改动清单 2026-10-28）

> 只是评估，没有升级。数据来自 `npm outdated`（2026-10-23，main `2ff7efa`）。运行时：镜像与 CI 都是 Node 22，本机 Node 24，pnpm 10.34。

## 一、现状

| 依赖 | 现在 | 最新 | 落后 | 用在哪 |
| --- | --- | --- | --- | --- |
| `@nestjs/*`（common / core / platform-express / typeorm / jwt / cli） | 10.4 | 12.2 | 两个大版本 | API 全部 |
| `typeorm` | 0.3.31 | 1.1.2 | 一个大版本 | API 全部；`getRepository` 611 处、`transaction` 338 处、`createQueryBuilder` 174 处、`setLock` 81 处 |
| `typescript` | 5.9.3（api 的 package.json 写的范围是 `^5.7.2`，装到的也是 5.9.3） | 7.0.2 | 两个大版本 | 全仓库；API 黑盒靠 `ts-node/register`（`run-api-tests.mjs` 等 7 个脚本） |
| `vite` / `vitest` / `@vitejs/plugin-react` | 7.3 / 3.2 / 5.2 | 8.3 / 5.0 / 6.1 | 各一到两个大版本 | Web 构建与单测 |
| `eslint` / `@eslint/js` / `globals` | 9.39 / 9.39 / 16.5 | 10.13 / 10.0 / 17.13 | 一个大版本 | api、web lint（已是 flat config） |
| `@types/node` | api 20、web 22 | 26 | 与运行时 22 不一致 | 类型 |
| `class-validator` | 0.14.4 | 0.15.1 | 小版本 | 还没换成 Zod 的旧 DTO |
| `@types/express` / `@types/multer` | 4 / 1 | 5 / 2 | 跟随 Express 5 / multer 2 | 上传接口 |
| `dotenv` | 16 | 18 | 两个大版本 | 本地开发读 .env |
| `react` 19 / `react-router-dom` 7 / `@tanstack/react-query` 5 / `tailwindcss` 4 / `zod` 4 / `pg` 8 | 都是当前大版本 | — | — | — |

`package.json` 没有 `engines` 字段，本机 Node 24 跑测试、镜像 Node 22 跑生产，目前没出问题，但没有东西拦着别人用更低版本装。

## 二、每项的风险

1. **NestJS 10 → 12**：影响面最大。11 起 `platform-express` 换成 Express 5：路由通配符和路径正则写法变了（本仓库查过，没有带 `*`、`(`、`?` 的路由），`@Res()` 直接写响应的地方有 13 处（二进制流、内部渠道），要逐个核对 Express 5 下的行为。12 的变化还没读发布说明。`@nestjs/typeorm`、`@nestjs/jwt`、`@nestjs/throttler` 要跟着同步升。
2. **TypeORM 0.3 → 1.x**：1.0 的迁移说明还没读，不知道哪些 API 变了；本仓库用得最多的是 `getRepository` / `transaction` / `createQueryBuilder` / `setLock('pessimistic_write')`，还有大量原生 SQL（`pg_advisory_xact_lock`）。实体层刚拆完（J7.4），元数据有现成的比对脚本可以复用；迁移要走「全新库 + 已有库升级 + up/down/up + schema drift」四项验收。
3. **TypeScript 5.9 → 7**：7 是原生编译器那一代，`ts-node` 这种挂编译器 API 的工具大概率不兼容；API 黑盒、契约脚本、单测全靠 `ts-node/register` 跑，不先换掉它（比如换 `tsx` 或先编译再跑）就不能升。6.x 是过渡版本。`typescript-eslint` 也要看支持到哪。
4. **Vite 8 / Vitest 5 / plugin-react 6**：Web 侧工具链，影响构建产物和单测运行器，不影响 API；Playwright 全量能兜底。
5. **ESLint 10**：已经是 flat config，主要是规则默认值和 `globals` 变化；`max-lines` 这类规则不变。
6. **@types/node**：api 还在 20，和运行时 22 对不上，先统一到 22（不急着上 26，镜像还是 22）。
7. **class-validator 0.15**：按计划这些 DTO 最终都要换成 Zod（目前只有 polls 换完），升小版本意义不大，可以顺手。

## 三、建议顺序

每一步单独一个分支、一次合并、一次演示栈升级，验收照旧：typecheck、lint 不新增警告、`test:api` 与 `test:web` 全量、API 清单不变。

| 步 | 内容 | 风险 | 前置 |
| --- | --- | --- | --- |
| 1 | **已完成（2026-10-26，`5ee5920`）**：`@types/node` 统一 22、`dotenv` 18、`class-validator` 0.15、`eslint` 10 + `@eslint/js` 10 + `globals` 17 + `typescript-eslint` 8.72；根 `package.json` 加 `engines.node >= 22`。ESLint 10 新默认规则 `no-useless-assignment` 查出 8 处无效赋值，一并清掉 | 低 | 无 |
| 2 | **已完成（2026-10-26，`fe1e913`）**：`vite` 8（打包内核换成 rolldown）、`vitest` 5、`@vitejs/plugin-react` 6；`@tailwindcss/vite` 4.1 只支持到 Vite 7，连同 `tailwindcss` 升到 4.3.3。`vite.config` 不用改，Playwright 全量与演示栈升级后页面都正常 | 低到中 | 无；Playwright 全量兜底 |
| 3 | NestJS 10 → 11 → 12 一次做完，连同 `@nestjs/typeorm` / `jwt` / `throttler`、`@types/express` 5、`@types/multer` 2；逐个核对 13 处 `@Res()` | 中到高 | 读 11、12 发布说明；J7.3 之后做，免得和 agent 目录的拆分撞车 |
| 4 | TypeORM 1.x | 高 | 读 1.0 迁移说明；复用 J7.4 的元数据比对脚本；四项迁移验收 |
| 5 | TypeScript 7 | 高 | 先把 `ts-node/register` 换掉（7 个脚本 + `run-api-tests.mjs` 里 21 处）；可以先升到 6.x 看弃用警告 |

第 1、2 步已于 2026-10-26 做完并升到演示栈；第 3 步排在 J7.3 之后；第 4、5 步要先各出一页读完迁移说明后的具体改动清单，再定要不要做。

## 四、第 3～5 步改动清单（2026-10-28）

> 读过官方材料后逐条对照仓库写的，还没动手。版本号取自 2026-10-28 的 npm：NestJS 12.3.2 / @nestjs/cli 12.0.11 / @nestjs/typeorm 12.0.2 / @nestjs/jwt 12.0.3 / @nestjs/throttler 6.7.1、TypeORM 1.1.2、TypeScript 7.0.2（6.0.2 兼容包 `@typescript/typescript6`）、typescript-eslint 8.72.1（peer 要求 TS `<6.1`）。
> 运行时：镜像 `node:22-alpine` 实为 22.23.1，满足三者的 Node 要求（Nest 12 要 22.12+，TypeORM 1 要 22.13+）。

### 顺序要改

评估里写的是 3（Nest）→ 4（TypeORM）→ 5（TS）。读完发现 **Nest 12 的 CLI / schematics 要 TypeScript 6 作 peer**，而 TS 7 目前没有 Compiler API，ts-node、typescript-eslint、nest build 全不能用。所以拆成：

| 新顺序 | 内容 | 风险 | 备注 |
| --- | --- | --- | --- |
| 5a | TypeScript 5.9 → **6.0**（全仓库） | 低到中 | 纯配置活，先做 |
| 3 | NestJS 10 → 12（经 11），连 cli / typeorm / jwt / throttler / @types/express 5 / @types/multer 2 | 中 | 代码只改 1 行，验证量大 |
| 4 | TypeORM 0.3 → 1.1 | 中到高 | 代码改 2 处，关键在约束命名与 where 行为 |
| 5b | TypeScript → 7 | 高 | **等 7.1 出 API 且 typescript-eslint / ts-node 跟上再说**，现在做没有收益 |

原来「第 3 步排在 J7.3 之后」的理由是怕和 agent 目录拆分撞车。Nest 升级在 src 里只碰 1 个文件（见下），撞车概率可忽略，**不必再等 J7.3**。

### 5a. TypeScript 6.0（先做）

TS 6 改了默认值并弃用一批选项（`ignoreDeprecations: "6.0"` 可暂压；7.0 直接报错）。对照 10 个 tsconfig：

| 变化 | 本仓库 | 要改 |
| --- | --- | --- |
| `rootDir` 默认从「公共目录」改成 tsconfig 所在目录 | `apps/api/tsconfig.json` 没写 `rootDir`，`outDir: ./dist`，`include: ["src"]`；`Dockerfile.prod` 启动 `node dist/main.js` | **必须加 `"rootDir": "./src"`**，否则产物变成 `dist/src/main.js`，镜像起不来。packages/* 已写 `rootDir: ./src`，web 由 Vite 产出不受影响 |
| `types` 默认从「全部 @types」改成 `[]` | api 没写 `types`；用到 `process`、`Buffer`，`Express.Multer.File` 靠 @types/multer 的全局命名空间 | api 加 `"types": ["node", "multer"]`（`import 'multer'` 已有 6 处，保险起见显式列）。web 已写 `["vite/client","node"]`；agent-core 已 `[]`；contracts / shared / api-client 不用 node 类型，不动 |
| `strict` 默认 `true` | api 只开了 `strictNullChecks`，429 个文件 | 先显式写 `"strict": false` 保持现状（否则一次升级夹带几百条类型错误）；全量 strict 另立一期 |
| `baseUrl` 弃用 | api 写了 `"baseUrl": "./"`，没有 `paths` | 删掉 |
| `module` 默认 `esnext`、`target` 默认最新 | 10 个 tsconfig 都显式写了 | 不动 |
| `esModuleInterop` / `allowSyntheticDefaultImports` 不能为 false | 都是 true | 不动 |
| `moduleResolution node/node10`、`target es5`、`outFile`、`module amd/umd` | 没用 | 不动 |
| `noUncheckedSideEffectImports` 默认开 | 要看有没有纯副作用导入拼错 | typecheck 会报，照改 |

包：6 个 `package.json` 的 `typescript` 改 `^6.0.2`（web 现在是 `~5.9.3`）。工具链：typescript-eslint 8.72 支持 `<6.1` ✓；ts-node 10.9.2 对 TS 6 没有官方说明，**全量 `test:api` 会把 19 个 ts 脚本和 6 个走 ts-node 的 mjs 都跑一遍**，起不来就先用 `TS_NODE_COMPILER_OPTIONS` 或改 `tsconfig` 的 `ts-node` 段；@nestjs/cli 10 的 `nest build` 用 TS 的 API，TS 6 没删 API，预期可用，验证镜像构建即可。

验收：typecheck、lint 零新增、`test:api` + `test:web` 全量、镜像构建、`docker run … ls dist/main.js`。

### 3. NestJS 10 → 12（含 Express 5）

包：`@nestjs/{common,core,platform-express}` ^12.3、`@nestjs/cli` + `@nestjs/schematics` ^12.0（devDependencies）、`@nestjs/typeorm` ^12.0.2、`@nestjs/jwt` ^12.0.3、`@nestjs/throttler` ^6.7（已声明支持 12，顺手升小版本）、`@types/express` ^5、`@types/multer` ^2。官方 `nest upgrade --dry-run` 可先看一眼，但本仓库用 pnpm，最后还是手改 package.json。

Express 5 对照（11 的迁移指南）：

| 变化 | 仓库现状 | 要改 |
| --- | --- | --- |
| 通配符必须命名（`*` → `*splat` / `{*splat}`）、`?` 可选段、正则段不再支持 | 控制器路由里**没有** `*`、`(`、`?`、`+` | 不动 |
| 中间件 `forRoutes('*')` → `forRoutes('{*splat}')` | `src/common/clock.ts:44` 一处 | **改这一行**（11 会自动转换，但指南不建议依赖） |
| query parser 默认 `simple`，不再解析 `a[b]=` / `a[]=` 嵌套 | 54 处 `@Query` 全走 Zod，web 与 api-client 用 `URLSearchParams` 拼平铺键，契约里 query 没有数组/对象 | 不设 `extended`，顺手在契约层确认没人靠重复键传数组（`simple` 下重复键仍是数组，行为不变） |
| `@Res()` 手写响应 13 处、`response.write/end/pipe/setHeader/status` 44 处 | 用到的都是 Express 5 保留的 API；`res.redirect('back')`、`res.sendfile`、`res.send(状态码)` 一个没有 | 不改代码；黑盒要覆盖 13 个端点（事件流、地图底图、财务截图、资产/回忆/媒体附件、MCP、内部渠道） |
| `rawBody: true`、`trust proxy` | `main.ts` 已用 `NestExpressApplication`，`app.set('trust proxy', n)` | 不动 |

Nest 11 / 12 其他破坏性变更对照：

| 变化 | 仓库现状 | 要做 |
| --- | --- | --- |
| 生命周期钩子：11 把销毁顺序反转、12 改为按组件层级 | 33 个 `onModuleInit`、11 个销毁类钩子 | 查哪些 init 之间有顺序依赖（典型：注册表 → 使用者、智能家居 live 服务 → 链接轮询），全量黑盒 + 升级演练时看启动日志有无「用了还没注册的东西」 |
| 动态模块 opaque key 改用对象引用，深度相等的配置不再合并 | `JwtModule.register` 1 处、`ThrottlerModule.forRoot` 1 处，`TypeOrmModule.forFeature` 每模块各自一份本就是独立实例 | 不动 |
| `Reflector.getAllAndOverride` 返回 `T \| undefined`、`getAllAndMerge` 单对象不再包数组 | 3 处 | 按 typecheck 报错改 |
| Pipe `transform` 签名、`ArgumentMetadata` 泛型 | 自定义管道 1 个：`src/common/zod.ts` 的 `ZodValidationPipe` | 按 typecheck 报错改 |
| `@Optional()` 不再被子类重新声明的构造函数继承 | 0 处 `@Optional` | 不动 |
| `ConsoleLogger` 默认 structuredParams；11 的 `json: true` | 自己的 `StructuredLogger`（`src/common/observability.ts`，实现 LoggerService） | 不动；但升级后比对一条启动日志，确认 `{"level":…}` 格式没变（运维检查靠它 grep） |
| 12 的包改成 ESM，CommonJS 靠 `require(esm)` | api 是 CommonJS，Node 22.23 原生支持 `require(esm)` | 不动；**ts-node 跑的 19 个脚本会间接 require Nest 的 ESM 包**，这是最可能出问题的点，`test:api` 全量能暴露 |
| `@nestjs/config` Standard Schema、Terminus、CacheModule、GraphQL、NATS、Jest | 一个都没用 | 不动 |
| `@Body/@Query/@Param({ schema })` + `StandardSchemaValidationPipe`（12 新增，非破坏） | 现在是自己的 `ZodValidationPipe` + `ZodParam` 等 | 不在升级里改；可记成后续简化项 |
| `class-transformer` `plainToClass` 弃用 | 旧 DTO 走 class-validator | grep 一下，有就换 `plainToInstance` |

验收：typecheck、lint、`api-inventory --check`（340 条路由的方法/路径/权限不变）、`test:api` 全量（含 13 个 `@Res` 端点与事件流 `hello`/`heartbeat`）、`test:web` 全量、镜像构建、演示栈升级后按 deploy-c2 §4 走一遍并多看启动日志的 WARN。

### 4. TypeORM 0.3.31 → 1.1.2

前置：Nest 已在 12（`@nestjs/typeorm` ≥ 11.0.1 才不在启动时崩）。官方 `npx @typeorm/codemod v1 src/ --dry` 能自动改大部分，本次评估时自动模式没放行外部代码，**由 King 跑一次 dry 看它的 TODO 列表**。

| 变化 | 仓库现状（grep） | 要做 |
| --- | --- | --- |
| 全局 `createConnection/getConnection/getRepository`、`@EntityRepository`、`getCustomRepository`、`findByIds`、`findOneById`、`exist()`、无参 `findOne()` 全部移除 | **0 处**（611 处 `getRepository` 全是 `manager.`/`dataSource.` 上的实例方法，不受影响） | 不动 |
| `.connection` → `.dataSource`（保留弃用 getter） | 1 处：`smart-home-merge.service.ts:165` 的 `manager.connection` | 改 `manager.dataSource`（不改也能跑） |
| QueryBuilder 删 `onConflict()`，改 `orIgnore()` / 数组形式 `orUpdate()` | **1 处：`src/finance/finance-merchant-rules.ts:17`** | **必改**，这是本步唯一会编译失败的代码 |
| 删 `printSql`、`setNativeParameters`、`WhereExpression`、`replacePropertyNames`、字符串形式 `select`/`relations`、find 选项 `join` | 0 处（`smart-home-controls.ts:179` 的 `select: ['select_option']` 是 HA 的字段名，不是 find 选项） | 不动 |
| 锁模式删 `pessimistic_partial_write` / `pessimistic_write_or_fail` | 81 处 `setLock` 全是 `pessimistic_write` | 不动 |
| **`invalidWhereValuesBehavior` 默认 `throw`**：where 里出现 `null`/`undefined` 直接报错（只影响 find 系列和 `setFindOptions`，不影响 `.where()`） | 37 处 `where: { householdId, id, … }` 简写，参数基本是必填 id；但「可选过滤条件直接塞 where」的写法要逐个核对 | 先在 `DataSourceOptions` 设 `invalidWhereValuesBehavior: 'ignore'` 保持旧行为上线，再另开一笔把它改回 `throw` 并跑全量，把真会传 `undefined` 的地方改成按条件拼 where 或 `IsNull()`。两步走，别把语义变化和版本升级混在一次发布里 |
| **自动命名的约束/索引哈希算法变了**（不再先 URI 编码），想保持名字不变要用 `@typeorm/legacy-naming-strategies` 的 `NamingStrategyV03` | 迁移里有 9 个 `FK_<哈希>` 自动名；`scripts/check-schema-drift.ts` 用 `createSchemaBuilder().log()` 比对，**名字一变就会生成一堆 drop/create 约束** | 装 `@typeorm/legacy-naming-strategies`，`DataSourceOptions.namingStrategy = new NamingStrategyV03()`；用 `test:schema` 验证零漂移。不想背这个包，就写一个「重命名 9 个约束」的迁移并接受新算法——二选一，建议前者 |
| `nullable: false` 的 `ManyToOne` / 拥有方 `OneToOne` 改 INNER JOIN | 实体里没有显式 `nullable: false` 的关系 | 不动；FK 都在库里，不会有脏行 |
| `OneToMany` 的 cascade remove 开始生效；`orphanedRowAction: 'nullify'` 遇非空 FK 改成删子行 | 1 处：`entities/recipes.ts:108` `DishIngredient` `cascade: true, eager: true` | 替换菜的用料时孤儿行会被删（以前要靠显式删）；黑盒已覆盖菜谱编辑，升级时盯 `dish_ingredients` 行数 |
| 迁移：`getPendingMigrations` 不再建表、`loadedTables` → `getTables()`、`getAllMigrations` 删 | 0 处 | 不动；`typeorm-ts-node-commonjs` bin 仍在 |
| Postgres：枚举改走 `ALTER TYPE … ADD VALUE`；`timestamptz` 持久化/水合修复；查询串行执行 | 迁移生成会和以前不一样；时间列很多 | 四项迁移验收照旧（全新库 / 已有库升级 / up→down→up / schema drift），再跑一遍 J7.4 的实体元数据比对脚本 |
| Node 20.19+ / pg ^8.5.1 / 最低编译目标 ES2023 | Node 22.23、pg 8.13、api target ES2021 | **target 要升到 ES2023**（TypeORM 1 的 d.ts 用了 ES2023 语法时 typecheck 会报），顺手做 |

验收：上表最后两行 + `test:api` 全量 + 19 处 `pg_advisory_xact_lock` 原生 SQL 所在的流程（库存、积分、备份）黑盒必过 + 升级演练比 112 张表行数。

### 5b. TypeScript 7（暂缓）

7.0 是 Go 版，**不带 Compiler API（7.1 才有）**，并把 6.0 弃用项全部变硬错误。本仓库靠 API 的东西：ts-node（19 个脚本 + `run-api-tests.mjs` 等 6 个 mjs）、typescript-eslint（peer `<6.1`）、`nest build`。现有的绕法是装 `@typescript/typescript6` 给工具用、TS 7 只做 `tsc --noEmit`——等于还是 6，只多一个更快的类型检查，收益不值得多一份版本。

等到可以做时，换掉 ts-node 的方案按优先级：① Node 22 自带类型剥离（`--experimental-strip-types`）不支持装饰器元数据，api 脚本 import 的 `src/entities`、`database.options` 都带装饰器，**不可用**；② `@swc-node/register`：文档只说是 transpile-only 的 ts-node 替代，是否读 `emitDecoratorMetadata` 文档未写，要实测；③ 最稳：加 `tsconfig.scripts.json` 把 `scripts/*.ts` 和 `src` 一起 `tsc` 编到 `dist-scripts/`，`run-api-tests.mjs` 改成先编再 `node` 跑，不再需要任何运行时编译器。建议直接走 ③，它和 TS 版本无关，可以先做。

### 建议

1. 现在就做 **5a（TS 6）**：半天，纯配置。
2. 接着做 **3（Nest 12）**：代码 1 行 + 类型若干，重点是黑盒和 13 个 `@Res` 端点。
3. 然后 **4（TypeORM 1.1）**：代码 2 处 + `NamingStrategyV03` + `invalidWhereValuesBehavior: 'ignore'`，四项迁移验收；之后单独一笔改回 `throw`。
4. **5b 不做**，等 TS 7.1 + typescript-eslint 支持；ts-node 替换（方案 ③）可以在任何时候单独做。

每步一个分支、一次合并、一次演示栈升级，改动清单在动手前再按当天的 npm 版本核一遍。

参考：[NestJS v11 迁移指南](https://docs.nestjs.com/v11/migration-guide)、[NestJS v11 → v12 迁移指南](https://docs.nestjs.com/migration-guide)、[NestJS v12.0.0 Release](https://github.com/nestjs/nest/releases/tag/v12.0.0)、[TypeORM 0.3 → 1.0 升级指南](https://typeorm.io/docs/releases/1.0/upgrading-from-0.3/)、[TypeORM 1.0 Release Notes](https://typeorm.io/docs/releases/1.0/release-notes/)、[Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)、[Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)。
