# macmini 上 codex 执行 A7.2b 的完整指令

## 前置条件

1. macmini 已配置 codex（Google Gemini 2.0 Flash Thinking Experimental 01-21）
2. 仓库路径：`~/projects/family-app`（或你实际的路径）
3. 已安装 Node.js、pnpm、Expo CLI
4. 已配置 PostgreSQL 16 本地服务
5. 环境变量已设置（`.env` 文件包含数据库连接和 API 地址）

## 执行步骤

### Step 1: 切换到 uitest 分支并拉取最新代码

```bash
cd ~/projects/family-app
git fetch origin
git checkout uitest
git pull origin uitest
```

确认当前 HEAD 是 `c862b22` 或更新：

```bash
git log --oneline -3
# 应该看到：
# c862b22 docs: A7.2b 移动端记忆管理页执行指令
# d30fc3b docs: 记录 A7.2 落地结果与正文 CHECK 勘误
# 682aa90 feat: 实现受控长期记忆后端
```

### Step 2: 启动 API 服务（后台运行）

```bash
# 确保 PostgreSQL 服务已启动
# macOS 用 brew services:
brew services list | grep postgresql
# 如果未启动：brew services start postgresql@16

# 启动 API（本地开发模式）
npx pnpm api
```

等待看到 `Application is running on: http://localhost:3100` 后，**保持该终端运行**，新开一个终端继续。

### Step 3: 验证后端 A7.2 端点可用

在新终端执行（不要关闭 API 终端）：

```bash
# 测试 GET /agent/memories
curl -X GET http://localhost:3100/agent/memories \
  -H "Authorization: Bearer YOUR_TEST_TOKEN" \
  -H "Content-Type: application/json"

# 应该返回 200 和空数组 [] 或已有记忆列表
# 如果返回 401，说明需要先登录获取 token
```

如果需要 token，先通过 Expo Go 登录一次，或用以下方式获取测试 token：

```bash
# 方法 1: 从种子数据获取已有用户的 session
npx pnpm seed  # 会创建测试用户
# 查看 apps/api/src/seed.ts 里的测试用户 email/password

# 方法 2: 临时跳过认证（仅开发环境）
# 修改 apps/api/src/auth/auth.guard.ts 在开发模式下返回 mock user
```

**重要**：codex 在实施 A7.2b 时**不需要修改 API 代码**，只确认端点可访问即可。

### Step 4: 读取 A7.2b 执行指令

```bash
cat docs/m7-a72b-mobile-memory-ui-instruction.md
```

该文档包含 7 个任务的完整规格，codex 需要：
1. **通读全文**（13460 字节，约 180 行）
2. **理解已决策事项**（§"已决策事项"部分，9 条约束）
3. **理解背景事实**（§"背景事实"部分，9 条现有模式）
4. **按任务 1-7 顺序执行**

### Step 5: codex 开始实施

在 family-app 根目录下，让 codex 执行：

```bash
# codex 提示词（复制给 codex）：
"""
请读取 docs/m7-a72b-mobile-memory-ui-instruction.md，按任务 1-7 顺序实施移动端记忆管理页。

关键约束：
1. 不要修改 apps/api/ 下的任何文件
2. 不要修改或新建迁移文件
3. 所有代码在 apps/mobile/src/ 下
4. 提交信息用中文
5. 每个任务完成后报告改动文件清单

开始前先读取以下文件了解现有模式：
- apps/mobile/src/lib/queries.ts（现有 hook 模式）
- apps/mobile/src/lib/types.ts（现有类型）
- apps/mobile/src/components/ui.tsx（UI 组件库）
- apps/mobile/src/lib/theme.ts（主题系统）
- apps/mobile/src/app/(tabs)/profile.tsx（导航入口参考）
- apps/mobile/src/app/(tabs)/assistant.tsx（对话页参考）

按顺序执行任务 1-7，每个任务完成后用 git commit 提交。
"""
```

### Step 6: codex 执行检查点

codex 在每个任务完成后应该执行：

```bash
# 类型检查
npx pnpm typecheck

# 查看改动
git status
git diff

# 提交（任务 1 示例）
git add apps/mobile/src/lib/queries.ts apps/mobile/src/lib/types.ts
git commit -m "feat: 新增智能体记忆查询 hooks 和类型定义

- 新增 7 个查询 hook（useAgentMemories / useCreateAgentMemoryCandidate 等）
- 新增 AgentMemoryItem / AgentMemoryScope 等类型定义
- 查询 key 统一用 ['agent', 'memories', params]
- 写操作成功后自动 invalidate 缓存"
```

**每个任务的预期提交**：

