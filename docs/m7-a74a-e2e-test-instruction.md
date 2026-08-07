# A7.4-A 端到端测试指令

仓库 https://github.com/cnxin/family-app，分支 uitest。
A7.4-A 后端已完成（5623004），8 个只读工具已注册。

**本批只做端到端测试，不修改代码。**
通过移动端对话真实触发 8 个工具，验证完整链路：
对话输入 → Agent 工具选择 → MCP 调用 → handler 执行 → 卡片渲染 → 移动端显示

## 测试目标

验证以下链路的每个环节：
1. 用户自然语言输入能被 Agent 正确理解并选择工具
2. 工具参数从对话上下文正确提取
3. Handler 执行返回预期结果
4. `resultPresentation` 生成正确的卡片结构
5. 移动端正确渲染卡片（标题/列表项/footer）
6. 错误情况有友好降级（如天气 API 未配置）

## 前置准备

### 1. 确保 API 和移动端都在运行

```bash
cd ~/projects/family-app
git checkout uitest
git pull origin uitest

# 终端 1：启动 API
npx pnpm api

# 终端 2：启动移动端
npx pnpm mobile
```

### 2. 用 Expo Go 扫码登录测试账号

确保登录的是**管理员账号**（能看到「小管家设置」）。

如果是种子数据的账号，先执行：
```bash
npx pnpm seed  # 重新灌种子数据
```

### 3. 启用新增的 8 个工具

在移动端：
1. 进入「小管家」tab
2. 点击右上角「设置」（齿轮图标）
3. 滚动到「可用工具」section
4. 确保以下工具**全部勾选**：
   - ✅ get_member_tasks
   - ✅ get_family_schedule
   - ✅ get_inventory_summary
   - ✅ get_shopping_list
   - ✅ search_recipes
   - ✅ get_dish_plan
   - ✅ get_weather
   - ✅ get_member_profile
5. 返回对话页

如果设置页没有显示新工具，说明现有家庭的 `agent_settings` 没有包含它们。
临时解决方案：直接在数据库更新：

```bash
# 连接到本地 PostgreSQL
psql -U postgres -d family_app

-- 查看当前配置
SELECT id, "readToolsEnabled" FROM agent_settings;

-- 追加新工具到现有家庭
UPDATE agent_settings
SET "readToolsEnabled" = array_cat(
  "readToolsEnabled",
  ARRAY[
    'get_member_tasks',
    'get_family_schedule', 
    'get_inventory_summary',
    'search_recipes',
    'get_dish_plan',
    'get_weather',
    'get_member_profile'
  ]::text[]
)
WHERE id = (SELECT id FROM agent_settings LIMIT 1);

-- 验证
SELECT id, "readToolsEnabled" FROM agent_settings;
-- 应该看到 15 个工具（8个老的 + 7个新的）

\q
```

### 4. 准备测试数据

确保数据库有足够数据供工具查询：

```bash
# 如果种子数据不够丰富，手动添加：
psql -U postgres -d family_app

-- 添加几个任务
INSERT INTO tasks (id, household_id, title, status, "assignedToMemberId", "dueAt", priority, "createdAt", "updatedAt")
VALUES 
  (gen_random_uuid(), (SELECT id FROM households LIMIT 1), '买菜', 'pending', (SELECT id FROM members LIMIT 1), CURRENT_DATE + 1, 'medium', NOW(), NOW()),
  (gen_random_uuid(), (SELECT id FROM households LIMIT 1), '交电费', 'pending', (SELECT id FROM members LIMIT 1), CURRENT_DATE + 3, 'high', NOW(), NOW()),
  (gen_random_uuid(), (SELECT id FROM households LIMIT 1), '整理衣柜', 'completed', (SELECT id FROM members LIMIT 1), CURRENT_DATE - 1, 'low', NOW(), NOW());

-- 添加几个日程
INSERT INTO family_events (id, household_id, title, "eventDate", "eventType", participants, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), (SELECT id FROM households LIMIT 1), '家庭聚餐', CURRENT_DATE + 2, 'meal', '[]'::jsonb, NOW(), NOW()),
  (gen_random_uuid(), (SELECT id FROM households LIMIT 1), '看电影', CURRENT_DATE + 5, 'entertainment', '[]'::jsonb, NOW(), NOW());

-- 添加几个临期库存
INSERT INTO inventory_items (id, household_id, name, quantity, unit, "minQuantity", "expiresAt", category, location, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), (SELECT id FROM households LIMIT 1), '牛奶', 2, '瓶', 5, CURRENT_DATE + 3, 'dairy', '冰箱', NOW(), NOW()),
  (gen_random_uuid(), (SELECT id FROM households LIMIT 1), '鸡蛋', 3, '个', 10, CURRENT_DATE + 5, 'protein', '冰箱', NOW(), NOW());

-- 添加几个购物清单项
INSERT INTO shopping_list_items (id, household_id, name, quantity, unit, status, "addedByMemberId", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), (SELECT id FROM households LIMIT 1), '西红柿', 500, 'g', 'pending', (SELECT id FROM members LIMIT 1), NOW(), NOW()),
  (gen_random_uuid(), (SELECT id FROM households LIMIT 1), '大米', 5, 'kg', 'pending', (SELECT id FROM members LIMIT 1), NOW(), NOW());

\q
```

