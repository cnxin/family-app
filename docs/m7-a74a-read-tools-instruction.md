# A7.4-A 执行指令：8 个只读工具扩展

仓库 https://github.com/cnxin/family-app，分支 uitest。
A7.2b 前端已完成（837eb51），后端记忆、前端 UI 均已就绪。

**本批只做只读工具注册，不做例行任务、不做调度器。**
在 `apps/api` 实现 8 个只读工具，让 Agent 能查询家庭数据。
不要修改移动端、不要动迁移、不要改记忆服务。

## 已决策事项（出处见方案 §10.2）

- 第一阶段只做 8 个只读工具：
  1. `get_member_tasks` — 查询成员任务（待办/已完成）
  2. `get_family_schedule` — 查询家庭日程（未来 N 天）
  3. `get_inventory_summary` — 查询库存摘要（缺货/临期）
  4. `get_shopping_list` — 查询购物清单（待购/已购）
  5. `search_recipes` — 搜索菜谱（按食材/标签）
  6. `get_dish_plan` — 查询点菜计划（未来 N 天）
  7. `get_weather` — 查询天气（城市/日期范围）
  8. `get_member_profile` — 查询成员档案（姓名/角色/偏好）

- 例行任务（晨间简报/周报）延后到 A7.4-B，等调度器方案确定。
- 所有工具都是只读，不修改数据，只查询并返回结构化 JSON。
- 工具响应走 `resultPresentation()` 生成卡片，与现有工具（如 `get_dish_suggestions`）一致。
- 默认 `member` 角色可用，通过 `agent_member_profiles.readToolsEnabled` 控制。
- 天气工具调用外部 API（OpenWeatherMap 或类似），其他 7 个工具读本地数据库。

## 背景事实（已核查）

1. 工具系统：`apps/api/src/agent/agent-tools.service.ts` 的 `AGENT_READ_TOOLS` 数组
   包含工具定义（name / description / inputSchema / handler）。
2. 工具执行：`AgentToolsService.execute()` 根据 `toolName` 调用对应 handler，
   返回值经 `resultPresentation()` 包装成卡片。
3. 门控：`agent.service.ts` 的三条路径（queueMessage / retry / createConversation）
   用 `profile.readToolsEnabled` 过滤工具数组。
4. MCP Schema：`agent-mcp.controller.ts` 的 `GET /agent/mcp/tools` 返回 zod schema，
   供 Hermes 调用。每个工具需要在 `TOOL_SCHEMAS` 里注册 zod 定义。
5. 现有先例：`get_dish_suggestions`（190-240 行）、`get_recent_memories`（241-280 行）、
   `create_task`（281-330 行）是三个参考模板。
6. 测试：`apps/api/test/agent-tools.mjs` 包含工具冒烟测试，新工具需追加测试用例。
7. 数据库：现有表 `tasks` / `family_events` / `inventory_items` / `shopping_list_items` /
   `recipes` / `dish_plans` / `members` / `agent_member_profiles`。
8. TypeORM：所有实体在 `apps/api/src/entities/` 下，用 `this.dataSource.getRepository(Entity)`
   查询。
9. 天气 API：OpenWeatherMap 免费层 1000 次/天，需要 API key（环境变量 `OPENWEATHER_API_KEY`）。

## 任务 1：新增 8 个工具的 handler（`agent-tools.service.ts`）

在 `AGENT_READ_TOOLS` 数组末尾追加 8 个工具定义，每个包含：

```typescript
{
  name: 'get_member_tasks',
  description: '查询成员的任务列表（待办或已完成）',
  inputSchema: {
    type: 'object' as const,
    properties: {
      memberId: { type: 'string', description: '成员 ID，省略则查询当前成员' },
      status: { 
        type: 'string', 
        enum: ['pending', 'completed', 'all'],
        description: '任务状态，默认 pending'
      },
      limit: { type: 'number', description: '返回条数，默认 20' }
    }
  },
  handler: async (input: any, context: ToolExecutionContext) => {
    const memberId = input.memberId ?? context.user.memberId;
    const status = input.status ?? 'pending';
    const limit = Math.min(input.limit ?? 20, 50);

    const taskRepo = this.dataSource.getRepository(Task);
    const qb = taskRepo.createQueryBuilder('task')
      .where('task.householdId = :householdId', { householdId: context.user.householdId })
      .andWhere('task.assignedToMemberId = :memberId', { memberId });

    if (status !== 'all') {
      qb.andWhere('task.status = :status', { status });
    }

    const tasks = await qb
      .orderBy('task.dueAt', 'ASC')
      .take(limit)
      .getMany();

    return {
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        dueAt: t.dueAt,
        priority: t.priority,
        assignedToMemberId: t.assignedToMemberId,
      })),
      total: tasks.length,
    };
  }
}
```

