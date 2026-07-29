import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const TEST_DATE = '2199-12-29';
const LOCK_TEST_DATE = '2199-12-26';
const SHOPPING_TRANSACTION_DATE = '2199-12-27';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

function comparableIngredients(dish) {
  return dish.ingredients
    .map((item) => ({
      ingredientId: item.ingredientId,
      quantity: String(item.quantity),
      unit: item.unit,
    }))
    .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

await db.connect();
let memberId = null;
let memberAccountId = null;
let originalPasswordHash = null;
let originalRole = null;
let testHouseholdId = null;
const transactionIds = {
  dishes: [randomUUID(), randomUUID()],
  menu: randomUUID(),
  shoppingItem: randomUUID(),
};

try {
  const anonymousMembers = await request('/members');
  assert(anonymousMembers.status === 401, '成员目录需要登录后才能访问');

  const unknownAccount = await request('/auth/login', null, 'POST', {
    loginName: '不存在的账号',
    password: 'wrong-password',
  });
  const wrongOwnerPassword = await request('/auth/login', null, 'POST', {
    loginName: '爸爸',
    password: 'wrong-password',
  });
  assert(
    unknownAccount.status === 401 && wrongOwnerPassword.status === 401,
    '未知账号和错误密码返回相同认证失败',
  );

  const chefLogin = await request('/auth/login', null, 'POST', {
    loginName: '爸爸',
    password: 'family1234',
  });
  assert(chefLogin.status === 201, '家庭所有者账号可登录');
  const chefSession = chefLogin.body.data;
  const chefToken = chefSession.accessToken;
  const initialMembers = await request('/members', chefToken);
  const chef = initialMembers.body.data.find(
    (member) => member.role === 'owner' && member.prefersCooking,
  );
  const member = initialMembers.body.data.find((item) => item.role === 'member');
  assert(chef && member, '成员权限角色和掌勺偏好已经分离');
  memberId = member.id;
  originalRole = member.role;

  const accountRow = await db.query(
    `SELECT account.id, account."passwordHash"
     FROM accounts account
     JOIN members member ON member."accountId" = account.id
     WHERE member.id = $1`,
    [member.id],
  );
  memberAccountId = accountRow.rows[0].id;
  originalPasswordHash = accountRow.rows[0].passwordHash;
  await db.query('UPDATE accounts SET "passwordHash" = $1 WHERE id = $2', [
    await bcrypt.hash('member-password-2468', 12),
    memberAccountId,
  ]);

  const missingPassword = await request('/auth/login', null, 'POST', {
    loginName: '妈妈',
  });
  const wrongPassword = await request('/auth/login', null, 'POST', {
    loginName: '妈妈',
    password: 'wrong-password',
  });
  assert(
    missingPassword.status === 401 && wrongPassword.status === 401,
    '缺少或错误账号密码无法登录',
  );

  const memberLogin = await request('/auth/login', null, 'POST', {
    loginName: '妈妈',
    password: 'member-password-2468',
  });
  assert(memberLogin.status === 201, '正确账号密码可登录');
  const memberSession = memberLogin.body.data;
  let memberToken = memberSession.accessToken;
  let memberRefreshToken = memberSession.refreshToken;
  assert(
    memberSession.token === memberSession.accessToken &&
      typeof memberSession.refreshToken === 'string' &&
      memberSession.account.id === memberAccountId &&
      memberSession.account.loginName === '妈妈',
    '登录响应提供账号、成员、访问令牌和轮换刷新令牌',
  );
  assert(
    initialMembers.body.data.every(
      (profile) =>
        !('accountId' in profile) &&
        !('passwordHash' in profile) &&
        !('pinHash' in profile),
    ),
    '家庭成员目录不泄露账号关联或凭据摘要',
  );
  assert(
    memberLogin.headers.get('cache-control') === 'no-store',
    '令牌响应明确禁止客户端或中间层缓存',
  );

  const preferenceOff = await request(
    '/members/me/preferences',
    chefToken,
    'PATCH',
    { prefersCooking: false },
  );
  const preferenceOn = await request(
    '/members/me/preferences',
    chefToken,
    'PATCH',
    { prefersCooking: true },
  );
  assert(
    preferenceOff.status === 200 &&
      preferenceOff.body.data.role === 'owner' &&
      preferenceOff.body.data.prefersCooking === false &&
      preferenceOn.body.data.prefersCooking === true,
    '掌勺偏好可独立修改且不改变家庭权限角色',
  );

  const payload = JSON.parse(
    Buffer.from(memberToken.split('.')[1], 'base64url').toString('utf8'),
  );
  assert(
    payload.memberId === member.id &&
      payload.accountId === memberAccountId &&
      payload.sub === memberAccountId &&
      payload.sub !== payload.memberId &&
      typeof payload.sid === 'string',
    'JWT 区分登录账号、当前家庭成员身份和服务端会话',
  );
  assert(payload.exp - payload.iat <= 900, '访问令牌有效期不超过 15 分钟');

  const sessionRow = await db.query(
    'SELECT "refreshTokenHash" FROM auth_sessions WHERE id = $1',
    [payload.sid],
  );
  assert(
    /^[a-f0-9]{64}$/.test(sessionRow.rows[0].refreshTokenHash) &&
      sessionRow.rows[0].refreshTokenHash !== memberRefreshToken,
    '数据库只保存刷新令牌的 SHA-256 哈希',
  );

  const firstRefresh = await request('/auth/refresh', null, 'POST', {
    refreshToken: memberRefreshToken,
  });
  const replayedRefresh = await request('/auth/refresh', null, 'POST', {
    refreshToken: memberRefreshToken,
  });
  assert(
    firstRefresh.status === 200 &&
      firstRefresh.body.data.refreshToken !== memberRefreshToken &&
      firstRefresh.headers.get('cache-control') === 'no-store' &&
      replayedRefresh.status === 401,
    '刷新令牌续期后立即轮换且旧令牌不能复用',
  );

  const concurrentRefreshes = await Promise.all([
    request('/auth/refresh', null, 'POST', {
      refreshToken: firstRefresh.body.data.refreshToken,
    }),
    request('/auth/refresh', null, 'POST', {
      refreshToken: firstRefresh.body.data.refreshToken,
    }),
  ]);
  const successfulRefresh = concurrentRefreshes.find(
    (response) => response.status === 200,
  );
  assert(
    concurrentRefreshes.filter((response) => response.status === 200).length === 1 &&
      concurrentRefreshes.filter((response) => response.status === 401).length === 1,
    '并发使用同一刷新令牌时只有一次续期成功',
  );
  memberToken = successfulRefresh.body.data.accessToken;
  memberRefreshToken = successfulRefresh.body.data.refreshToken;

  const parallelPasswordSession = (
    await request('/auth/login', null, 'POST', {
      loginName: '妈妈',
      password: 'member-password-2468',
    })
  ).body.data;
  const updatedPassword = await request(
    '/accounts/me/password',
    memberToken,
    'PATCH',
    {
      currentPassword: 'member-password-2468',
      newPassword: 'member-password-updated-8642',
    },
  );
  const currentAfterPasswordUpdate = await request('/dishes', memberToken);
  const parallelAfterPasswordUpdate = await request(
    '/dishes',
    parallelPasswordSession.accessToken,
  );
  const oldPasswordLogin = await request('/auth/login', null, 'POST', {
    loginName: '妈妈',
    password: 'member-password-2468',
  });
  assert(
    updatedPassword.status === 200 &&
      updatedPassword.body.data.requiresPasswordSetup === false &&
      currentAfterPasswordUpdate.status === 200 &&
      parallelAfterPasswordUpdate.status === 401 &&
      oldPasswordLogin.status === 401,
    '更新账号密码保留当前会话并撤销账号的其他会话',
  );

  const invalidMenuDate = await request('/menus?date=not-a-date', memberToken);
  const invalidMealType = await request(
    `/menus?date=${TEST_DATE}&mealType=midnight`,
    memberToken,
  );
  const missingShoppingDate = await request('/shopping-list', memberToken);
  assert(
    invalidMenuDate.status === 400 &&
      invalidMealType.status === 400 &&
      missingShoppingDate.status === 400,
    '无效日期或餐次会在访问数据库前返回 400',
  );

  const allowedCors = await request('/auth/login', null, 'OPTIONS', null, {
    Origin: 'http://localhost:8081',
    'Access-Control-Request-Method': 'POST',
  });
  const privateCors = await request('/auth/login', null, 'OPTIONS', null, {
    Origin: 'http://192.168.1.20:8081',
    'Access-Control-Request-Method': 'POST',
  });
  const deniedCors = await request('/auth/login', null, 'OPTIONS', null, {
    Origin: 'https://example.invalid',
    'Access-Control-Request-Method': 'POST',
  });
  assert(
    allowedCors.headers.get('access-control-allow-origin') === 'http://localhost:8081' &&
      privateCors.headers.get('access-control-allow-origin') ===
        'http://192.168.1.20:8081',
    '配置的本机和局域网 Web 来源可跨域访问',
  );
  assert(
    deniedCors.headers.get('access-control-allow-origin') == null,
    '未配置的 Web 来源不会获得跨域授权',
  );

  const dishesResponse = await request('/dishes', memberToken, 'GET', null, {
    'X-Request-ID': 'family-test-auth-0001',
  });
  assert(
    dishesResponse.headers.get('x-request-id') === 'family-test-auth-0001',
    '已登录请求保留调用方请求 ID',
  );
  const dishes = dishesResponse.body.data;
  assert(dishes.length >= 3, '一致性测试有足够菜品');
  const menuResponse = await request(
    `/menus?date=${TEST_DATE}&mealType=dinner`,
    memberToken,
  );
  const menu = menuResponse.body.data;
  const assignedMenu = await request(
    `/menus/${menu.id}/chef`,
    memberToken,
    'PATCH',
    { chefId: member.id },
    { 'X-Request-ID': 'family-test-route-0001' },
  );
  assert(
    assignedMenu.status === 200 && assignedMenu.body.data.chef.id === member.id,
    '本餐可以指定任意正式家庭成员为主厨',
  );

  const firstOrder = await request(
    `/menus/${menu.id}/items`,
    memberToken,
    'POST',
    { items: [{ dishId: dishes[0].id, note: '一致性测试' }] },
  );
  assert(firstOrder.status === 201, '普通成员可以点菜');
  assert(
    !('accountId' in firstOrder.body.data.chef) &&
      !('passwordHash' in firstOrder.body.data.chef) &&
      firstOrder.body.data.items.every(
        (item) =>
          !('accountId' in item.requestedBy) &&
          !('passwordHash' in item.requestedBy),
      ),
    '菜单成员关系不会泄露账号关联或密码哈希',
  );

  const duplicate = await request(
    `/menus/${menu.id}/items`,
    memberToken,
    'POST',
    { items: [{ dishId: dishes[0].id }] },
  );
  const duplicateBatch = await request(
    `/menus/${menu.id}/items`,
    memberToken,
    'POST',
    { items: [{ dishId: dishes[1].id }, { dishId: dishes[1].id }] },
  );
  assert(duplicate.status === 409 && duplicateBatch.status === 409, '重复点菜返回冲突');

  let currentMenu = (
    await request(`/menus?date=${TEST_DATE}&mealType=dinner`, memberToken)
  ).body.data;
  assert(
    currentMenu.items.filter((item) => item.status !== 'rejected').length === 1,
    '失败的批量点菜没有写入部分数据',
  );
  const firstItem = currentMenu.items.find(
    (item) => item.dishId === dishes[0].id && item.status !== 'rejected',
  );

  const memberStatus = await request(
    `/menu-items/${firstItem.id}`,
    memberToken,
    'PATCH',
    { status: 'accepted' },
  );
  const acceptedAgain = await request(
    `/menu-items/${firstItem.id}`,
    chefToken,
    'PATCH',
    { status: 'accepted' },
  );
  const skipped = await request(
    `/menu-items/${firstItem.id}`,
    chefToken,
    'PATCH',
    { status: 'done' },
  );
  assert(
    memberStatus.status === 200 &&
      memberStatus.body.data.assignedTo.id === member.id &&
      acceptedAgain.status === 200,
    '所有家庭成员都能认领菜品，认领人会被记录且重复提交保持幂等',
  );
  assert(skipped.status === 409, '不能跳过制作状态直接完成');

  const cooking = await request(
    `/menu-items/${firstItem.id}`,
    memberToken,
    'PATCH',
    { status: 'cooking' },
  );
  const done = await request(
    `/menu-items/${firstItem.id}`,
    chefToken,
    'PATCH',
    { status: 'done' },
  );
  assert(cooking.status === 200 && done.status === 200, '合法厨房状态转换成功');

  const secondOrder = await request(
    `/menus/${menu.id}/items`,
    memberToken,
    'POST',
    { items: [{ dishId: dishes[1].id }] },
  );
  const secondItem = secondOrder.body.data.items.find(
    (item) => item.dishId === dishes[1].id && item.status === 'pending',
  );
  const secondClaim = await request(
    `/menu-items/${secondItem.id}`,
    chefToken,
    'PATCH',
    { status: 'accepted' },
  );
  const missingReason = await request(
    `/menu-items/${secondItem.id}`,
    chefToken,
    'PATCH',
    { status: 'rejected' },
  );
  const rejected = await request(
    `/menu-items/${secondItem.id}`,
    chefToken,
    'PATCH',
    { status: 'rejected', reason: '临时调整菜单' },
  );
  assert(
    secondClaim.status === 200 &&
      secondClaim.body.data.assignedTo.id === chef.id &&
      missingReason.status === 400 &&
      rejected.status === 200 &&
      rejected.body.data.statusReason === '临时调整菜单',
    '已接单的菜必须填写原因才能划掉，并保留原因',
  );

  const menuEvents = await request(
    `/menus/${menu.id}/events`,
    memberToken,
  );
  assert(
    menuEvents.status === 200 &&
      menuEvents.body.data.some(
        (event) =>
          event.menuItemId === secondItem.id &&
          event.type === 'item_status_changed' &&
          event.toValue === 'rejected' &&
          event.reason === '临时调整菜单' &&
          event.actor.id === chef.id,
      ),
    '菜单历史记录操作人、状态、原因和时间',
  );
  const notifications = await request('/menu-notifications', memberToken);
  const notification = notifications.body.data.find(
    (event) => event.menuItemId === secondItem.id,
  );
  const genericNotifications = await request('/notifications', memberToken);
  const genericNotification = genericNotifications.body.data.find(
    (item) =>
      item.module === 'menu' &&
      item.type === 'menu_item_rejected' &&
      item.sourceId === notification?.id,
  );
  assert(
    notification && genericNotification,
    '点菜人同时通过兼容接口和通用通知收到划掉提醒',
  );
  const crossRead = await request(
    `/menu-notifications/${notification.id}/read`,
    chefToken,
    'PATCH',
  );
  const markedRead = await request(
    `/menu-notifications/${notification.id}/read`,
    memberToken,
    'PATCH',
  );
  const notificationsAfterRead = await request(
    '/menu-notifications',
    memberToken,
  );
  const genericAfterRead = await request('/notifications', memberToken);
  assert(
    notifications.status === 200 &&
      notification.reason === '临时调整菜单' &&
      crossRead.status === 404 &&
      markedRead.status === 200 &&
      !notificationsAfterRead.body.data.some(
        (event) => event.id === notification.id,
      ) &&
      !genericAfterRead.body.data.some(
        (item) => item.id === genericNotification.id,
      ),
    '划掉提醒只对点菜人可见且兼容与通用已读状态同步',
  );

  const restoredForGenericRead = await request(
    `/menu-items/${secondItem.id}`,
    memberToken,
    'PATCH',
    { status: 'pending' },
  );
  const claimedForGenericRead = await request(
    `/menu-items/${secondItem.id}`,
    chefToken,
    'PATCH',
    { status: 'accepted' },
  );
  const secondRejectedItem = await request(
    `/menu-items/${secondItem.id}`,
    chefToken,
    'PATCH',
    { status: 'rejected', reason: '验证通用通知已读同步' },
  );
  const unreadGenericAfterSecondRejection = await request(
    '/notifications',
    memberToken,
  );
  const secondGenericNotification = unreadGenericAfterSecondRejection.body.data.find(
    (item) =>
      item.module === 'menu' &&
      item.type === 'menu_item_rejected' &&
      item.sourceId !== genericNotification.sourceId,
  );
  const genericMarkedRead = secondGenericNotification
    ? await request(
        `/notifications/${secondGenericNotification.id}/read`,
        memberToken,
        'PATCH',
      )
    : { status: 0 };
  const legacyAfterGenericRead = await request(
    '/menu-notifications',
    memberToken,
  );
  assert(
    restoredForGenericRead.status === 200 &&
      claimedForGenericRead.status === 200 &&
      secondRejectedItem.status === 200 &&
      secondGenericNotification &&
      genericMarkedRead.status === 200 &&
      !legacyAfterGenericRead.body.data.some(
        (event) => event.id === secondGenericNotification.sourceId,
      ),
    '通用通知标记已读后兼容提醒同步为已读',
  );

  const restored = await request(
    `/menu-items/${secondItem.id}`,
    memberToken,
    'PATCH',
    { status: 'pending' },
  );
  assert(
    restored.status === 200 &&
      restored.body.data.status === 'pending',
    '划掉的菜可以恢复为待接单',
  );
  await request(`/menu-items/${secondItem.id}`, chefToken, 'PATCH', {
    status: 'rejected',
  });
  const reordered = await request(
    `/menus/${menu.id}/items`,
    memberToken,
    'POST',
    { items: [{ dishId: dishes[1].id }] },
  );
  assert(reordered.status === 201, '被拒绝后可以重新点同一道菜');
  const conflictingRestore = await request(
    `/menu-items/${secondItem.id}`,
    memberToken,
    'PATCH',
    { status: 'pending' },
  );
  assert(
    conflictingRestore.status === 409 &&
      conflictingRestore.body.error.message ===
        '已经重新点过这道菜，无需恢复旧记录',
    '已有新点菜记录时，恢复旧记录会返回明确冲突',
  );
  currentMenu = (
    await request(`/menus?date=${TEST_DATE}&mealType=dinner`, memberToken)
  ).body.data;
  assert(
    currentMenu.items.filter(
      (item) =>
        item.dishId === dishes[1].id && item.status !== 'rejected',
    ).length === 1,
    '恢复冲突后仍只有一条有效点菜记录',
  );

  const chefOrder = await request(
    `/menus/${menu.id}/items`,
    chefToken,
    'POST',
    { items: [{ dishId: dishes[2].id }] },
  );
  const chefItem = chefOrder.body.data.items.find(
    (item) => item.dishId === dishes[2].id && item.requestedBy.id === chef.id,
  );
  const crossNote = await request(
    `/menu-items/${chefItem.id}`,
    memberToken,
    'PATCH',
    { note: '不应写入' },
  );
  assert(crossNote.status === 403, '家庭成员不能修改其他人的点菜备注');

  const lockMenu = (
    await request(
      `/menus?date=${LOCK_TEST_DATE}&mealType=dinner`,
      memberToken,
    )
  ).body.data;
  const lockOrder = await request(
    `/menus/${lockMenu.id}/items`,
    memberToken,
    'POST',
    { items: [{ dishId: dishes[0].id }] },
  );
  const lockItem = lockOrder.body.data.items.find(
    (item) => item.dishId === dishes[0].id,
  );
  const prematureComplete = await request(
    `/menus/${lockMenu.id}/complete`,
    memberToken,
    'POST',
  );
  await request(`/menus/${lockMenu.id}/chef`, memberToken, 'PATCH', {
    chefId: chef.id,
  });
  await request(`/menu-items/${lockItem.id}`, chefToken, 'PATCH', {
    status: 'accepted',
  });
  await request(`/menu-items/${lockItem.id}`, chefToken, 'PATCH', {
    status: 'cooking',
  });
  const cookingCancellationWithoutReason = await request(
    `/menu-items/${lockItem.id}`,
    memberToken,
    'PATCH',
    { status: 'rejected' },
  );
  await request(`/menu-items/${lockItem.id}`, chefToken, 'PATCH', {
    status: 'done',
  });
  const completedMenu = await request(
    `/menus/${lockMenu.id}/complete`,
    memberToken,
    'POST',
  );
  assert(
    prematureComplete.status === 409 &&
      cookingCancellationWithoutReason.status === 400 &&
      completedMenu.status === 201 &&
      completedMenu.body.data.status === 'done' &&
      completedMenu.body.data.completedBy.id === member.id,
    '全部有效菜品上桌后才能结束本餐，制作中取消也必须填写原因',
  );

  const lockedAdd = await request(
    `/menus/${lockMenu.id}/items`,
    memberToken,
    'POST',
    { items: [{ dishId: dishes[1].id }] },
  );
  const lockedUpdate = await request(
    `/menu-items/${lockItem.id}`,
    memberToken,
    'PATCH',
    { note: '不应写入' },
  );
  const lockedChef = await request(
    `/menus/${lockMenu.id}/chef`,
    memberToken,
    'PATCH',
    { chefId: null },
  );
  const lockEvents = await request(
    `/menus/${lockMenu.id}/events`,
    memberToken,
  );
  assert(
    lockedAdd.status === 409 &&
      lockedUpdate.status === 409 &&
      lockedChef.status === 409 &&
      lockEvents.body.data.some((event) => event.type === 'menu_completed'),
    '结束后菜单、菜品状态和主厨均锁定，完成动作保留在历史中',
  );

  const dishBefore = dishes.find((dish) => dish.ingredients.length >= 1);
  const ingredientsBefore = comparableIngredients(dishBefore);
  const failedDishUpdate = await request(
    `/dishes/${dishBefore.id}`,
    chefToken,
    'PATCH',
    {
      note: `不应保存-${randomUUID()}`,
      ingredients: [
        {
          ingredientId: dishBefore.ingredients[0].ingredientId,
          quantity: Number(dishBefore.ingredients[0].quantity),
          unit: dishBefore.ingredients[0].unit,
        },
        { ingredientId: randomUUID(), quantity: 1, unit: '份' },
      ],
    },
  );
  const dishAfter = (
    await request('/dishes', memberToken)
  ).body.data.find((dish) => dish.id === dishBefore.id);
  assert(failedDishUpdate.status === 404, '无效食材会让菜谱更新失败');
  assert(
    dishAfter.note === dishBefore.note &&
      JSON.stringify(comparableIngredients(dishAfter)) ===
        JSON.stringify(ingredientsBefore),
    '菜谱更新失败后正文和食材完整回滚',
  );

  const householdId = member.householdId;
  testHouseholdId = householdId;
  const transactionIngredient = dishes
    .flatMap((dish) => dish.ingredients)
    .find((item) => !item.ingredient.isPantryStaple);
  assert(transactionIngredient, '找到会进入购物清单的非库存常备食材');
  const ingredientId = transactionIngredient.ingredientId;
  await db.query(
    `INSERT INTO dishes (id, "householdId", name, category)
     VALUES ($1, $3, '事务测试菜一', '素菜'), ($2, $3, '事务测试菜二', '素菜')`,
    [...transactionIds.dishes, householdId],
  );
  await db.query(
    `INSERT INTO dish_ingredients ("dishId", "ingredientId", quantity, unit)
     VALUES ($1, $3, 99999999.99, '测试单位'), ($2, $3, 99999999.99, '测试单位')`,
    [...transactionIds.dishes, ingredientId],
  );
  await db.query(
    `INSERT INTO menus (id, "householdId", date, "mealType")
     VALUES ($1, $2, $3, 'dinner')`,
    [transactionIds.menu, householdId, SHOPPING_TRANSACTION_DATE],
  );
  await db.query(
    `INSERT INTO menu_items ("menuId", "dishId", "requestedById", status)
     VALUES ($1, $2, $4, 'accepted'), ($1, $3, $4, 'accepted')`,
    [transactionIds.menu, ...transactionIds.dishes, chef.id],
  );
  await db.query(
    `INSERT INTO shopping_items
       (id, "householdId", date, "ingredientId", "totalQty", unit, checked, source)
     VALUES ($1, $2, $3, $4, 1, '测试单位', true, 'auto')`,
    [
      transactionIds.shoppingItem,
      householdId,
      SHOPPING_TRANSACTION_DATE,
      ingredientId,
    ],
  );
  const failedShoppingGeneration = await request(
    '/shopping-list/generate',
    chefToken,
    'POST',
    { date: SHOPPING_TRANSACTION_DATE },
    { 'X-Request-ID': 'family-test-error-5001' },
  );
  const preservedShoppingItem = await db.query(
    'SELECT checked FROM shopping_items WHERE id = $1',
    [transactionIds.shoppingItem],
  );
  assert(
    failedShoppingGeneration.status === 500 &&
      failedShoppingGeneration.headers.get('x-request-id') ===
        'family-test-error-5001' &&
      failedShoppingGeneration.body.requestId === 'family-test-error-5001',
    '采购数量溢出返回带请求 ID 的 500 错误',
  );
  assert(
    preservedShoppingItem.rows[0]?.checked === true,
    '购物清单重建失败后旧清单及勾选状态完整回滚',
  );

  currentMenu = (
    await request(`/menus?date=${TEST_DATE}&mealType=dinner`, memberToken)
  ).body.data;
  assert(currentMenu.items.some((item) => item.status === 'done'), '菜单最终状态可重新读取');

  const crossSessionLogout = await request(
    '/auth/logout',
    chefToken,
    'POST',
    { sessionId: payload.sid },
  );
  const memberAfterCrossLogout = await request('/dishes', memberToken);
  const chefAfterLogout = await request('/dishes', chefToken);
  assert(
    crossSessionLogout.status === 200 &&
      memberAfterCrossLogout.status === 200 &&
      chefAfterLogout.status === 401,
    '登出只能撤销当前成员会话，不能指定并撤销其他成员会话',
  );

  const memberLogout = await request('/auth/logout', memberToken, 'POST');
  const accessAfterLogout = await request('/dishes', memberToken);
  const refreshAfterLogout = await request('/auth/refresh', null, 'POST', {
    refreshToken: memberRefreshToken,
  });
  assert(
    memberLogout.status === 200 &&
      accessAfterLogout.status === 401 &&
      refreshAfterLogout.status === 401,
    '登出后访问令牌和刷新令牌都立即失效',
  );

  const roleSession = (
    await request('/auth/login', null, 'POST', {
      loginName: '妈妈',
      password: 'member-password-updated-8642',
    })
  ).body.data;
  await db.query(`UPDATE members SET role = 'admin' WHERE id = $1`, [member.id]);
  const changedRoleAccess = await request('/dishes', roleSession.accessToken);
  await db.query(`UPDATE members SET role = 'member' WHERE id = $1`, [member.id]);
  const restoredRoleAccess = await request('/dishes', roleSession.accessToken);
  const changedRoleRefresh = await request('/auth/refresh', null, 'POST', {
    refreshToken: roleSession.refreshToken,
  });
  assert(
    changedRoleAccess.status === 401 &&
      restoredRoleAccess.status === 401 &&
      changedRoleRefresh.status === 401,
    '角色变化会永久撤销旧会话，恢复原角色也必须重新登录',
  );

  const credentialSession = (
    await request('/auth/login', null, 'POST', {
      loginName: '妈妈',
      password: 'member-password-updated-8642',
    })
  ).body.data;
  const temporaryPassword = await db.query(
    'SELECT "passwordHash" FROM accounts WHERE id = $1',
    [memberAccountId],
  );
  await db.query('UPDATE accounts SET "passwordHash" = $1 WHERE id = $2', [
    await bcrypt.hash('changed-password-1357', 12),
    memberAccountId,
  ]);
  const changedCredentialAccess = await request(
    '/dishes',
    credentialSession.accessToken,
  );
  await db.query('UPDATE accounts SET "passwordHash" = $1 WHERE id = $2', [
    temporaryPassword.rows[0].passwordHash,
    memberAccountId,
  ]);
  const restoredCredentialAccess = await request(
    '/dishes',
    credentialSession.accessToken,
  );
  const changedCredentialRefresh = await request('/auth/refresh', null, 'POST', {
    refreshToken: credentialSession.refreshToken,
  });
  assert(
    changedCredentialAccess.status === 401 &&
      restoredCredentialAccess.status === 401 &&
      changedCredentialRefresh.status === 401,
    '账号密码变化会永久撤销旧会话',
  );

  console.log('\n认证、安全与业务一致性测试全部通过');
} finally {
  if (testHouseholdId) {
    await db.query(
      'DELETE FROM shopping_items WHERE "householdId" = $1 AND date = $2',
      [testHouseholdId, SHOPPING_TRANSACTION_DATE],
    );
  }
  await db.query('DELETE FROM menus WHERE id = $1', [transactionIds.menu]);
  await db.query('DELETE FROM dishes WHERE id = ANY($1::uuid[])', [
    transactionIds.dishes,
  ]);
  await db.query(
    `DELETE FROM menus WHERE "householdId" = (
       SELECT "householdId" FROM members WHERE id = $1
     ) AND date IN ($2, $3)`,
    [memberId, TEST_DATE, LOCK_TEST_DATE],
  );
  if (memberId) {
    await db.query('UPDATE members SET role = $1 WHERE id = $2', [
      originalRole,
      memberId,
    ]);
  }
  if (memberAccountId) {
    await db.query('UPDATE accounts SET "passwordHash" = $1 WHERE id = $2', [
      originalPasswordHash,
      memberAccountId,
    ]);
  }
  await db.end();
}