## 测试场景（8 个）

每个场景包含：
- **输入**：用户发送的对话消息
- **预期工具**：Agent 应选择的工具名
- **预期卡片**：卡片的 title / items 数量 / footer
- **截图要求**：移动端截图，显示完整对话 + 卡片

### 场景 1：查询任务

**输入**：
```
查看我的待办任务
```

**预期工具**：`get_member_tasks`

**预期卡片**：
- Title: `待办任务（N 个）`（N 取决于数据）
- Items: 每个任务一行，格式 `○ 任务标题 · YYYY-MM-DD`
- Footer: 若无任务显示「暂无任务」

**验收**：
- [ ] Agent 回复包含卡片
- [ ] 卡片显示任务列表
- [ ] 点击任务无跳转（只读）
- [ ] 截图保存到 `test-screenshots/01-tasks.png`

---

### 场景 2：查询日程

**输入**：
```
这周家里有什么安排
```

**预期工具**：`get_family_schedule`

**预期卡片**：
- Title: `家庭日程（N 个）`
- Items: 每个日程一行，格式 `标题 · M月D日 周X`
- Footer: 若无日程显示「暂无日程」

**验收**：
- [ ] Agent 回复包含卡片
- [ ] 卡片显示未来 7 天的日程
- [ ] 截图保存到 `test-screenshots/02-schedule.png`

---

### 场景 3：查询库存

**输入**：
```
家里还有哪些菜快过期了
```

**预期工具**：`get_inventory_summary`

**预期卡片**：
- Title: `库存摘要（N 项）`
- Items: 每个库存一行，格式 `名称 · 数量 单位 · YYYY-MM-DD到期`
- Footer: 若无临期商品显示「无缺货或临期商品」

**验收**：
- [ ] Agent 回复包含卡片
- [ ] 卡片显示临期库存（7 天内到期）
- [ ] 截图保存到 `test-screenshots/03-inventory.png`

---

### 场景 4：查询购物清单

**输入**：
```
购物清单里有什么
```

**预期工具**：`get_shopping_list`

**预期卡片**：
- Title: `购物清单（N 项待购）`
- Items: 每个商品一行，格式 `名称 · 数量 单位`
- Footer: 若清单为空显示「清单为空」

**验收**：
- [ ] Agent 回复包含卡片
- [ ] 卡片显示待购商品
- [ ] 截图保存到 `test-screenshots/04-shopping.png`

---

### 场景 5：搜索菜谱

**输入**：
```
搜索不辣的家常菜
```

**预期工具**：`search_recipes`

**预期卡片**：
- Title: `菜谱搜索（N 个结果）`
- Items: 每个菜谱一行，格式 `菜名 · 时长 · 难度 · 标签`
- Footer: 若无结果显示「未找到匹配菜谱」

**验收**：
- [ ] Agent 回复包含卡片
- [ ] 卡片显示菜谱列表
- [ ] 验证过滤掉辣味菜谱（如果有标签）
- [ ] 截图保存到 `test-screenshots/05-recipes.png`

---

### 场景 6：查询点菜计划

**输入**：
```
下周点了什么菜
```

**预期工具**：`get_dish_plan`

