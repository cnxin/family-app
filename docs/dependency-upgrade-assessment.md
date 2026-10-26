# 依赖升级评估（2026-10-23）

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