| 任务 | 改动文件 | 提交信息前缀 |
|-----|---------|------------|
| 1-2 | `lib/queries.ts`, `lib/types.ts` | `feat: 新增智能体记忆查询 hooks 和类型定义` |
| 3 | `app/(tabs)/agent-memory.tsx` | `feat: 新增记忆管理列表页` |
| 4 | `app/(tabs)/agent-memory/[id].tsx` | `feat: 新增记忆详情页与操作菜单` |
| 5 | `app/(tabs)/profile.tsx` | `feat: 在个人页面添加记忆管理入口` |
| 6 | `app/(tabs)/agent-memory.tsx`（追加） | `feat: 记忆页面联动功能开关状态` |
| 7 | 多个文件（补充无障碍标注） | `a11y: 完善记忆管理页无障碍支持` |

### Step 7: 验收测试

所有任务完成后，codex 执行：

```bash
# 1. 类型检查
npx pnpm typecheck
# 预期输出：无错误

# 2. 启动 Expo 开发服务器
npx pnpm mobile
```

然后在 macmini 本机（或通过 VNC）：
1. 用 iPhone 打开 Expo Go，扫码加载
2. 执行指令文档 §"验收" 里的 9 项手动测试
3. 切换暗色模式，验证颜色正确
4. 打开 VoiceOver（iOS）或 TalkBack（Android），验证可导航

### Step 8: 提交到 uitest 分支

所有测试通过后：

```bash
# 推送到远端
git push origin uitest

# 查看提交记录
git log --oneline uitest ^origin/main
# 应该看到 A7.2b 的 3-5 个新提交
```

---

## codex 特别注意事项

### 关于 Gemini 2.0 Flash Thinking 的已知限制

1. **不要用 `--codex-model` 参数**（会导致崩溃），让它用默认配置
2. **必须先 `source .env`**（Gemini API key）
3. **必须在 VSCode 里 trust workspace**（否则读不到项目文件）

### 关于四个需自行判断的细节

指令文档里有 4 个地方未完全指定，codex 需要自己决定：

1. **候选记忆排序**：建议「候选整组在前 + 内部按时间 + 普通记忆在后按时间」
2. **sourceConversationId 跳转**：如果 `assistant.tsx` 不支持 deep link，先做成普通文本（不跳转）
3. **修改内容字数限制**：前端 TextInput 加 500 字符上限，超出时提示
4. **expiresAt 显示**：`null` 显示「永久有效」，有值显示「有效期至 X 月 X 日」

这些决定不需要问人类，codex 直接按上述建议实施即可。

### 关于可能遇到的问题

**问题 1**：`npx pnpm typecheck` 报错 `Cannot find module 'lucide-react-native'`
- **解决**：`npx pnpm install`（重新安装依赖）

**问题 2**：Expo Go 连接不上 API（返回 Network Error）
- **解决**：确保 iPhone 和 macmini 在同一 WiFi，API 地址用 macmini 的局域网 IP（如 `http://192.168.1.100:3100`），而非 `localhost`

**问题 3**：`GET /agent/memories` 返回 401 Unauthorized
- **解决**：先通过 Expo Go 登录一次（进入任意需要认证的页面），或临时修改 `auth.guard.ts` 在开发模式下跳过认证

**问题 4**：修改后 Expo 页面空白/报错 `undefined is not an object`
- **解决**：检查 `useAgentMemories()` 的返回值是否正确处理 loading/error 状态，列表渲染前加 `?.` 可选链

---

## 完成后的报告格式

codex 完成后应报告：

```
A7.2b 移动端记忆管理页已完成。

改动文件清单：
- apps/mobile/src/lib/queries.ts（新增 7 个 hook）
- apps/mobile/src/lib/types.ts（新增 6 个类型）
- apps/mobile/src/app/(tabs)/agent-memory.tsx（列表页，327 行）
- apps/mobile/src/app/(tabs)/agent-memory/[id].tsx（详情页，418 行）
- apps/mobile/src/app/(tabs)/profile.tsx（+18 行导航入口）

提交记录：
- abc1234 feat: 新增智能体记忆查询 hooks 和类型定义
- def5678 feat: 新增记忆管理列表页
- ghi9012 feat: 新增记忆详情页与操作菜单
- jkl3456 feat: 在个人页面添加记忆管理入口
- mno7890 a11y: 完善记忆管理页无障碍支持

typecheck 输出：✓ 无错误

手动测试：9 项全部通过（见附录）

文档分歧：
1. sourceConversationId 跳转：当前 assistant.tsx 不支持 conversationId 参数，
   已实现为普通文本（不可点击），待后续 assistant 页面支持 deep link 后再改。
2. （其他发现的分歧...）
```

---

## 给操作 macmini 的人类的说明

1. SSH 到 macmini：`ssh user@macmini-ip`
2. 进入项目目录：`cd ~/projects/family-app`
3. 确认 uitest 分支最新：`git checkout uitest && git pull`
4. 启动 API（新终端）：`npx pnpm api`
5. 启动 codex（新终端）：粘贴上面 Step 5 的提示词
6. 等待 codex 完成（预计 15-30 分钟，取决于 Gemini API 速度）
7. 验收：启动 `npx pnpm mobile`，iPhone 扫码测试
8. 确认无误后：`git push origin uitest`

如果 codex 中途卡住或报错，复制错误信息回来，我可以提供针对性指令。