**其他 7 个工具的实现要点**：

### 2. `get_family_schedule`
- 输入：`startDate`（默认今天）、`days`（默认 7，最大 30）
- 查询：`family_events` 表，`eventDate BETWEEN startDate AND startDate + days`
- 返回：`{ events: [{ id, title, eventDate, eventType, participants }], total }`

### 3. `get_inventory_summary`
- 输入：`filter`（`low_stock` / `expiring_soon` / `all`，默认 `low_stock`）
- 查询：`inventory_items` 表
  - `low_stock`: `quantity <= minQuantity`
  - `expiring_soon`: `expiresAt <= CURRENT_DATE + 7`
- 返回：`{ items: [{ id, name, quantity, unit, expiresAt }], total }`

### 4. `get_shopping_list`
- 输入：`status`（`pending` / `purchased` / `all`，默认 `pending`）
- 查询：`shopping_list_items` 表，按 `status` 过滤
- 返回：`{ items: [{ id, name, quantity, unit, status, addedByMemberId }], total }`

### 5. `search_recipes`
- 输入：`query`（关键词）、`ingredients`（食材数组）、`tags`（标签数组）、`limit`（默认 10）
- 查询：`recipes` 表
  - `query`: `name ILIKE %query%`
  - `ingredients`: `ingredients @> :ingredients::jsonb`
  - `tags`: `tags && :tags::text[]`
- 返回：`{ recipes: [{ id, name, cookingTime, difficulty, tags }], total }`

### 6. `get_dish_plan`
- 输入：`startDate`（默认今天）、`days`（默认 7，最大 30）
- 查询：`dish_plans` 表，关联 `recipes` 表
- 返回：`{ plans: [{ date, mealType, recipeName, recipeId }], total }`

### 7. `get_weather`
- 输入：`city`（默认"深圳"）、`days`（默认 3，最大 5）
- 调用：OpenWeatherMap API `https://api.openweathermap.org/data/2.5/forecast?q={city}&cnt={days*8}&appid={key}&units=metric&lang=zh_cn`
- 返回：`{ city, forecasts: [{ date, temp, weather, description }] }`
- 错误处理：API 失败时返回 `{ error: 'weather_api_unavailable' }`

### 8. `get_member_profile`
- 输入：`memberId`（省略则查询当前成员）
- 查询：`members` 表关联 `agent_member_profiles` 表
- 返回：`{ id, name, role, avatar, memoryEnabled, responseStyle }`
- 隐私：只返回同家庭成员，且不返回敏感字段（如 phoneNumber）

## 任务 2：MCP Schema 注册（`agent-mcp.controller.ts`）

在 `TOOL_SCHEMAS` 对象里追加 8 个 zod 定义：

```typescript
get_member_tasks: z.object({
  memberId: z.string().uuid().optional().describe('成员 ID，省略则查询当前成员'),
  status: z.enum(['pending', 'completed', 'all']).optional().describe('任务状态，默认 pending'),
  limit: z.number().int().positive().max(50).optional().describe('返回条数，默认 20'),
}),

get_family_schedule: z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('开始日期，默认今天'),
  days: z.number().int().positive().max(30).optional().describe('查询天数，默认 7'),
}),

get_inventory_summary: z.object({
  filter: z.enum(['low_stock', 'expiring_soon', 'all']).optional().describe('过滤条件，默认 low_stock'),
}),

get_shopping_list: z.object({
  status: z.enum(['pending', 'purchased', 'all']).optional().describe('状态，默认 pending'),
}),

search_recipes: z.object({
  query: z.string().optional().describe('关键词搜索'),
  ingredients: z.array(z.string()).optional().describe('必须包含的食材'),
  tags: z.array(z.string()).optional().describe('标签过滤'),
  limit: z.number().int().positive().max(50).optional().describe('返回条数，默认 10'),
}),

get_dish_plan: z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('开始日期，默认今天'),
  days: z.number().int().positive().max(30).optional().describe('查询天数，默认 7'),
}),

get_weather: z.object({
  city: z.string().optional().describe('城市名称，默认深圳'),
  days: z.number().int().positive().max(5).optional().describe('预报天数，默认 3'),
}),

get_member_profile: z.object({
  memberId: z.string().uuid().optional().describe('成员 ID，省略则查询当前成员'),
}),
```

