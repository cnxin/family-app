# 家庭管理 App「小管家」

家庭管理套装的 App 端 + API。长期蓝图见 `docs/family-platform-plan.md`。
当前已实现模块：**点菜与家庭库存**（菜谱库 -> 按日期点菜 -> 厨房菜单 -> 购物清单 -> 库存补货）。

## 结构

- `apps/api` — NestJS + TypeORM + PostgreSQL（本地 Web 演示由 `docker-compose.dev.yml` 启动）
- `apps/mobile` — Expo + expo-router，支持 Expo Go 和响应式 Web
- `docs/family-platform-plan.md` — 已确认的产品、架构、数据和分阶段实施方案

## 约定

- pnpm 通过 `npx pnpm` 调用（不在 PATH）
- **UI 开发必须遵循 `.claude/skills/` 里的 emilkowalski 技能包**：`apple-design`（设计原则）、`emil-design-eng`（动效）。enter 动画 ease-out、确认操作配 haptics、暗色模式必须支持
- API 统一响应 `{data}` / `{error:{code,message}}`
- 新增平台模块前先读总体方案，优先完成 M2 数据迁移、备份和权限基础
- Git 提交信息用中文

## 常用命令

```bash
npx pnpm api                  # API dev (localhost:3100，依赖本机 postgresql-x64-16 服务)
npx pnpm seed                 # 灌种子数据
npx pnpm mobile               # Expo dev server（Expo Go 扫码，手机和电脑同一 WiFi）
node apps/api/scripts/smoke.mjs   # 全流程冒烟（需 API 已启动）
docker compose -f docker-compose.dev.yml up --build  # 本地 PostgreSQL + API
```
