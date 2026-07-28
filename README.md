# 小管家 · family-app

面向家庭成员的生活协作平台。当前已完成点菜、菜单、菜谱、购物清单和家庭库存的本地 Web 演示版，后续将扩展家庭日历、任务与投票、观影、访客和家庭资产等模块。

> 当前可用流程：家人按日期和餐次点菜 -> 掌勺的人接单开做 -> 生成购物清单 -> 管理家庭库存与补货

完整的产品边界、数据模型、MoviePilot/Plex/Emby 连接方式、访客系统、网络设备接入和实施路线见 [家庭管理平台总体方案](docs/family-platform-plan.md)。

## 当前功能

- **点菜**：按日期选择早餐、午餐或晚餐，分类与搜索菜品，填写口味备注并提交菜单。
- **日历**：支持跨月提前安排；有点菜的日期显示有效菜品数量。
- **厨房菜单**：按餐次查看点菜，接单、制作、完成或拒绝；有点菜的菜单高亮显示。
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
| API | NestJS 10、TypeORM、JWT |
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
# API 与客户端类型检查
(cd apps/api && ./node_modules/.bin/tsc --noEmit)
(cd apps/mobile && ./node_modules/.bin/tsc --noEmit)

# Expo 依赖版本检查
(cd apps/mobile && ./node_modules/.bin/expo install --check)

# Compose 配置检查（仓库根目录）
docker compose -f docker-compose.dev.yml config --quiet

# 现有 API 冒烟流程（API 已启动）
node apps/api/scripts/smoke.mjs

# 家庭数据隔离测试（API 已启动）
npx pnpm --filter api test:isolation

# 自动创建临时数据库和 API，连续运行两项测试，结束后自动清理
docker compose -f docker-compose.dev.yml run --rm --no-deps api \
  pnpm --filter api test:api
```

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
