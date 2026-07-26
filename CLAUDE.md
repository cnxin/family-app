# 家庭管理 App「小管家」

家庭管理套装的 App 端 + API。长期蓝图见 `C:\Users\42008\.claude\plan\family-manager-design.md`。
当前已实现模块：**点菜**（菜谱库 → 点菜 → 今日菜单 → 购物清单）。

## 结构

- `apps/api` — NestJS + TypeORM + PostgreSQL（本机 PostgreSQL 16 服务，端口 5432，库 `family_app`，账号 family；docker-compose.yml 留作将来部署家庭小主机用）
- `apps/mobile` — Expo + expo-router，iOS 风格

## 约定

- pnpm 通过 `npx pnpm` 调用（不在 PATH）
- **UI 开发必须遵循 `.claude/skills/` 里的 emilkowalski 技能包**：`apple-design`（设计原则）、`emil-design-eng`（动效）。enter 动画 ease-out、确认操作配 haptics、暗色模式必须支持
- API 统一响应 `{data}` / `{error:{code,message}}`
- 积分/作业/故事馆等后续模块加入时，先读蓝图文档再动工
- Git 提交信息用中文

## 常用命令

```bash
npx pnpm api                  # API dev (localhost:3100，依赖本机 postgresql-x64-16 服务)
npx pnpm seed                 # 灌种子数据
npx pnpm mobile               # Expo dev server（Expo Go 扫码，手机和电脑同一 WiFi）
node apps/api/scripts/smoke.mjs   # 全流程冒烟（需 API 已启动）
```
