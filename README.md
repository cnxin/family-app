# 小管家 · family-app

家庭管理 App。用娱乐需求驱动家庭协作，长期目标是作业管理、积分商城、AI 故事馆等模块（蓝图见私有计划文档），当前已实现第一个模块：**点菜**。

> 家人从菜谱库点菜 → 掌勺的人接单开做 → 购物清单按食材自动合并 → 买菜勾选

## 技术栈

| 端 | 技术 |
|---|---|
| 手机 App | Expo SDK 57 / React Native + expo-router，iOS 风格（明暗双主题、SF Symbols、原生 formSheet、弹簧动效 + haptics） |
| API | NestJS 10 + TypeORM + PostgreSQL 16，JWT 选人登录（可选 PIN） |
| 工程 | pnpm monorepo（`apps/api` + `apps/mobile`），UI 品味约束来自 [emilkowalski/skills](https://github.com/emilkowalski/skills)（`.claude/skills/`） |

## 功能一览

- **点菜**：分类/搜索过滤的菜品卡片网格，点开原生底部抽屉看食材、写口味备注（"少辣"），加入菜篮后一次提交到某天的午餐/晚餐
- **今日菜单**（掌勺视角）：看谁点了什么，接单 → 开做 → 上桌 的状态流转，不想做的可以划掉
- **购物清单**：按已接单的菜自动汇总食材，同食材数量合并，葱姜蒜等常备调料自动过滤；按分类分组勾选，支持手动加项；重新生成时保留勾选状态
- **菜谱管理**：增改菜品（拍照/相册上传、难度、耗时、食材表），下架不删数据

## 快速开始

前置：Node 20+、本机 PostgreSQL（或用根目录 `docker-compose.yml` 起一个）。pnpm 不在 PATH 时用 `npx pnpm`。

```bash
npx pnpm install

# 1. 准备数据库：建一个空库和账号（示例）
#    CREATE ROLE family LOGIN PASSWORD '...';
#    CREATE DATABASE family_app OWNER family;

# 2. 配置 API
cp apps/api/.env.example apps/api/.env   # 填数据库密码和 JWT_SECRET

# 3. 建表 + 种子数据（2 个成员 + 40 种食材 + 16 道家常菜）
npx pnpm seed

# 4. 启动
npx pnpm api      # API → http://localhost:3100
npx pnpm mobile   # Expo dev server（另开一个终端）
```

手机装 [Expo Go](https://expo.dev/go)，和电脑连**同一个 WiFi**，扫终端里的二维码即可。App 会自动从 Expo 的 hostUri 推导出电脑的局域网 IP 去连 API，无需手动配地址。

## 测试

```bash
# 全流程冒烟（需 API 已启动）：点菜 → 接单 → 清单合并/过滤 → 勾选保留
node apps/api/scripts/smoke.mjs

# 类型检查
cd apps/api && npx tsc --noEmit
cd apps/mobile && npx tsc --noEmit
```

## 项目结构

```
apps/
├── api/
│   ├── src/entities/        # 7 张表：成员/食材/菜品/菜品食材/菜单/菜单项/购物项
│   ├── src/auth/            # 选人 + PIN 登录，JWT 全局守卫
│   ├── src/dishes|menus|shopping|upload/   # 业务模块（controller+service+module 单文件）
│   ├── src/seed.ts          # 种子数据
│   └── scripts/smoke.mjs    # 冒烟测试
└── mobile/
    └── src/
        ├── app/             # expo-router：login / (tabs)四页 / dish/[id] 抽屉 / dish-edit 弹窗
        ├── components/ui.tsx # PressableScale/Segmented/Card 等 iOS 风格组件
        └── lib/             # api client / react-query hooks / 会话 / 菜篮 / 主题 tokens
```

## 路线图

- [x] M1 点菜模块（本仓库当前状态）
- [ ] M2 成员管理界面、体验打磨
- [ ] M3 积分系统（谁做饭谁得分）
- [ ] M4+ 作业管理、AI 故事馆（等娃出生 😄）