**预期卡片**：
- Title: `点菜计划（N 餐）`
- Items: 每餐一行，格式 `菜名 · M月D日 午餐/晚餐`
- Footer: 若无计划显示「未安排点菜」

**验收**：
- [ ] Agent 回复包含卡片
- [ ] 卡片显示未来 7 天的点菜计划
- [ ] 截图保存到 `test-screenshots/06-dish-plan.png`

---

### 场景 7：查询天气

**输入**：
```
深圳这几天天气怎么样
```

**预期工具**：`get_weather`

**预期卡片**（若 API key 已配置）：
- Title: `深圳 天气预报`
- Items: 每天一行，格式 `M月D日 周X · 温度°C · 描述`
- Footer: 无

**预期卡片**（若 API key 未配置）：
- Title: `深圳 天气预报`
- Items: 空
- Footer: `天气服务暂时不可用`

**验收**：
- [ ] Agent 回复包含卡片
- [ ] 未配置 key 时显示友好错误
- [ ] 已配置 key 时显示 3-5 天预报
- [ ] 截图保存到 `test-screenshots/07-weather.png`

**配置 API key（可选）**：
```bash
# 在 .env 添加
echo "OPENWEATHER_API_KEY=your_key_here" >> apps/api/.env

# 重启 API
# Ctrl+C 终端 1，然后重新 npx pnpm api
```

注册地址：https://openweathermap.org/api（免费层 1000 次/天）

---

### 场景 8：查询成员档案

**输入**：
```
我的个人档案
```

**预期工具**：`get_member_profile`

**预期卡片**：
- Title: 成员姓名
- Items: 
  - `角色 · 管理员/成员`
  - `记忆功能 · 已启用/未启用`
  - `回复风格 · 默认/简洁/详细`
- Footer: 无

**验收**：
- [ ] Agent 回复包含卡片
- [ ] 卡片显示当前登录成员的信息
- [ ] 截图保存到 `test-screenshots/08-profile.png`

---

## 额外测试：工具组合

### 场景 9：多工具联动

**输入**：
```
我明天有什么安排，需要准备什么食材
```

**预期行为**：
- Agent 先调用 `get_family_schedule`（查明天日程）
- 再调用 `get_dish_plan`（查明天的点菜计划）
- 可能调用 `get_inventory_summary`（查现有库存）
- 最后调用 `get_shopping_list`（查需要采购的食材）

**验收**：
- [ ] Agent 回复包含 2-4 个卡片
- [ ] 卡片顺序合理
- [ ] Agent 的文字回复综合了多个工具的结果
- [ ] 截图保存到 `test-screenshots/09-multi-tool.png`

---

## 测试执行步骤

### 1. 创建截图目录

```bash
cd ~/projects/family-app
mkdir -p test-screenshots
```

### 2. 逐个执行 9 个测试场景

在移动端（Expo Go）：
1. 进入「小管家」tab
2. 输入场景的「输入」文字
3. 发送消息
4. 等待 Agent 回复（带卡片）
5. 截图（iOS: 音量+ + 电源键，Android: 音量- + 电源键）
6. 将截图重命名并保存到 `test-screenshots/`

### 3. 记录测试结果

创建测试报告文件：

```bash
cat > test-screenshots/TEST-REPORT.md << 'EOF'
# A7.4-A 端到端测试报告

测试时间：YYYY-MM-DD HH:MM
测试设备：iPhone / Android
测试账号：管理员 / 成员
API 版本：5623004

## 测试结果

| 场景 | 输入 | 预期工具 | 工具触发 | 卡片显示 | 截图 | 备注 |
|-----|------|---------|---------|---------|------|------|
| 1 | 查看我的待办任务 | get_member_tasks | ✅/❌ | ✅/❌ | 01-tasks.png | |
| 2 | 这周家里有什么安排 | get_family_schedule | ✅/❌ | ✅/❌ | 02-schedule.png | |
| 3 | 家里还有哪些菜快过期了 | get_inventory_summary | ✅/❌ | ✅/❌ | 03-inventory.png | |
| 4 | 购物清单里有什么 | get_shopping_list | ✅/❌ | ✅/❌ | 04-shopping.png | |
| 5 | 搜索不辣的家常菜 | search_recipes | ✅/❌ | ✅/❌ | 05-recipes.png | |
| 6 | 下周点了什么菜 | get_dish_plan | ✅/❌ | ✅/❌ | 06-dish-plan.png | |
| 7 | 深圳这几天天气怎么样 | get_weather | ✅/❌ | ✅/❌ | 07-weather.png | API key 未配置 |
| 8 | 我的个人档案 | get_member_profile | ✅/❌ | ✅/❌ | 08-profile.png | |
| 9 | 我明天有什么安排，需要准备什么食材 | 多工具 | ✅/❌ | ✅/❌ | 09-multi-tool.png | 2-4 个卡片 |

## 发现的问题

### P0（阻塞）
- （如有）

### P1（重要）
- （如有）

### P2（优化）
- （如有）

## 其他观察

- Agent 工具选择准确度：X/9
- 卡片渲染正确率：X/9
- 平均响应时间：X 秒
- 是否需要多轮对话才能触发工具：是/否

EOF
```

