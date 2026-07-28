# 小管家 · family-app

面向家庭成员的生活协作平台。当前已完成点菜、菜单、菜谱、购物清单和家庭库存的本地 Web 演示版，后续将扩展家庭日历、任务与投票、观影、访客和家庭资产等模块。

> 当前可用流程：家人按日期和餐次点菜 -> 指定本餐主厨或分别认领菜品 -> 生成购物清单 -> 上桌后锁定历史菜单 -> 管理家庭库存与补货

完整的产品边界、数据模型、MoviePilot/Plex/Emby 连接方式、访客系统、网络设备接入和实施路线见 [家庭管理平台总体方案](docs/family-platform-plan.md)。

## 当前功能

- **点菜**：按日期选择早餐、午餐或晚餐，分类与搜索菜品，填写口味备注并提交菜单。
- **日历**：支持跨月提前安排；有点菜的日期显示有效菜品数量。
- **厨房协作**：每餐可指定主厨，每道菜可由不同成员认领；支持制作进度、划掉原因、点菜人提醒、操作历史、恢复和完成锁定。
- **成员边界**：家庭权限使用 `owner/admin/member`，经常掌勺是可独立修改的成员偏好，不再决定厨房权限。
- **菜谱**：维护分类、难度、耗时、食材、口味、图文步骤和参考链接。
- **购物清单**：菜单食材自动合并，也可手动填写物品、数量和单位；支持勾选与删除。
- **家庭库存**：维护调料、主食、饮料、零食和日用品余量，低库存提示并一键加入采购。
- **Web 移动端模拟**：在桌面浏览器中以移动端布局完成全部常用流程，无需键盘快捷键。
- **原生基础**：Expo 项目仍可通过 Expo Go 在手机上运行。

## 规划模块

- 家庭、成员、权限、数据库迁移和备份恢复
- 统一日历、提醒、家务、投票、积分与奖励
- 家庭片单、观影投票和排期
- MoviePilot、Plex、Emby 媒体连接器
- 访客邀请、临时权限和访客 Wi-Fi
- 中兴或其他家庭网络设备连接器
- 家庭资产、维护周期和知识资料
- 按真实家庭阶段增加儿童能力，不提前建设空模块

## 技术栈

| 端 | 技术 |
| --- | --- |
| 客户端 | Expo SDK 57、React Native、Expo Router、React Query、Lucide |
| Web | Expo Web / React Native Web，响应式移动与桌面布局 |
| API | NestJS 10、TypeORM、短时 JWT 与可撤销会话 |
| 数据库 | PostgreSQL 16 |
| 本地环境 | Docker Compose + pnpm monorepo |

## 本地 Web 演示

前置环境：Docker Desktop、Node.js 20+。仓库根目录执行：

```bash
# 安装工作区依赖（首次运行或依赖变更后）
npx pnpm install

# 启动 PostgreSQL、种子任务和 API
docker compose -f docker-compose.dev.yml up --build

# 另开终端启动 Expo Web
cd apps/mobile
npx expo start --web --port 8081
```

浏览器访问：

- Web：<http://localhost:8081>
- API：<http://localhost:3100>

同一局域网的其他电脑可以将 `localhost` 换为运行项目电脑的局域网 IP。Web 客户端会根据当前页面主机名连接同一主机的 `3100` 端口。

`docker-compose.dev.yml` 中的密码和 JWT 密钥只用于本地开发，不应直接用于长期家庭部署。

API 安全相关配置：

| 环境变量 | 本地默认值 | 作用 |
| --- | --- | --- |
| `JWT_SECRET` | 仅 Docker 演示密钥 | JWT 签名；生产环境必须显式配置 |
| `JWT_EXPIRES_SECONDS` | `900` | 访问令牌有效期，默认 15 分钟 |
| `REFRESH_TOKEN_EXPIRES_SECONDS` | `2592000` | 刷新会话有效期，默认 30 天并在每次续期时轮换 |
| `LOGIN_RATE_LIMIT` | `5` | 单个来源在窗口内允许的登录次数 |
| `LOGIN_RATE_WINDOW_MS` | `60000` | 登录限流窗口，默认 1 分钟 |
| `CORS_ORIGINS` | 开发环境自动允许本机和私有局域网 | 逗号分隔的 Web 客户端来源白名单 |

原生 Expo 请求没有浏览器 `Origin`，不受 CORS 白名单影响。生产环境不配置 `CORS_ORIGINS` 时不会授权任何浏览器来源。

