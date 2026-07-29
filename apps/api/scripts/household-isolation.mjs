import { createHash, createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const JWT_SECRET = process.env.JWT_SECRET || 'family-app-dev-secret';
const TEST_DATE = '2199-12-31';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    ...payload,
    iat: now,
    exp: now + 600,
  })}`;
  const signature = createHmac('sha256', JWT_SECRET)
    .update(content)
    .digest('base64url');
  return `${content}.${signature}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
  const json = await response.json();
  return { status: response.status, body: json };
}

const ids = {
  household: randomUUID(),
  account: randomUUID(),
  member: randomUUID(),
  session: randomUUID(),
  ingredient: randomUUID(),
  dish: randomUUID(),
  menu: randomUUID(),
  menuItem: randomUUID(),
  menuEvent: randomUUID(),
  calendarEvent: randomUUID(),
  task: randomUUID(),
  taskInstance: randomUUID(),
  notification: randomUUID(),
  poll: randomUUID(),
  pollOption: randomUUID(),
  pollVote: randomUUID(),
  pollNotification: randomUUID(),
  shoppingItem: randomUUID(),
  inventoryItem: randomUUID(),
};

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

await db.connect();

try {
  await db.query(
    `INSERT INTO accounts
       (id, "loginName", "loginNameNormalized")
     VALUES ($1, $2, $3)`,
    [ids.account, '隔离测试账号', `isolation-${ids.account}`],
  );
  await db.query(
    'INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)',
    [ids.household, '隔离测试家庭', `isolation-${ids.household}`],
  );
  await db.query(
    'INSERT INTO members (id, "householdId", "accountId", name, "avatarEmoji", role) VALUES ($1, $2, $3, $4, $5, $6)',
    [ids.member, ids.household, ids.account, '隔离测试成员', 'T', 'member'],
  );
  await db.query(
    `INSERT INTO auth_sessions
       (id, "householdId", "accountId", "memberId", "refreshTokenHash", "roleSnapshot",
        "credentialSnapshot", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, 'member', $6, now() + interval '10 minutes')`,
    [
      ids.session,
      ids.household,
      ids.account,
      ids.member,
      sha256('isolation-refresh-token'),
      sha256('family-app-credential:no-pin'),
    ],
  );
  await db.query(
    'INSERT INTO ingredients (id, "householdId", name, category, "defaultUnit") VALUES ($1, $2, $3, $4, $5)',
    [ids.ingredient, ids.household, '土豆', '蔬菜', '个'],
  );
  await db.query(
    'INSERT INTO dishes (id, "householdId", name, category) VALUES ($1, $2, $3, $4)',
    [ids.dish, ids.household, '隔离测试菜', '素菜'],
  );
  await db.query(
    'INSERT INTO menus (id, "householdId", date, "mealType") VALUES ($1, $2, $3, $4)',
    [ids.menu, ids.household, TEST_DATE, 'dinner'],
  );
  await db.query(
    'INSERT INTO menu_items (id, "menuId", "dishId", "requestedById", status) VALUES ($1, $2, $3, $4, $5)',
    [ids.menuItem, ids.menu, ids.dish, ids.member, 'accepted'],
  );
  await db.query(
    `INSERT INTO menu_events
       (id, "householdId", "menuId", "menuItemId", "actorId", "recipientId", type, "toValue")
     VALUES ($1, $2, $3, $4, $5, $5, 'item_status_changed', 'rejected')`,
    [ids.menuEvent, ids.household, ids.menu, ids.menuItem, ids.member],
  );
  await db.query(
    `INSERT INTO calendar_events
       (id, "householdId", date, title, note, "createdById")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      ids.calendarEvent,
      ids.household,
      TEST_DATE,
      '隔离测试日历事件',
      '只能由所属家庭读取',
      ids.member,
    ],
  );
  await db.query(
    `INSERT INTO household_tasks
       (id, "householdId", title, "startsOn", recurrence, "createdById", "defaultAssigneeId")
     VALUES ($1, $2, $3, $4, 'once', $5, $5)`,
    [ids.task, ids.household, '隔离测试任务', TEST_DATE, ids.member],
  );
  await db.query(
    `INSERT INTO household_task_instances
       (id, "householdId", "taskId", "dueDate", "assigneeId", status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [ids.taskInstance, ids.household, ids.task, TEST_DATE, ids.member],
  );
  await db.query(
    `INSERT INTO notifications
       (id, "householdId", "recipientId", module, type, "sourceId", title, "targetPath")
     VALUES ($1, $2, $3, 'task', 'task_assigned', $4, $5, $6)`,
    [
      ids.notification,
      ids.household,
      ids.member,
      ids.task,
      '隔离测试通知',
      `/tasks?date=${TEST_DATE}&taskId=${ids.task}`,
    ],
  );
  await db.query(
    `INSERT INTO polls
       (id, "householdId", title, category, "voteMode", "maxChoices", "createdById")
     VALUES ($1, $2, $3, 'general', 'single', 1, $4)`,
    [ids.poll, ids.household, '隔离测试投票', ids.member],
  );
  await db.query(
    `INSERT INTO poll_options (id, "pollId", label, "sortOrder")
     VALUES ($1, $2, $3, 0)`,
    [ids.pollOption, ids.poll, '隔离测试候选项'],
  );
  await db.query(
    `INSERT INTO poll_votes
       (id, "householdId", "pollId", "optionId", "memberId")
     VALUES ($1, $2, $3, $4, $5)`,
    [ids.pollVote, ids.household, ids.poll, ids.pollOption, ids.member],
  );
  await db.query(
    `INSERT INTO notifications
       (id, "householdId", "recipientId", module, type, "sourceId", title, "targetPath")
     VALUES ($1, $2, $3, 'poll', 'poll_created', $4, $5, $6)`,
    [
      ids.pollNotification,
      ids.household,
      ids.member,
      ids.poll,
      '隔离测试投票通知',
      `/polls?pollId=${ids.poll}`,
    ],
  );
  await db.query(
    'INSERT INTO shopping_items (id, "householdId", date, "customName", source) VALUES ($1, $2, $3, $4, $5)',
    [ids.shoppingItem, ids.household, TEST_DATE, '隔离测试购物项', 'manual'],
  );
  await db.query(
    'INSERT INTO inventory_items (id, "householdId", name, category) VALUES ($1, $2, $3, $4)',
    [ids.inventoryItem, ids.household, '隔离测试库存', '其他'],
  );

  const anonymousMembers = await request('/members');
  assert(anonymousMembers.status === 401, '匿名请求不能枚举家庭成员');

  const login = await request('/auth/login', null, 'POST', {
    loginName: '爸爸',
    password: 'family1234',
  });
  assert(login.status === 201, '默认家庭账号登录成功');
  const defaultToken = login.body.data.token;
  const defaultHouseholdId = login.body.data.member.householdId;
  const members = await request('/members', defaultToken);
  assert(members.status === 200 && members.body.data.length > 0, '登录后可读取本家庭成员');
  assert(
    members.body.data.every((member) => member.householdId !== ids.household),
    '成员列表不泄露其他家庭成员',
  );

  const foreignToken = signToken({
    sub: ids.account,
    accountId: ids.account,
    memberId: ids.member,
    householdId: ids.household,
    sid: ids.session,
    name: '隔离测试成员',
    role: 'member',
  });
  const oldToken = signToken({
    sub: ids.account,
    accountId: ids.account,
    memberId: ids.member,
    householdId: ids.household,
    name: '旧令牌',
    role: 'member',
  });

  const defaultDishes = await request('/dishes', defaultToken);
  assert(
    defaultDishes.status === 200 &&
      defaultDishes.body.data.every((dish) => dish.householdId === defaultHouseholdId),
    '菜谱列表只返回当前家庭数据',
  );

  const defaultRecipes = await request('/recipes', defaultToken);
  assert(
    defaultRecipes.status === 200 &&
      defaultRecipes.body.data.every(
        (dish) => dish.householdId === defaultHouseholdId,
      ),
    '独立菜谱只返回当前家庭数据',
  );
  const crossRecipe = await request(`/recipes/${ids.dish}`, defaultToken);
  const crossVariant = await request(
    `/dishes/${ids.dish}/recipe-variants`,
    defaultToken,
    'POST',
    { name: '不应创建' },
  );
  assert(
    crossRecipe.status === 404 && crossVariant.status === 404,
    '不能读取或新增其他家庭的做法',
  );

  const defaultIngredients = await request('/ingredients', defaultToken);
  assert(
    defaultIngredients.status === 200 &&
      defaultIngredients.body.data.every(
        (ingredient) => ingredient.householdId === defaultHouseholdId,
      ),
    '食材列表只返回当前家庭数据',
  );

  const defaultInventory = await request('/inventory', defaultToken);
  assert(
    defaultInventory.status === 200 &&
      defaultInventory.body.data.every(
        (item) => item.householdId === defaultHouseholdId,
      ),
    '库存列表只返回当前家庭数据',
  );

  const defaultShopping = await request(
    `/shopping-list?date=${TEST_DATE}`,
    defaultToken,
  );
  assert(
    defaultShopping.status === 200 && defaultShopping.body.data.length === 0,
    '购物清单不读取其他家庭同日数据',
  );

  const defaultCounts = await request(
    `/menu-dates?start=${TEST_DATE}&end=${TEST_DATE}`,
    defaultToken,
  );
  assert(
    defaultCounts.status === 200 && defaultCounts.body.data.length === 0,
    '日历标记不统计其他家庭菜单',
  );

  const defaultCalendar = await request(
    `/calendar?start=${TEST_DATE}&end=${TEST_DATE}`,
    defaultToken,
  );
  assert(
    defaultCalendar.status === 200 &&
      defaultCalendar.body.data.every(
        (entry) =>
          entry.sourceId !== ids.calendarEvent && entry.sourceId !== ids.task,
      ),
    '统一日历不读取其他家庭事件或任务',
  );

  const defaultTasks = await request(
    `/tasks?start=${TEST_DATE}&end=${TEST_DATE}`,
    defaultToken,
  );
  const defaultPolls = await request('/polls?status=all', defaultToken);
  const defaultNotifications = await request('/notifications', defaultToken);
  assert(
    defaultTasks.status === 200 &&
      defaultTasks.body.data.every((item) => item.taskId !== ids.task) &&
      defaultPolls.status === 200 &&
      defaultPolls.body.data.every((poll) => poll.id !== ids.poll) &&
      defaultNotifications.status === 200 &&
      defaultNotifications.body.data.every(
        (item) =>
          item.id !== ids.notification && item.id !== ids.pollNotification,
      ),
    '任务、投票和通用通知只返回当前家庭数据',
  );

  const foreignMenu = await request(
    `/menus?date=${TEST_DATE}&mealType=dinner`,
    foreignToken,
  );
  assert(
    foreignMenu.status === 200 && foreignMenu.body.data.id === ids.menu,
    '第二个家庭可读取自己的菜单',
  );

  const crossDish = await request(
    `/dishes/${ids.dish}`,
    defaultToken,
    'PATCH',
    { note: '不应写入' },
  );
  assert(crossDish.status === 404, '不能修改其他家庭菜谱');

  const crossMenu = await request(
    `/menus/${ids.menu}/items`,
    defaultToken,
    'POST',
    { items: [{ dishId: defaultDishes.body.data[0].id }] },
  );
  assert(crossMenu.status === 404, '不能向其他家庭菜单点菜');

  const crossMenuItem = await request(
    `/menu-items/${ids.menuItem}`,
    defaultToken,
    'PATCH',
    { status: 'done' },
  );
  assert(crossMenuItem.status === 404, '不能更新其他家庭菜单项');

  const crossChef = await request(
    `/menus/${ids.menu}/chef`,
    defaultToken,
    'PATCH',
    { chefId: members.body.data[0].id },
  );
  const crossComplete = await request(
    `/menus/${ids.menu}/complete`,
    defaultToken,
    'POST',
  );
  const crossEvents = await request(
    `/menus/${ids.menu}/events`,
    defaultToken,
  );
  const crossNotification = await request(
    `/menu-notifications/${ids.menuEvent}/read`,
    defaultToken,
    'PATCH',
  );
  assert(
    crossChef.status === 404 &&
      crossComplete.status === 404 &&
      crossEvents.status === 404 &&
      crossNotification.status === 404,
    '不能读取或操作其他家庭的主厨、历史、提醒和菜单锁定',
  );

  const foreignCalendar = await request(
    `/calendar?start=${TEST_DATE}&end=${TEST_DATE}`,
    foreignToken,
  );
  const crossCalendar = await request(
    `/calendar-events/${ids.calendarEvent}`,
    defaultToken,
    'PATCH',
    { title: '不应写入' },
  );
  assert(
    foreignCalendar.status === 200 &&
      foreignCalendar.body.data.some(
        (entry) => entry.sourceId === ids.calendarEvent,
      ) &&
      foreignCalendar.body.data.some((entry) => entry.sourceId === ids.task) &&
      crossCalendar.status === 404,
    '家庭事件与任务只对所属家庭可见且不能被跨家庭修改',
  );

  const foreignTasks = await request(
    `/tasks?start=${TEST_DATE}&end=${TEST_DATE}`,
    foreignToken,
  );
  const crossTask = await request(
    `/tasks/${ids.task}`,
    defaultToken,
    'PATCH',
    { title: '不应写入' },
  );
  const crossTaskInstance = await request(
    `/tasks/${ids.task}/instances/${TEST_DATE}`,
    defaultToken,
    'PATCH',
    { status: 'done' },
  );
  const crossGenericNotification = await request(
    `/notifications/${ids.notification}/read`,
    defaultToken,
    'PATCH',
  );
  assert(
    foreignTasks.status === 200 &&
      foreignTasks.body.data.some((item) => item.taskId === ids.task) &&
      crossTask.status === 404 &&
      crossTaskInstance.status === 404 &&
      crossGenericNotification.status === 404,
    '不能跨家庭读取、修改任务实例或处理通知',
  );

  const foreignPolls = await request('/polls?status=all', foreignToken);
  const crossPoll = await request(
    `/polls/${ids.poll}`,
    defaultToken,
    'PATCH',
    { title: '不应写入' },
  );
  const crossPollVote = await request(
    `/polls/${ids.poll}/votes`,
    defaultToken,
    'POST',
    { optionIds: [ids.pollOption] },
  );
  const crossPollClose = await request(
    `/polls/${ids.poll}/close`,
    defaultToken,
    'POST',
  );
  const crossPollNotification = await request(
    `/notifications/${ids.pollNotification}/read`,
    defaultToken,
    'PATCH',
  );
  assert(
    foreignPolls.status === 200 &&
      foreignPolls.body.data.some((poll) => poll.id === ids.poll) &&
      crossPoll.status === 404 &&
      crossPollVote.status === 404 &&
      crossPollClose.status === 404 &&
      crossPollNotification.status === 404,
    '不能跨家庭读取、修改、参与或结束投票及处理投票通知',
  );

  const crossShopping = await request(
    `/shopping-items/${ids.shoppingItem}`,
    defaultToken,
    'PATCH',
    { checked: true },
  );
  assert(crossShopping.status === 404, '不能更新其他家庭购物项');

  const crossInventory = await request(
    `/inventory-items/${ids.inventoryItem}`,
    defaultToken,
    'PATCH',
    { quantity: 99 },
  );
  assert(crossInventory.status === 404, '不能更新其他家庭库存');

  const oldSession = await request('/dishes', oldToken);
  assert(oldSession.status === 401, '缺少会话 ID 的旧令牌会失效');

  console.log('\n家庭数据隔离测试全部通过');
} finally {
  await db.query('DELETE FROM notifications WHERE id = $1', [ids.pollNotification]);
  await db.query('DELETE FROM notifications WHERE id = $1', [ids.notification]);
  await db.query('DELETE FROM poll_votes WHERE id = $1', [ids.pollVote]);
  await db.query('DELETE FROM poll_options WHERE id = $1', [ids.pollOption]);
  await db.query('DELETE FROM polls WHERE id = $1', [ids.poll]);
  await db.query('DELETE FROM household_task_instances WHERE id = $1', [
    ids.taskInstance,
  ]);
  await db.query('DELETE FROM household_tasks WHERE id = $1', [ids.task]);
  await db.query('DELETE FROM calendar_events WHERE id = $1', [ids.calendarEvent]);
  await db.query('DELETE FROM menu_events WHERE id = $1', [ids.menuEvent]);
  await db.query('DELETE FROM menu_items WHERE id = $1', [ids.menuItem]);
  await db.query('DELETE FROM shopping_items WHERE "householdId" = $1', [ids.household]);
  await db.query('DELETE FROM inventory_items WHERE "householdId" = $1', [ids.household]);
  await db.query('DELETE FROM menus WHERE "householdId" = $1', [ids.household]);
  await db.query('DELETE FROM dish_ingredients WHERE "dishId" = $1', [ids.dish]);
  await db.query('DELETE FROM dishes WHERE "householdId" = $1', [ids.household]);
  await db.query('DELETE FROM ingredients WHERE "householdId" = $1', [ids.household]);
  await db.query('DELETE FROM auth_sessions WHERE "householdId" = $1', [ids.household]);
  await db.query('DELETE FROM members WHERE "householdId" = $1', [ids.household]);
  await db.query('DELETE FROM households WHERE id = $1', [ids.household]);
  await db.query('DELETE FROM accounts WHERE id = $1', [ids.account]);
  await db.end();
}
