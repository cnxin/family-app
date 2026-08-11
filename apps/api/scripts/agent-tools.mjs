// 本套件直接调用 Family App MCP，不经过 Hermes，不能证明工具对模型可见。
// MCP 目录由 agent.mjs 校验，Hermes 白名单由 hermes-config-contract.mjs 校验。
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const MCP_KEY = process.env.AGENT_MCP_KEY || 'family-app-local-agent-mcp-key';
const DATABASE = process.env.DB_NAME || 'family_app';
const TOOL_NAMES = [
  'get_member_tasks',
  'get_family_schedule',
  'get_inventory_summary',
  'get_shopping_list',
  'search_recipes',
  'get_dish_plan',
  'get_weather',
  'get_member_profile',
  'get_asset_detail',
];

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('agent-tools.mjs 只允许在 API 临时测试库中运行');
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

function dateInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return {
    status: response.status,
    data: json?.data,
    error: json?.error,
    body: json,
  };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: PASSWORD,
  });
  assert(response.status === 201, `${loginName}可以登录只读工具回归`);
  return response.data;
}

async function mcp(body) {
  const response = await fetch(`${BASE}/internal/agent/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${MCP_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const dataLine = text
    .split(/\r?\n/)
    .find((line) => line.startsWith('data: '));
  const payload = dataLine ? dataLine.slice(6) : text;
  return { status: response.status, body: payload ? JSON.parse(payload) : null };
}

function toolCall(id, name, runId, input = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: { runId, ...input } },
  };
}

function toolResult(response) {
  const text = response.body?.result?.content?.[0]?.text;
  return typeof text === 'string' ? JSON.parse(text) : null;
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: DATABASE,
});
await db.connect();

try {
  const owner = await login('爸爸');
  const today = dateInShanghai();
  const fixtureDate = addDays(today, 2);
  const completedDate = addDays(today, 3);
  const suffix = randomUUID().slice(0, 8);

  console.log('1. 构造 9 个只读工具的家庭数据');
  const pendingTaskTitle = `工具待办-${suffix}`;
  const completedTaskTitle = `工具完成-${suffix}`;
  const pendingTask = await request('/tasks', owner.accessToken, 'POST', {
    title: pendingTaskTitle,
    startsOn: fixtureDate,
    recurrence: 'once',
    defaultAssigneeId: owner.member.id,
  });
  const completedTask = await request('/tasks', owner.accessToken, 'POST', {
    title: completedTaskTitle,
    startsOn: completedDate,
    recurrence: 'once',
    defaultAssigneeId: owner.member.id,
  });
  const completedOccurrence = await request(
    `/tasks/${completedTask.data.id}/instances/${completedDate}`,
    owner.accessToken,
    'PATCH',
    { status: 'done' },
  );
  assert(
    pendingTask.status === 201 &&
      completedTask.status === 201 &&
      completedOccurrence.status === 200,
    '任务夹具包含待办和已完成状态',
  );

  const scheduleTitle = `工具日程-${suffix}`;
  const schedule = await request('/calendar-events', owner.accessToken, 'POST', {
    date: fixtureDate,
    title: scheduleTitle,
    note: 'A7.4-A 只读工具回归',
  });
  assert(schedule.status === 201, '家庭日程夹具创建成功');

  const lowStockName = `低库存-${suffix}`;
  const expiringName = `临期库存-${suffix}`;
  const lowStockItem = await request('/inventory-items', owner.accessToken, 'POST', {
    name: lowStockName,
    category: '其他',
    quantity: 0,
    unit: '件',
    lowStockThreshold: 1,
    restockQuantity: 2,
  });
  const expiringItem = await request('/inventory-items', owner.accessToken, 'POST', {
    name: expiringName,
    category: '其他',
    quantity: 2,
    unit: '件',
    lowStockThreshold: 0,
    restockQuantity: 1,
  });
  const expiringBatch = await request(
    '/inventory-batches',
    owner.accessToken,
    'POST',
    {
      inventoryItemId: expiringItem.data.id,
      quantity: 2,
      receivedOn: today,
      expiresOn: addDays(today, 3),
      idempotencyKey: `agent-tools-batch-${suffix}`,
    },
  );
  assert(
    lowStockItem.status === 201 &&
      expiringItem.status === 201 &&
      expiringBatch.status === 201,
    '低库存和临期批次夹具创建成功',
  );

  const pendingShoppingName = `待购-${suffix}`;
  const purchasedShoppingName = `已购-${suffix}`;
  const pendingShopping = await request(
    '/shopping-items',
    owner.accessToken,
    'POST',
    { date: fixtureDate, customName: pendingShoppingName, totalQty: 1, unit: '件' },
  );
  const purchasedShopping = await request(
    '/shopping-items',
    owner.accessToken,
    'POST',
    { date: fixtureDate, customName: purchasedShoppingName, totalQty: 2, unit: '件' },
  );
  const checkedShopping = await request(
    `/shopping-items/${purchasedShopping.data.id}`,
    owner.accessToken,
    'PATCH',
    { checked: true },
  );
  assert(
    pendingShopping.status === 201 &&
      purchasedShopping.status === 201 &&
      checkedShopping.status === 200,
    '购物清单夹具包含待购和已购状态',
  );

  const recipeName = `青菜工具菜谱-${suffix}`;
  const ingredientName = `测试青菜-${suffix}`;
  const dish = await request('/dishes', owner.accessToken, 'POST', {
    name: recipeName,
    category: '素菜',
    difficulty: 1,
    estMinutes: 12,
    ingredients: [{ name: ingredientName, quantity: 1, unit: '份' }],
  });
  const menu = await request(
    `/menus?date=${fixtureDate}&mealType=dinner`,
    owner.accessToken,
  );
  const menuItems = await request(
    `/menus/${menu.data.id}/items`,
    owner.accessToken,
    'POST',
    { items: [{ dishId: dish.data.id }] },
  );
  assert(
    dish.status === 201 && menu.status === 200 && menuItems.status === 201,
    '菜谱和点菜计划夹具创建成功',
  );

  const assetName = `资产工具-${suffix}`;
  const assetWarrantyExpiresOn = addDays(today, 30);
  const assetNextMaintenanceAt = addDays(today, 15);
  const asset = await request('/assets', owner.accessToken, 'POST', {
    name: assetName,
    category: 'appliance',
    location: '工具回归位置',
    brand: 'A7.4',
    model: 'asset-detail',
    purchaseDate: today,
    purchasePrice: 8888,
    warrantyExpiresOn: assetWarrantyExpiresOn,
  });
  const maintenancePlan = await request(
    `/assets/${asset.data.id}/maintenance-plans`,
    owner.accessToken,
    'POST',
    {
      title: `维保工具-${suffix}`,
      frequencyDays: 180,
      nextDueDate: assetNextMaintenanceAt,
    },
  );
  assert(
    asset.status === 201 && maintenancePlan.status === 201,
    '资产详情夹具包含价格、保修和维保日期',
  );

  const conversation = await request(
    '/agent/conversations',
    owner.accessToken,
    'POST',
    { title: 'A7.4-A 工具回归' },
  );
  const profile = await db.query(
    `SELECT id FROM agent_member_profiles
     WHERE "householdId" = $1 AND "memberId" = $2`,
    [owner.member.householdId, owner.member.id],
  );
  async function createToolRun(runtimeVersion = 'a7.4-a') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO agent_runs (
         id, "householdId", "conversationId", "requestedByMemberId", "agentProfileId",
         "clientRequestId", "runtimeKind", "runtimeVersion", "modelAlias", status,
         "allowedTools", "authorizationExpiresAt", "startedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, 'fake', $7, 'hermes-agent',
         'running', $8, now() + interval '10 minutes', now())`,
      [
        id,
        owner.member.householdId,
        conversation.data.id,
        owner.member.id,
        profile.rows[0].id,
        `agent-tools:${id}`,
        runtimeVersion,
        JSON.stringify(TOOL_NAMES),
      ],
    );
    return id;
  }
  const runId = await createToolRun();

  console.log('2. MCP 注册和 9 个工具冒烟');
  const listed = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const registeredTools = listed.body?.result?.tools ?? [];
  const registeredNames = registeredTools.map((tool) => tool.name);
  assert(
    registeredNames.length === 28 &&
      new Set(registeredNames).size === 28 &&
      TOOL_NAMES.every((name) => registeredNames.includes(name)),
    'MCP 目录精确注册 28 个工具且 9 个只读工具均有 schema',
  );
  const descriptionFor = (name) =>
    registeredTools.find((tool) => tool.name === name)?.description ?? '';
  assert(
    descriptionFor('get_weather').includes('唯一数据来源') &&
      descriptionFor('get_weather').includes('不得依据模型自身知识') &&
      descriptionFor('get_member_tasks').includes('我的任务') &&
      descriptionFor('get_tasks').includes('全家') &&
      descriptionFor('search_recipes').includes('这道菜') &&
      descriptionFor('search_recipes').includes('范围查询应直接调用') &&
      descriptionFor('get_asset_detail').includes('唯一途径') &&
      descriptionFor('get_asset_detail').includes('不得自行选择') &&
      descriptionFor('remember_preference').includes('必须立即调用') &&
      descriptionFor('remember_preference').includes('不得追问'),
    '天气来源、任务边界、单实体指代和个人记忆直写候选语义已进入 MCP 工具描述',
  );

  const memberTasks = await mcp(
    toolCall(2, 'get_member_tasks', runId, {
      memberId: owner.member.id,
      status: 'pending',
      limit: 50,
    }),
  );
  const completedTasks = await mcp(
    toolCall(3, 'get_member_tasks', runId, {
      status: 'completed',
      limit: 50,
    }),
  );
  assert(
    toolResult(memberTasks)?.tasks.some((task) => task.title === pendingTaskTitle) &&
      toolResult(completedTasks)?.tasks.some(
        (task) => task.title === completedTaskTitle && task.status === 'completed',
      ),
    '成员任务支持 pending/completed 状态和 limit=50',
  );

  const scheduleResult = await mcp(
    toolCall(4, 'get_family_schedule', runId, {
      startDate: today,
      days: 30,
    }),
  );
  assert(
    toolResult(scheduleResult)?.events.some((event) => event.title === scheduleTitle),
    '家庭日程支持 days=30 并返回真实深链接',
  );

  const inventoryResult = await mcp(
    toolCall(5, 'get_inventory_summary', runId, { filter: 'all' }),
  );
  const inventoryRows = toolResult(inventoryResult)?.items ?? [];
  assert(
    inventoryRows.some(
      (item) => item.name === lowStockName && item.alert.includes('low_stock'),
    ) &&
      inventoryRows.some(
        (item) => item.name === expiringName && item.alert.includes('expiring'),
      ),
    '库存摘要区分低库存与临期批次',
  );

  const pendingList = await mcp(
    toolCall(6, 'get_shopping_list', runId, {
      date: fixtureDate,
      status: 'pending',
    }),
  );
  const purchasedList = await mcp(
    toolCall(7, 'get_shopping_list', runId, {
      date: fixtureDate,
      status: 'purchased',
    }),
  );
  assert(
    toolResult(pendingList)?.some(
      (item) => item.name === pendingShoppingName && item.status === 'pending',
    ) &&
      !toolResult(pendingList)?.some((item) => item.name === purchasedShoppingName) &&
      toolResult(purchasedList)?.some(
        (item) => item.name === purchasedShoppingName && item.status === 'purchased',
      ),
    '购物清单兼容旧响应并支持 pending/purchased 过滤',
  );

  const recipes = await mcp(
    toolCall(8, 'search_recipes', runId, {
      query: recipeName,
      ingredients: [ingredientName],
      tags: ['素菜'],
      limit: 50,
    }),
  );
  assert(
    toolResult(recipes)?.recipes.some(
      (recipe) => recipe.name === recipeName && recipe.tags.includes('素菜'),
    ),
    '菜谱按关键词、真实食材和现有菜品分类搜索',
  );

  const dishPlan = await mcp(
    toolCall(9, 'get_dish_plan', runId, { startDate: today, days: 30 }),
  );
  assert(
    toolResult(dishPlan)?.plans.some(
      (plan) => plan.recipeName === recipeName && plan.date === fixtureDate,
    ),
    '点菜计划支持 days=30 且只读取已有菜单',
  );

  const weather = await mcp(toolCall(10, 'get_weather', runId));
  assert(
    toolResult(weather)?.error === 'weather_api_not_configured',
    '天气 API 未配置时返回稳定错误码而不崩溃',
  );

  const memberProfile = await mcp(toolCall(11, 'get_member_profile', runId));
  assert(
    toolResult(memberProfile)?.id === owner.member.id &&
      toolResult(memberProfile)?.name === owner.member.name &&
      !Object.hasOwn(toolResult(memberProfile), 'accountId'),
    '成员档案仅返回当前家庭的非敏感字段',
  );

  const assetDetail = await mcp(
    toolCall(20, 'get_asset_detail', runId, { assetId: asset.data.id }),
  );
  const assetResult = toolResult(assetDetail);
  assert(
    assetResult?.name === assetName &&
      assetResult.expiresAt === assetWarrantyExpiresOn &&
      assetResult.isUnderWarranty === true &&
      assetResult.warrantyDaysRemaining === 30 &&
      assetResult.nextMaintenanceAt === assetNextMaintenanceAt &&
      assetResult.brandModel === 'A7.4 asset-detail' &&
      !Object.hasOwn(assetResult, 'purchasePrice') &&
      !Object.hasOwn(assetResult, 'documents'),
    '资产详情返回真实保修和维保信息且不暴露价格或文档正文',
  );

  console.log('3. 参数边界、家庭隔离与结构化卡片');
  const invalidDays = await mcp(
    toolCall(12, 'get_family_schedule', runId, { days: 31 }),
  );
  const invalidDate = await mcp(
    toolCall(13, 'get_dish_plan', runId, {
      startDate: '2199-02-30',
      days: 1,
    }),
  );
  const foreignHouseholdId = randomUUID();
  const foreignMemberId = randomUUID();
  const foreignAssetId = randomUUID();
  const foreignDishName = `隔离菜谱-${suffix}`;
  await db.query(
    `INSERT INTO households (id, name, slug)
     VALUES ($1, 'A7.4-A 隔离家庭', $2)`,
    [foreignHouseholdId, `agent-tools-${randomUUID()}`],
  );
  await db.query(
    `INSERT INTO members (id, "householdId", name, "avatarEmoji", role)
     VALUES ($1, $2, '隔离成员', 'I', 'member')`,
    [foreignMemberId, foreignHouseholdId],
  );
  await db.query(
    `INSERT INTO dishes (id, "householdId", name, category, difficulty, "isActive")
     VALUES ($1, $2, $3, '素菜', 1, true)`,
    [randomUUID(), foreignHouseholdId, foreignDishName],
  );
  await db.query(
    `INSERT INTO home_assets (
       id, "householdId", name, category, status, "createdById"
     ) VALUES ($1, $2, '隔离资产', 'appliance', 'active', $3)`,
    [foreignAssetId, foreignHouseholdId, foreignMemberId],
  );
  const foreignProfile = await mcp(
    toolCall(14, 'get_member_profile', runId, { memberId: foreignMemberId }),
  );
  const isolatedRecipes = await mcp(
    toolCall(15, 'search_recipes', runId, { query: foreignDishName }),
  );
  assert(
    invalidDays.body?.error || invalidDays.body?.result?.isError,
    'MCP schema 拒绝 days=31 越界参数',
  );
  assert(
    JSON.stringify(invalidDate.body).includes('日期不是有效的日历日期'),
    '工具处理层拒绝不存在的日历日期',
  );
  assert(
    JSON.stringify(foreignProfile.body).includes('家庭成员不存在'),
    '成员档案拒绝跨家庭成员 ID',
  );
  assert(
    toolResult(isolatedRecipes)?.recipes.length === 0,
    '菜谱搜索不会返回其他家庭数据',
  );

  const eventRows = await db.query(
    `SELECT "toolName", "presentationCiphertext", "presentationNonce",
            "presentationVersion"
     FROM agent_tool_events
     WHERE "runId" = $1 AND status = 'completed'
       AND "toolName" = ANY($2::varchar[])`,
    [runId, TOOL_NAMES],
  );
  const detail = await request(
    `/agent/conversations/${conversation.data.id}`,
    owner.accessToken,
  );
  const presentedTools = new Set(
    detail.data.toolEvents
      .filter((event) => event.runId === runId && event.presentation)
      .map((event) => event.toolName),
  );
  const assetPresentation = detail.data.toolEvents.find(
    (event) =>
      event.runId === runId &&
      event.toolName === 'get_asset_detail' &&
      event.presentation,
  )?.presentation;
  assert(
    TOOL_NAMES.every((name) => presentedTools.has(name)) &&
      eventRows.rows.every(
        (row) =>
          row.presentationCiphertext &&
          row.presentationNonce &&
          row.presentationVersion === 1 &&
          !row.presentationCiphertext.includes(scheduleTitle) &&
          !row.presentationCiphertext.includes(recipeName),
      ),
    '9 个工具均生成加密结构化卡片，审计行不保存明文展示内容',
  );
  assert(
    assetPresentation?.kind === 'asset-detail' &&
      assetPresentation.items?.[0]?.title === assetName &&
      assetPresentation.items?.[0]?.status.includes('在保') &&
      assetPresentation.footer?.includes(assetWarrantyExpiresOn) &&
      assetPresentation.footer?.includes(assetNextMaintenanceAt),
    '资产详情卡片显著展示在保状态、到期日和下次维保日期',
  );

  const missingAssetId = await mcp(
    toolCall(21, 'get_asset_detail', runId),
  );
  const foreignAsset = await mcp(
    toolCall(22, 'get_asset_detail', runId, { assetId: foreignAssetId }),
  );
  const nonexistentAsset = await mcp(
    toolCall(23, 'get_asset_detail', runId, { assetId: randomUUID() }),
  );
  assert(
    toolResult(missingAssetId)?.error === 'asset_id_required' &&
      toolResult(missingAssetId)?.message.includes('不得自行选择'),
    'assetId 缺省时返回明确业务错误且禁止自行选择资产',
  );
  assert(
    foreignAsset.body?.result?.isError === true &&
      JSON.stringify(foreignAsset.body.result) ===
        JSON.stringify(nonexistentAsset.body?.result),
    '跨家庭 assetId 与不存在 UUID 返回一致的拒绝响应',
  );

  console.log('4. 菜谱搜索按 runId 强制限制为两次');
  const limitedRunId = await createToolRun('search-recipes-limit');
  const limitedFirst = await mcp(
    toolCall(16, 'search_recipes', limitedRunId, { query: recipeName }),
  );
  const limitedSecond = await mcp(
    toolCall(17, 'search_recipes', limitedRunId, { query: recipeName }),
  );
  const limitedThird = await mcp(
    toolCall(18, 'search_recipes', limitedRunId, { query: recipeName }),
  );
  const limitedEvents = await db.query(
    `SELECT status, "outputSummary", "presentationCiphertext"
     FROM agent_tool_events
     WHERE "runId" = $1 AND "toolName" = 'search_recipes'
     ORDER BY "startedAt"`,
    [limitedRunId],
  );
  const limitedRun = await db.query(
    `SELECT status FROM agent_runs WHERE id = $1`,
    [limitedRunId],
  );
  assert(
    [limitedFirst, limitedSecond].every((response) =>
      toolResult(response)?.recipes.some((recipe) => recipe.name === recipeName),
    ) &&
      toolResult(limitedThird)?.error === 'recipe_search_limit_reached' &&
      toolResult(limitedThird)?.message.includes('请基于已有搜索结果继续规划') &&
      !limitedThird.body?.result?.isError &&
      limitedEvents.rows.length === 3 &&
      limitedEvents.rows.slice(0, 2).every(
        (event) =>
          event.status === 'completed' &&
          event.outputSummary.errorCode == null &&
          event.presentationCiphertext,
      ) &&
      limitedEvents.rows[2].status === 'completed' &&
      limitedEvents.rows[2].outputSummary.errorCode ===
        'recipe_search_limit_reached' &&
      limitedEvents.rows[2].presentationCiphertext == null &&
      limitedRun.rows[0].status === 'running',
    '同一 run 前两次搜索成功，第三次返回正常业务上限且 run 不失败',
  );

  const independentRunId = await createToolRun('search-recipes-independent');
  const independentSearch = await mcp(
    toolCall(19, 'search_recipes', independentRunId, { query: recipeName }),
  );
  const independentEvents = await db.query(
    `SELECT count(*)::int AS count FROM agent_tool_events
     WHERE "runId" = $1 AND "toolName" = 'search_recipes'`,
    [independentRunId],
  );
  assert(
    toolResult(independentSearch)?.recipes.some(
      (recipe) => recipe.name === recipeName,
    ) && independentEvents.rows[0].count === 1,
    '不同 runId 的菜谱搜索次数相互独立',
  );

  console.log('A7.4-A 只读工具回归通过');
} finally {
  await db.end();
}