服务端只保存刷新令牌的 SHA-256 哈希；退出、成员角色变化或 PIN 变化会立即撤销旧会话。iOS/Android 使用 `SecureStore` 保存会话，当前 Web 演示使用 `localStorage`，因此 Web 端仍受同源脚本和 XSS 边界约束。正式外网部署必须使用 HTTPS、严格内容安全策略，并评估改为同站 `HttpOnly` Cookie 或可信反向代理会话。

停止服务：

```bash
docker compose -f docker-compose.dev.yml down
```

命名卷保存数据库和上传文件；`down` 不会删除数据。不要执行 `down -v`，除非明确要删除本地数据。

## 数据迁移与备份

数据库结构由 TypeORM 迁移管理，API 和种子任务启动时自动运行待执行迁移，不再使用 `synchronize` 修改表结构。

```bash
# 创建数据库与上传文件的完整备份
./scripts/backup-dev.sh

# 只恢复到新的演练数据库，不覆盖当前数据
./scripts/restore-dev.sh backups/<备份时间> family_app_restore_test
```

完整的文件说明、异机备份建议和恢复演练流程见 [本地开发数据备份与恢复](docs/backup-restore.md)。

## Expo Go

API 运行后，在仓库根目录执行：

```bash
npx pnpm --filter mobile start
```

手机安装 Expo Go，并与开发电脑连接同一 Wi-Fi。客户端会优先使用 `EXPO_PUBLIC_API_URL`，否则从 Expo 的 `hostUri` 推导 API 地址。

## 验证

```bash
# API、客户端和 Playwright 测试代码的类型检查
corepack pnpm typecheck

# Expo 官方规则静态检查
corepack pnpm lint

# Expo 依赖版本检查
(cd apps/mobile && ./node_modules/.bin/expo install --check)

# Compose 配置检查（仓库根目录）
docker compose -f docker-compose.dev.yml config --quiet

# 现有 API 冒烟流程（API 已启动）
node apps/api/scripts/smoke.mjs

# 家庭数据隔离测试（API 已启动）
npx pnpm --filter api test:isolation

# 检查实体元数据与已执行迁移是否一致
npx pnpm --filter api test:schema

# 自动创建临时数据库和 API，验证迁移、PIN、CORS、权限、限流、
# 家庭隔离、菜单协作、通知、审计、锁定、唯一约束和事务回滚，结束后自动清理
docker compose -f docker-compose.dev.yml run --rm --no-deps api \
  pnpm --filter api test:api

# 固定 Chrome 回归：鼠标登录、390px 移动视口、1440px 桌面视口和核心导航
# 运行前保持 API/数据库健康；测试不点菜、不改状态/偏好，也不修改库存
corepack pnpm test:web
```

Playwright 直接使用本机安装的 Google Chrome，不会额外下载浏览器。失败时的截图、录像和 trace 保存在 `apps/mobile/test-results/`，该目录不会提交到 Git。

## 项目结构

```text
apps/
├── api/
│   ├── src/auth/          # JWT 登录与全局守卫
│   ├── src/dishes/        # 菜谱、图文步骤和食材
│   ├── src/inventory/     # 家庭库存
│   ├── src/menus/         # 菜单、点菜状态和日期汇总
│   ├── src/shopping/      # 购物清单
│   ├── src/upload/        # 图片上传
│   └── src/entities/      # 当前 TypeORM 实体
└── mobile/
    ├── e2e/               # Playwright 登录与双视口 Web 回归
    ├── playwright.config.ts
    └── src/
        ├── app/           # Expo Router 页面
        ├── components/    # 应用外壳、日历、库存和通用 UI
        └── lib/           # API、查询、会话、菜篮、日期和主题

docs/
└── family-platform-plan.md # 家庭管理平台总体方案
```

## 路线图

- [x] M1：点菜本地演示版
- [ ] M2：家庭数据边界、迁移、备份、安全和自动化测试
- [ ] M3：统一日历、提醒、任务和投票
- [ ] M4：观影 MVP 与 MoviePilot/Plex/Emby 连接器
- [ ] M5：访客与家庭网络
- [ ] M6：库存采购闭环、家庭资产和积分
- [ ] M7：按真实需求扩展儿童、健康、出行等模块

详细范围与验收标准见 [总体方案的分阶段路线图](docs/family-platform-plan.md#21-分阶段路线图)。