### 4. 填写测试报告

根据实际测试结果填写 `TEST-REPORT.md`，将 ✅/❌ 改为实际结果。

### 5. 提交测试结果

```bash
cd ~/projects/family-app
git add test-screenshots/
git commit -m "test: A7.4-A 端到端测试报告与截图

- 完成 9 个测试场景（8个单工具 + 1个多工具联动）
- 全部截图保存在 test-screenshots/
- 测试报告见 TEST-REPORT.md"

git push origin uitest
```

---

## 常见问题排查

### 问题 1：工具没有被触发

**现象**：Agent 回复纯文字，没有卡片

**排查**：
1. 检查工具是否已启用：
   ```bash
   psql -U postgres -d family_app -c "SELECT \"readToolsEnabled\" FROM agent_settings;"
   ```
2. 检查 Agent 日志（终端 1 的 API 输出）：
   - 搜索 `[AgentToolsService]`
   - 看是否有 `Tool selected: xxx`
3. 如果日志显示"no tool selected"，说明 Agent 没有理解意图：
   - 尝试更明确的表述（如"使用 get_member_tasks 查询我的任务"）
   - 或检查 Agent runtime 是否正常（Hermes 连接）

### 问题 2：卡片显示空白或错误

**现象**：卡片标题正确，但内容为空或显示 `[Object object]`

**排查**：
1. 检查 API 日志的工具返回值：
   - 搜索 `Tool result:`
   - 验证返回的 JSON 结构
2. 检查 `resultPresentation` 的卡片生成逻辑：
   - 是否正确处理了 `result.tasks` / `result.events` 等字段
   - 是否有 null/undefined 导致的渲染错误

### 问题 3：天气工具返回错误

**现象**：卡片显示「天气服务暂时不可用」

**原因**：
- API key 未配置（预期行为）
- API key 无效
- OpenWeatherMap API 限流（免费层 60 次/分钟）

**排查**：
```bash
# 检查环境变量
grep OPENWEATHER apps/api/.env

# 手动测试 API
curl "https://api.openweathermap.org/data/2.5/forecast?q=Shenzhen&cnt=24&appid=YOUR_KEY&units=metric&lang=zh_cn"
```

### 问题 4：多工具联动只触发一个工具

**现象**：场景 9 只返回 1 个卡片

**原因**：Agent 可能认为单个工具已足够回答

**解决**：
- 尝试更复杂的问题（如"我明天有什么安排，需要买什么菜，家里还缺什么食材"）
- 或分两轮对话（第一轮"明天安排"，第二轮"需要准备什么"）

---

## 验收标准

测试通过需满足：

- [ ] 9 个场景全部有截图
- [ ] 至少 7/9 场景的工具被正确触发
- [ ] 至少 7/9 场景的卡片正确显示
- [ ] 天气工具在未配置 key 时有友好降级（不崩溃）
- [ ] 无 P0 阻塞问题
- [ ] 测试报告已提交到 `test-screenshots/TEST-REPORT.md`

---

## 完成后

将测试报告和截图提交到 `uitest` 分支，然后报告：

1. 测试通过率（X/9）
2. 发现的问题清单（按 P0/P1/P2 分级）
3. 你的观察和建议

如果测试通过率 < 7/9，或有 P0 问题，需要先修复再继续后续批次。
如果测试通过率 ≥ 7/9 且无 P0 问题，可以进入下一批次（A7.3 页面上下文 or A7.4-B 调度器）。