## 任务 3：环境变量与配置（`.env.example`）

追加天气 API key 配置：

```bash
# OpenWeatherMap API（免费层 1000 次/天）
OPENWEATHER_API_KEY=your_openweathermap_api_key_here
```

在 `apps/api/src/config/configuration.ts` 追加：

```typescript
openweather: {
  apiKey: process.env.OPENWEATHER_API_KEY,
  baseUrl: 'https://api.openweathermap.org/data/2.5',
},
```

天气工具 handler 从 `ConfigService` 读取 `openweather.apiKey`，
若未配置则返回 `{ error: 'weather_api_not_configured' }`。

## 任务 4：工具测试（`test/agent-tools.mjs`）

追加 8 个工具的冒烟测试（参考现有 `get_dish_suggestions` 测试模式）：

```javascript
async function testGetMemberTasks() {
  console.log('\n=== 测试 get_member_tasks ===');
  const res = await axios.post(`${API_BASE}/agent/run`, {
    conversationId: null,
    message: '查看我的待办任务',
    toolName: 'get_member_tasks',
    toolInput: { status: 'pending', limit: 5 }
  }, { headers: { Authorization: `Bearer ${token}` } });
  
  assert(res.status === 200, 'HTTP 200');
  assert(res.data.data.runId, 'runId 存在');
  assert(Array.isArray(res.data.data.result.tasks), 'tasks 是数组');
  console.log(`✓ 返回 ${res.data.data.result.tasks.length} 个任务`);
}

// 依次为其他 7 个工具编写类似测试
```

测试覆盖：
- 默认参数（省略所有可选参数）
- 边界值（limit=50 / days=30）
- 错误情况（天气 API key 未配置 / 无效 memberId）

## 任务 5：resultPresentation 卡片（`agent-tools.service.ts`）

为 8 个工具的返回值生成人类可读的卡片（参考 `get_dish_suggestions` 的卡片格式）：

