/**
 * 造一套像样的家庭演示数据（走 HTTP，不直插库——业务规则、幂等、通知都由 API 自己保证）。
 *
 *   API_URL=http://localhost:8088/api node scripts/demo-data.mjs     # 本机演示栈
 *   corepack pnpm demo                                                  # 同上（根脚本）
 *
 * 幂等：每类数据先查有没有同名记录，有就跳过；连跑两次不会翻倍。
 * 日期全部相对「今天」，所以任何时候跑出来都是「未来两周有安排、有一条快过期、有一条待提醒」的状态。
 * 前置：seed.ts 已经建好家庭、爸爸 / 妈妈两个账号和基础菜品。
 */
import { randomUUID } from 'node:crypto';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.DEMO_PASSWORD || process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

function log(message) {
  console.log(`  ${message}`);
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
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json?.error ?? json)}`);
  }
  return json?.data;
}

async function login(loginName) {
  const session = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  return { token: session.accessToken, member: session.member, name: loginName };
}

// ---- 日期工具（本机时区） -----------------------------------------------------

function dateOnly(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function atTime(offsetDays, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function monthPrefix() {
  return dateOnly(0).slice(0, 7);
}

/** 列表里有同名的就复用，没有再建。 */
async function ensure(label, list, matches, create) {
  const existing = list.find(matches);
  if (existing) {
    log(`· ${label}（已有）`);
    return existing;
  }
  const created = await create();
  log(`✓ ${label}`);
  return created;
}

const dad = await login('爸爸');
const mom = await login('妈妈');
const members = await request('/members', dad.token);
const byName = Object.fromEntries(members.map((member) => [member.name, member]));

// ---- 日历 ---------------------------------------------------------------------
console.log('日历');
{
  const range = `start=${dateOnly(-1)}&end=${dateOnly(30)}`;
  const existing = await request(`/calendar?${range}`, dad.token);
  const titles = new Set(existing.map((entry) => entry.title));
  const events = [
    [1, '奶奶生日', null, null, '提前订蛋糕', mom],
    [2, '家长会', [15, 0], [16, 30], '在三年级二班教室', mom],
    [3, '物业上门检查', [10, 0], null, '看一下厨房下水', dad],
    [5, '周末家庭聚餐', [18, 0], [20, 30], '去年那家湘菜馆', dad],
    [6, '去公园放风筝', [9, 30], null, null, mom],
    [8, '换季整理衣柜', null, null, '把夏天衣服收起来', mom],
    [10, '牙医复诊', [14, 0], [15, 0], '带上上次的病历本', dad],
    [13, '交水电费', null, null, null, dad],
    [16, '爸爸出差', null, null, '三天，周四回', dad],
  ];
  for (const [offset, title, start, end, note, who] of events) {
    if (titles.has(title)) {
      log(`· ${title}（已有）`);
      continue;
    }
    await request('/calendar-events', who.token, 'POST', {
      date: dateOnly(offset),
      title,
      note,
      startsAt: start ? atTime(offset, ...start) : null,
      endsAt: end ? atTime(offset, ...end) : null,
    });
    log(`✓ ${title}`);
  }
}

// ---- 点菜：今天晚餐、明天晚餐；妈妈划掉爸爸一道菜，给爸爸造一条未读通知 ----------
console.log('点菜');
{
  const dishes = await request('/dishes', dad.token);
  const pick = (names) =>
    names.map((name) => dishes.find((dish) => dish.name === name) ?? null).filter(Boolean);
  const plan = [
    { offset: 0, mealType: 'dinner', dad: ['番茄炒蛋', '红烧肉', '蒜蓉西兰花'], mom: ['紫菜蛋花汤'] },
    { offset: 1, mealType: 'dinner', dad: ['可乐鸡翅', '清炒土豆丝'], mom: ['麻婆豆腐', '凉拌黄瓜'] },
  ];
  for (const { offset, mealType, dad: dadDishes, mom: momDishes } of plan) {
    const date = dateOnly(offset);
    const menu = await request(`/menus?date=${date}&mealType=${mealType}`, dad.token);
    if (menu.items.length) {
      log(`· ${date} 晚餐已有 ${menu.items.length} 道（已有）`);
      continue;
    }
    const fallback = dishes.slice(0, 6);
    const dadPick = pick(dadDishes).length ? pick(dadDishes) : fallback.slice(0, 3);
    const momPick = pick(momDishes).length ? pick(momDishes) : fallback.slice(3, 5);
    await request(`/menus/${menu.id}/items`, dad.token, 'POST', {
      items: dadPick.map((dish, index) => ({
        dishId: dish.id,
        note: index === 0 ? '少放辣' : undefined,
      })),
    });
    const withMom = await request(`/menus/${menu.id}/items`, mom.token, 'POST', {
      items: momPick.map((dish) => ({ dishId: dish.id })),
    });
    log(`✓ ${date} 晚餐点了 ${withMom.items.length} 道`);
    if (offset === 1) {
      const target = withMom.items.find((item) => item.requestedById === dad.member.id);
      if (target) {
        await request(`/menu-items/${target.id}`, mom.token, 'PATCH', {
          status: 'rejected',
          reason: '家里没有材料了，换一道吧',
        });
        log(`✓ 妈妈划掉了「${target.dish.name}」（爸爸会收到一条通知）`);
      }
    }
  }
}

// ---- 库存 + 批次 ---------------------------------------------------------------
console.log('库存');
const inventoryItems = await request('/inventory', dad.token);
const inventory = {};
for (const body of [
  { name: '大米', category: '主食', quantity: 5, unit: '斤', lowStockThreshold: 2, restockQuantity: 10 },
  { name: '生抽', category: '调料', quantity: 1, unit: '瓶', lowStockThreshold: 1, restockQuantity: 2 },
  { name: '牛奶', category: '饮料', quantity: 4, unit: '盒', lowStockThreshold: 2, restockQuantity: 12 },
  { name: '鸡蛋', category: '其他', quantity: 6, unit: '个', lowStockThreshold: 6, restockQuantity: 30 },
  { name: '抽纸', category: '日用品', quantity: 1, unit: '包', lowStockThreshold: 2, restockQuantity: 6 },
  { name: '感冒灵', category: '药品', quantity: 1, unit: '盒', lowStockThreshold: 1, restockQuantity: 1 },
]) {
  inventory[body.name] = await ensure(
    body.name,
    inventoryItems,
    (item) => item.name === body.name,
    () => request('/inventory-items', dad.token, 'POST', body),
  );
}
{
  const batches = await request('/inventory-batches?status=all', dad.token);
  for (const [name, quantity, receivedOn, expiresOn, key] of [
    ['牛奶', 4, dateOnly(-4), dateOnly(3), 'demo-batch-milk'],
    ['鸡蛋', 6, dateOnly(-20), dateOnly(-1), 'demo-batch-egg'],
  ]) {
    const item = inventory[name];
    await ensure(
      `${name}批次（${expiresOn} 到期）`,
      batches,
      (batch) => batch.inventoryItemId === item.id,
      () =>
        request('/inventory-batches', dad.token, 'POST', {
          inventoryItemId: item.id,
          quantity,
          receivedOn,
          expiresOn,
          idempotencyKey: key,
        }),
    );
  }
}

// ---- 购物清单 -----------------------------------------------------------------
console.log('购物清单');
{
  const today = dateOnly(0);
  const list = await request(`/shopping-list?date=${today}`, dad.token);
  for (const [customName, totalQty, unit] of [
    ['垃圾袋', 2, '卷'],
    ['洗洁精', 1, '瓶'],
    ['五号电池', 4, '节'],
  ]) {
    await ensure(
      customName,
      list,
      (item) => (item.customName ?? item.name) === customName,
      () => request('/shopping-items', dad.token, 'POST', { date: today, customName, totalQty, unit }),
    );
  }
}

// ---- 任务 ---------------------------------------------------------------------
console.log('任务');
{
  const occurrences = await request(`/tasks?start=${dateOnly(0)}&end=${dateOnly(14)}`, dad.token);
  const titles = new Set(occurrences.map((row) => row.task.title));
  const tasks = [
    { title: '倒垃圾', startsOn: dateOnly(0), recurrence: 'daily', who: mom },
    { title: '给阳台的花浇水', startsOn: dateOnly(1), recurrence: 'weekly', who: mom },
    { title: '交物业费', startsOn: dateOnly(7), recurrence: 'once', who: dad, rewardPoints: 10 },
    { title: '整理书架', startsOn: dateOnly(0), recurrence: 'once', who: dad, done: true },
  ];
  for (const { who, done, ...body } of tasks) {
    if (titles.has(body.title)) {
      log(`· ${body.title}（已有）`);
      continue;
    }
    const task = await request('/tasks', who.token, 'POST', body);
    if (done) {
      await request(`/tasks/${task.id}/instances/${body.startsOn}`, who.token, 'PATCH', { status: 'done' });
    }
    log(`✓ ${body.title}${done ? '（已完成）' : ''}`);
  }
}

// ---- 提醒 ---------------------------------------------------------------------
console.log('提醒');
{
  const reminders = await request('/reminders?status=scheduled', dad.token);
  const sources = await request(
    `/reminder-sources?start=${dateOnly(0)}&end=${dateOnly(30)}`,
    dad.token,
  );
  for (const [title, hour] of [
    ['家长会', 8],
    ['牙医复诊', 9],
  ]) {
    // 家庭事件在来源列表里 module 是 calendar，日期在 date 字段（occurrenceDate 只有周期任务才有）
    const source = sources.find((one) => one.title === title && one.module === 'calendar');
    if (!source?.date) {
      log(`· ${title} 没找到来源，跳过`);
      continue;
    }
    await ensure(
      `提醒「${title}」`,
      reminders,
      (one) => one.sourceId === source.sourceId,
      () =>
        request('/reminders', dad.token, 'POST', {
          sourceModule: 'calendar',
          sourceId: source.sourceId,
          occurrenceDate: source.occurrenceDate ?? undefined,
          remindAt: new Date(`${source.date}T${String(hour).padStart(2, '0')}:00:00`).toISOString(),
          recipientIds: [dad.member.id, mom.member.id],
        }),
    );
  }
}

// ---- 投票 ---------------------------------------------------------------------
console.log('投票');
{
  const polls = await request('/polls?status=all', mom.token);
  const poll = await ensure(
    '周末去哪儿玩',
    polls,
    (one) => one.title === '周末去哪儿玩',
    () =>
      request('/polls', mom.token, 'POST', {
        title: '周末去哪儿玩',
        description: '可以选两个，票多的先去',
        category: 'activity',
        voteMode: 'multiple',
        maxChoices: 2,
        closesAt: atTime(5, 20),
        options: [{ label: '公园野餐' }, { label: '自然博物馆' }, { label: '爬山' }],
      }),
  );
  const momVoted = poll.options.some((option) =>
    option.voters?.some((voter) => voter.id === mom.member.id),
  );
  if (!momVoted) {
    await request(`/polls/${poll.id}/votes`, mom.token, 'POST', {
      optionIds: [poll.options[0].id, poll.options[2].id],
    });
    log('✓ 妈妈投了两票');
  }
}

// ---- 积分与奖励 -----------------------------------------------------------------
console.log('积分');
{
  const rewards = await request('/rewards', dad.token);
  for (const body of [
    { name: '周末点一次外卖', description: '想吃什么点什么', cost: 40 },
    { name: '睡前多看半小时动画', cost: 20 },
  ]) {
    await ensure(body.name, rewards, (one) => one.name === body.name, () =>
      request('/rewards', dad.token, 'POST', body),
    );
  }
  const ledger = await request('/points/ledger?limit=200', dad.token);
  const grants = [
    ['妈妈', 50, '上周家务全包'],
    ['爸爸', 30, '修好了卫生间的灯'],
  ];
  for (const [name, delta, note] of grants) {
    const member = byName[name];
    if (!member) continue;
    await ensure(
      `${name} +${delta}`,
      ledger,
      (row) => row.note === note,
      () =>
        request('/points/adjustments', dad.token, 'POST', {
          memberId: member.id,
          delta,
          note,
          idempotencyKey: `demo-points-${name}-${delta}`,
        }),
    );
  }
}

// ---- 资产与维护 -----------------------------------------------------------------
console.log('资产');
{
  const assets = await request('/assets?status=all', dad.token);
  const airCon = await ensure('客厅空调', assets, (one) => one.name === '客厅空调', () =>
    request('/assets', dad.token, 'POST', {
      name: '客厅空调',
      category: 'appliance',
      location: '客厅',
      brand: '格力',
      purchaseDate: dateOnly(-400),
      purchasePrice: 3299,
      warrantyExpiresOn: dateOnly(330),
    }),
  );
  await ensure('厨房冰箱', assets, (one) => one.name === '厨房冰箱', () =>
    request('/assets', dad.token, 'POST', {
      name: '厨房冰箱',
      category: 'appliance',
      location: '厨房',
      purchaseDate: dateOnly(-900),
      purchasePrice: 4599,
      warrantyExpiresOn: dateOnly(-170),
    }),
  );
  await ensure('视频网站会员', assets, (one) => one.name === '视频网站会员', () =>
    request('/assets', dad.token, 'POST', {
      name: '视频网站会员',
      category: 'subscription',
      renewsOn: dateOnly(20),
      renewalIntervalMonths: 1,
      purchasePrice: 25,
    }),
  );
  const plans = (await request(`/assets/${airCon.id}`, dad.token)).maintenancePlans ?? [];
  await ensure('空调滤网清洗计划', plans, (one) => one.title === '清洗滤网', () =>
    request(`/assets/${airCon.id}/maintenance-plans`, dad.token, 'POST', {
      title: '清洗滤网',
      frequencyDays: 90,
      nextDueDate: dateOnly(10),
      note: '拆下来用清水冲，晾干再装回去',
    }),
  );
}

// ---- 知识库 -------------------------------------------------------------------
console.log('知识库');
{
  const articles = await request('/knowledge-articles', dad.token);
  for (const body of [
    {
      title: '路由器断网了怎么办',
      category: 'appliance',
      summary: '先重启，再看光猫',
      content: '1. 拔掉路由器电源等 10 秒再插上\n2. 还不行就把光猫也重启\n3. 光猫「LOS」灯红了打运营商电话',
      tags: ['网络', '路由器'],
      isPinned: true,
      who: dad,
    },
    {
      title: '物业和常用电话',
      category: 'contact',
      content: '物业前台：0571-8888-0000\n水管维修：老王 138-0000-0000\n家附近的诊所：周一到周六 8:00-20:00',
      tags: ['电话'],
      who: mom,
    },
    {
      title: '垃圾分类和投放时间',
      category: 'home',
      content: '厨余：绿色桶，早 7-9 点、晚 6-8 点\n可回收：蓝色桶，随时\n有害：红色桶，每月 15 号小区门口',
      who: mom,
    },
  ]) {
    const { who, ...article } = body;
    await ensure(article.title, articles, (one) => one.title === article.title, () =>
      request('/knowledge-articles', who.token, 'POST', { ...article, idempotencyKey: randomUUID() }),
    );
  }
}

// ---- 回忆 ---------------------------------------------------------------------
console.log('回忆');
{
  const memories = await request('/memories', dad.token);
  for (const body of [
    {
      title: '第一次全家露营',
      happenedOn: dateOnly(-60),
      category: 'travel',
      story: '大家一起搭好帐篷，晚上看到了很亮的星星。',
      tags: ['露营', '周末'],
    },
    {
      title: '学会骑自行车了',
      happenedOn: dateOnly(-20),
      category: 'milestone',
      story: '摔了两次，第三次就自己骑出去了。',
    },
  ]) {
    await ensure(body.title, memories, (one) => one.title === body.title, () =>
      request('/memories', mom.token, 'POST', { ...body, idempotencyKey: randomUUID() }),
    );
  }
}

// ---- 出行 ---------------------------------------------------------------------
console.log('出行');
{
  const plans = await request('/travel-plans', dad.token);
  const trip = await ensure('国庆回老家', plans, (one) => one.title === '国庆回老家', () =>
    request('/travel-plans', dad.token, 'POST', {
      title: '国庆回老家',
      destination: '老家',
      startDate: dateOnly(15),
      endDate: dateOnly(20),
      note: '高铁票已经买了，早上 8 点的车',
      idempotencyKey: randomUUID(),
    }),
  );
  const detail = await request(`/travel-plans/${trip.id}`, dad.token);
  const items = detail.items ?? [];
  for (const body of [
    { title: '身份证和户口本', category: 'documents' },
    { title: '手机充电器', category: 'electronics', quantity: 2 },
    { title: '换洗衣物', category: 'clothing', quantity: 3, assignedMemberId: mom.member.id },
    { title: '给爷爷奶奶的礼物', category: 'other' },
  ]) {
    await ensure(body.title, items, (one) => one.title === body.title, () =>
      request(`/travel-plans/${trip.id}/items`, dad.token, 'POST', { ...body, idempotencyKey: randomUUID() }),
    );
  }
}

// ---- 财务（管理员） -------------------------------------------------------------
console.log('财务');
{
  const accounts = await request('/finance/accounts', dad.token);
  const cash = await ensure('家庭现金', accounts, (one) => one.name === '家庭现金', () =>
    request('/finance/accounts', dad.token, 'POST', { name: '家庭现金', type: 'cash', openingBalance: 500 }),
  );
  const bank = await ensure('家庭银行卡', accounts, (one) => one.name === '家庭银行卡', () =>
    request('/finance/accounts', dad.token, 'POST', { name: '家庭银行卡', type: 'bank', openingBalance: 8000 }),
  );
  const categories = await request('/finance/categories', dad.token);
  const category = (key, fallbackType) =>
    categories.find((one) => one.systemKey === key) ??
    categories.find((one) => one.type === fallbackType);
  const month = monthPrefix();
  const transactions = await request(`/finance/transactions?month=${month}&limit=200`, dad.token);
  for (const body of [
    { type: 'expense', amount: 86.5, accountId: cash.id, categoryId: category('expense_food', 'expense')?.id, title: '菜市场买菜', occurredOn: dateOnly(-1) },
    { type: 'expense', amount: 268, accountId: bank.id, categoryId: category('expense_shopping', 'expense')?.id, title: '超市采购', occurredOn: dateOnly(-3) },
    { type: 'expense', amount: 156.2, accountId: bank.id, categoryId: category('expense_home', 'expense')?.id, title: '水电燃气', occurredOn: dateOnly(-5) },
    { type: 'income', amount: 12000, accountId: bank.id, categoryId: category('income_salary', 'income')?.id, title: '工资', occurredOn: dateOnly(-8) },
    { type: 'expense', amount: 45, accountId: cash.id, categoryId: category('expense_food', 'expense')?.id, title: '早点', occurredOn: dateOnly(-2) },
  ]) {
    if (!body.categoryId) continue;
    await ensure(body.title, transactions, (one) => one.title === body.title, () =>
      request('/finance/transactions', dad.token, 'POST', { ...body, idempotencyKey: randomUUID() }),
    );
  }
}

// ---- 访客 ---------------------------------------------------------------------
console.log('访客');
{
  const guests = await request('/guests', dad.token);
  const guest = await ensure('小林', guests, (one) => one.name === '小林', () =>
    request('/guests', dad.token, 'POST', { name: '小林', avatarEmoji: '🪴', note: '不吃香菜' }),
  );
  const wifis = await request('/guest-wifi-profiles', dad.token);
  const wifi = await ensure('访客 Wi-Fi', wifis, (one) => one.name === '家里的访客网络', () =>
    request('/guest-wifi-profiles', dad.token, 'POST', {
      name: '家里的访客网络',
      ssid: 'Family-Guest',
      security: 'WPA',
      password: 'welcome-2468',
    }),
  );
  const visits = await request('/visits', dad.token);
  await ensure('小林来吃饭', visits, (one) => one.title === '小林来吃饭', () =>
    request('/visits', dad.token, 'POST', {
      title: '小林来吃饭',
      startsAt: atTime(12, 18, 30),
      endsAt: atTime(12, 21, 0),
      note: '记得提前买菜',
      guestIds: [guest.id],
      guestWifiProfileId: wifi.id,
    }),
  );
}

console.log('演示数据就绪 ✓');
