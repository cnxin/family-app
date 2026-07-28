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
  member: randomUUID(),
  session: randomUUID(),
  ingredient: randomUUID(),
  dish: randomUUID(),
  menu: randomUUID(),
  menuItem: randomUUID(),
  menuEvent: randomUUID(),
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
    'INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)',
    [ids.household, '隔离测试家庭', `isolation-${ids.household}`],
  );
  await db.query(
    'INSERT INTO members (id, "householdId", name, "avatarEmoji", role) VALUES ($1, $2, $3, $4, $5)',
    [ids.member, ids.household, '隔离测试成员', 'T', 'member'],
  );
  await db.query(
    `INSERT INTO auth_sessions
       (id, "householdId", "memberId", "refreshTokenHash", "roleSnapshot",
        "credentialSnapshot", "expiresAt")
     VALUES ($1, $2, $3, $4, 'member', $5, now() + interval '10 minutes')`,
    [
      ids.session,
      ids.household,
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
    'INSERT INTO shopping_items (id, "householdId", date, "customName", source) VALUES ($1, $2, $3, $4, $5)',
    [ids.shoppingItem, ids.household, TEST_DATE, '隔离测试购物项', 'manual'],
  );
  await db.query(
    'INSERT INTO inventory_items (id, "householdId", name, category) VALUES ($1, $2, $3, $4)',
    [ids.inventoryItem, ids.household, '隔离测试库存', '其他'],
  );

  const members = await request('/members');
  assert(members.status === 200 && members.body.data.length > 0, '默认家庭成员可登录');
  assert(
    members.body.data.every((member) => member.householdId !== ids.household),
    '公开成员列表不泄露其他家庭成员',
  );

  const login = await request('/auth/login', null, 'POST', {
    memberId: members.body.data[0].id,
  });
  assert(login.status === 201, '默认家庭登录成功');
  const defaultToken = login.body.data.token;
  const defaultHouseholdId = login.body.data.member.householdId;

  const foreignToken = signToken({
    sub: ids.member,
    memberId: ids.member,
    householdId: ids.household,
    sid: ids.session,
    name: '隔离测试成员',
    role: 'member',
  });
  const oldToken = signToken({
    sub: ids.member,
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
  await db.end();
}