```typescript
private resultPresentation(toolName: string, result: any): ToolExecutionResult['presentation'] {
  // 现有工具的 case 保持不变
  
  // 新增 8 个 case
  case 'get_member_tasks': {
    const tasks = result.tasks || [];
    return {
      type: 'card',
      title: `待办任务（${tasks.length} 个）`,
      items: tasks.map((t: any) => ({
        label: t.title,
        value: `${t.status === 'completed' ? '✓' : '○'} ${t.dueAt ? new Date(t.dueAt).toLocaleDateString('zh-CN') : '无截止日期'}`,
        metadata: { taskId: t.id, priority: t.priority }
      })),
      footer: tasks.length === 0 ? '暂无任务' : undefined,
    };
  }
  
  case 'get_family_schedule': {
    const events = result.events || [];
    return {
      type: 'card',
      title: `家庭日程（${events.length} 个）`,
      items: events.map((e: any) => ({
        label: e.title,
        value: new Date(e.eventDate).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' }),
        metadata: { eventId: e.id, eventType: e.eventType }
      })),
      footer: events.length === 0 ? '暂无日程' : undefined,
    };
  }
  
  case 'get_inventory_summary': {
    const items = result.items || [];
    return {
      type: 'card',
      title: `库存摘要（${items.length} 项）`,
      items: items.map((i: any) => ({
        label: i.name,
        value: `${i.quantity} ${i.unit}${i.expiresAt ? ' · ' + new Date(i.expiresAt).toLocaleDateString('zh-CN') + '到期' : ''}`,
        metadata: { itemId: i.id }
      })),
      footer: items.length === 0 ? '无缺货或临期商品' : undefined,
    };
  }
  
  case 'get_shopping_list': {
    const items = result.items || [];
    const pending = items.filter((i: any) => i.status === 'pending').length;
    return {
      type: 'card',
      title: `购物清单（${pending} 项待购）`,
      items: items.map((i: any) => ({
        label: i.name,
        value: `${i.quantity} ${i.unit} ${i.status === 'purchased' ? '✓ 已购' : ''}`,
        metadata: { itemId: i.id }
      })),
      footer: items.length === 0 ? '清单为空' : undefined,
    };
  }
  
  case 'search_recipes': {
    const recipes = result.recipes || [];
    return {
      type: 'card',
      title: `菜谱搜索（${recipes.length} 个结果）`,
      items: recipes.map((r: any) => ({
        label: r.name,
        value: `${r.cookingTime}分钟 · ${r.difficulty} · ${r.tags?.join(' ')}`,
        metadata: { recipeId: r.id }
      })),
      footer: recipes.length === 0 ? '未找到匹配菜谱' : undefined,
    };
  }
  
  case 'get_dish_plan': {
    const plans = result.plans || [];
    return {
      type: 'card',
      title: `点菜计划（${plans.length} 餐）`,
      items: plans.map((p: any) => ({
        label: p.recipeName,
        value: `${new Date(p.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} ${p.mealType}`,
        metadata: { recipeId: p.recipeId }
      })),
      footer: plans.length === 0 ? '未安排点菜' : undefined,
    };
  }
  
  case 'get_weather': {
    const forecasts = result.forecasts || [];
    return {
      type: 'card',
      title: `${result.city} 天气预报`,
      items: forecasts.map((f: any) => ({
        label: new Date(f.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' }),
        value: `${f.temp}°C · ${f.description}`,
        metadata: { weather: f.weather }
      })),
      footer: result.error ? '天气服务暂时不可用' : undefined,
    };
  }
  
  case 'get_member_profile': {
    return {
      type: 'card',
      title: result.name,
      items: [
        { label: '角色', value: result.role === 'admin' ? '管理员' : '成员' },
        { label: '记忆功能', value: result.memoryEnabled ? '已启用' : '未启用' },
        { label: '回复风格', value: result.responseStyle || '默认' },
      ],
      metadata: { memberId: result.id }
    };
  }
  
  default:
    return { type: 'text', content: JSON.stringify(result, null, 2) };
}
```

## 任务 6：文档更新（`docs/m7-unified-personal-agent-memory-plan.md`）

在 §10.2「只读工具扩展」下追加一段，记录 A7.4-A 的落地情况：

```markdown
### A7.4-A 落地记录（2026-08-07）

已实现 8 个只读工具：
1. `get_member_tasks` — 任务查询（待办/已完成）
2. `get_family_schedule` — 日程查询（未来 N 天）
3. `get_inventory_summary` — 库存摘要（缺货/临期）
4. `get_shopping_list` — 购物清单（待购/已购）
5. `search_recipes` — 菜谱搜索（关键词/食材/标签）
6. `get_dish_plan` — 点菜计划（未来 N 天）
7. `get_weather` — 天气预报（OpenWeatherMap API）
8. `get_member_profile` — 成员档案（姓名/角色/偏好）

所有工具已注册到 `AGENT_READ_TOOLS` 并生成 MCP schema，默认对 `member` 角色可用。
天气工具需配置 `OPENWEATHER_API_KEY` 环境变量。

例行任务（晨间简报/周报）延后到 A7.4-B，等调度器方案确定。
```

## 验收

在 `apps/api` 下执行：

```bash
# 类型检查
npx pnpm typecheck

# 启动 API
npx pnpm api

# 新终端运行工具测试
node test/agent-tools.mjs

# 手动测试（通过对话触发工具）
# 1. 启动移动端：cd ../../ && npx pnpm mobile
# 2. Expo Go 扫码进入「小管家」
# 3. 对话测试：
#    - "查看我的待办任务"（触发 get_member_tasks）
#    - "这周家里有什么安排"（触发 get_family_schedule）
#    - "家里还有哪些菜快过期了"（触发 get_inventory_summary）
#    - "购物清单里有什么"（触发 get_shopping_list）
#    - "搜索不辣的菜谱"（触发 search_recipes）
#    - "下周点了什么菜"（触发 get_dish_plan）
#    - "深圳这几天天气怎么样"（触发 get_weather）
#    - "我的个人档案"（触发 get_member_profile）
```

预期结果：
- typecheck 无错误
- 工具测试 8/8 通过
- 对话能触发工具并显示卡片
- 天气工具在未配置 API key 时返回友好错误

## 约定

- 提交信息用中文
- 不要修改移动端代码（`apps/mobile`）
- 不要修改或新建迁移文件
- 不要改记忆服务（`agent-memory.service.ts`）
- 不要实现例行任务（延后到 A7.4-B）
- 工具 handler 内部错误要捕获并返回结构化错误（不要让 500 泄漏）
- 所有日期参数格式统一 `YYYY-MM-DD`
- 所有 limit 参数都要加上限（最大 50）

完成后报告：
1. 改动文件清单
2. typecheck 输出
3. 工具测试输出（8 个工具的通过情况）
4. 你认为需要澄清或文档有误的地方（带证据）

只报告有证据的分歧，不要推断未写明的要求。
