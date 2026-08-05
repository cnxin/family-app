import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const today = new Date().toISOString().slice(0, 10);
const account = {
  id: 'account-food-batch-fixture',
  loginName: 'food-batch-fixture',
  requiresPasswordSetup: false,
};
const member = {
  id: 'member-food-batch-fixture',
  householdId: 'household-food-batch-fixture',
  name: '爸爸',
  avatarEmoji: '爸',
  role: 'owner',
  prefersCooking: true,
};
const inventoryItem = {
  id: 'inventory-food-batch-fixture',
  householdId: member.householdId,
  ingredientId: 'ingredient-food-batch-fixture',
  ingredient: {
    id: 'ingredient-food-batch-fixture',
    name: '番茄',
    category: '蔬菜',
    defaultUnit: '份',
    isPantryStaple: false,
  },
  name: '番茄库存',
  category: '其他',
  quantity: '5',
  unit: '份',
  lowStockThreshold: '1',
  restockQuantity: '2',
  batchSummary: {
    trackedQuantity: 3,
    untrackedQuantity: 2,
    activeBatchCount: 2,
    earliestExpiresOn: today,
    expiringCount: 1,
    expiredCount: 1,
  },
  createdAt: `${today}T08:00:00.000Z`,
  updatedAt: `${today}T08:00:00.000Z`,
};
const batches = [
  {
    id: 'batch-expired-fixture',
    householdId: member.householdId,
    inventoryItemId: inventoryItem.id,
    inventoryItem,
    quantity: '1',
    receivedOn: '2026-07-20',
    productionDate: '2026-07-19',
    expiresOn: '2026-08-04',
    openedOn: '2026-08-01',
    sourceType: 'manual',
    sourceId: 'batch-expired-fixture',
    version: 1,
    createdById: member.id,
    createdBy: member,
    createdAt: `${today}T08:00:00.000Z`,
    updatedAt: `${today}T08:00:00.000Z`,
    status: 'expired',
    daysRemaining: -1,
  },
  {
    id: 'batch-expiring-fixture',
    householdId: member.householdId,
    inventoryItemId: inventoryItem.id,
    inventoryItem,
    quantity: '2',
    receivedOn: '2026-08-04',
    productionDate: '2026-08-03',
    expiresOn: '2026-08-07',
    openedOn: null,
    sourceType: 'shopping_item',
    sourceId: 'shopping-batch-fixture',
    version: 1,
    createdById: member.id,
    createdBy: member,
    createdAt: `${today}T09:00:00.000Z`,
    updatedAt: `${today}T09:00:00.000Z`,
    status: 'expiring',
    daysRemaining: 2,
  },
];

const candidates = [
  {
    id: 'smart-candidate-tomato',
    householdId: member.householdId,
    planId: 'smart-plan-fixture',
    dishId: 'dish-tomato-fixture',
    dish: { id: 'dish-tomato-fixture', name: '番茄炖菜' },
    recipeVariantId: 'recipe-tomato-fixture',
    recipeVariant: { id: 'recipe-tomato-fixture', name: '家庭默认' },
    targetDate: '2026-08-10',
    mealType: 'dinner',
    score: 52,
    reasons: ['优先使用番茄等临期食材', '家中主要食材已经齐备', '家中有人擅长这道菜'],
    expiringIngredients: [
      {
        ingredientId: inventoryItem.ingredientId,
        name: '番茄',
        expiresOn: '2026-08-07',
        daysRemaining: 2,
      },
    ],
    pollOptionId: 'poll-option-tomato',
    adoptedMenuId: null,
    sortOrder: 0,
    voteCount: 2,
  },
  {
    id: 'smart-candidate-soup',
    householdId: member.householdId,
    planId: 'smart-plan-fixture',
    dishId: 'dish-soup-fixture',
    dish: { id: 'dish-soup-fixture', name: '豆腐汤' },
    recipeVariantId: 'recipe-soup-fixture',
    recipeVariant: { id: 'recipe-soup-fixture', name: '家庭默认' },
    targetDate: '2026-08-11',
    mealType: 'dinner',
    score: 24,
    reasons: ['家中主要食材已经齐备', '近两周没有重复'],
    expiringIngredients: [],
    pollOptionId: 'poll-option-soup',
    adoptedMenuId: null,
    sortOrder: 1,
    voteCount: 0,
  },
];

function plan(status: 'voting' | 'adopted') {
  return {
    id: 'smart-plan-fixture',
    householdId: member.householdId,
    startsOn: '2026-08-10',
    endsOn: '2026-08-16',
    status,
    pollId: 'poll-smart-menu-fixture',
    createdById: member.id,
    createdBy: member,
    idempotencyKey: 'smart-plan-fixture-key',
    adoptedById: status === 'adopted' ? member.id : null,
    adoptedBy: status === 'adopted' ? member : null,
    adoptedAt: status === 'adopted' ? `${today}T10:00:00.000Z` : null,
    createdAt: `${today}T08:00:00.000Z`,
    updatedAt: `${today}T08:00:00.000Z`,
    candidates: candidates.map((candidate, index) => ({
      ...candidate,
      adoptedMenuId: status === 'adopted' && index === 0 ? 'menu-adopted-fixture' : null,
    })),
    pollStatus: 'closed',
    canCreatePoll: false,
    canAdopt: status === 'voting',
    adoptedCount: status === 'adopted' ? 1 : 0,
  };
}

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: 'application/json',
    status,
  });
}

async function installFixture(page: Page) {
  let smartPlan = plan('voting');
  await page.addInitScript(
    ({ accountFixture, memberFixture }) => {
      window.localStorage.setItem('family-app-token', 'food-batch-token');
      window.localStorage.setItem('family-app-refresh-token', 'food-batch-refresh-token');
      window.localStorage.setItem('family-app-account', JSON.stringify(accountFixture));
      window.localStorage.setItem('family-app-member', JSON.stringify(memberFixture));
    },
    { accountFixture: account, memberFixture: member },
  );
  await page.route(/\/auth\/refresh$/, (route) =>
    json(route, {
      accessToken: 'food-batch-token-refreshed',
      refreshToken: 'food-batch-refresh-token-refreshed',
      account,
      member,
    }),
  );
  await page.route(/\/shopping-list\?date=/, (route) => json(route, []));
  await page.route(/\/inventory$/, (route) => json(route, [inventoryItem]));
  await page.route(/\/inventory-transactions\?limit=/, (route) => json(route, []));
  await page.route(/\/inventory-batches\?status=all&days=7$/, (route) =>
    json(route, batches),
  );
  await page.route(/\/inventory-batches$/, (route) =>
    json(route, { ...batches[1], id: 'batch-created-fixture' }, 201),
  );
  await page.route(/\/smart-menu-plans\/smart-plan-fixture\/adopt$/, async (route) => {
    smartPlan = plan('adopted');
    await json(route, smartPlan, 201);
  });
  await page.route(/\/smart-menu-plans$/, (route) => json(route, [smartPlan]));
  await page.route(/\/members$/, (route) => json(route, [member]));
  await page.route(/\/notifications(?:\?.*)?$/, (route) => json(route, []));
}

async function expectTouchTarget(locator: Locator, label: string) {
  await expect(locator, `${label} 应可见`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} 应有尺寸`).not.toBeNull();
  expect(box?.width ?? 0, `${label} 宽度`).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0, `${label} 高度`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.root).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await installFixture(page);
});

test('食品批次与智能菜单在移动 Web 支持触控、横屏和明确采纳', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/shopping');

  for (const label of ['购物清单', '家庭库存', '智能菜单']) {
    await expectTouchTarget(page.getByRole('button', { name: label, exact: true }), `${label}分段`);
  }
  await page.getByRole('button', { name: '家庭库存', exact: true }).click();
  await expect(page.getByText('批次与保质期', { exact: true })).toBeVisible();
  await expect(page.getByText('7 天内到期', { exact: true })).toBeVisible();
  await expect(page.getByText('已过期', { exact: true })).toBeVisible();
  await expect(page.getByText('番茄库存', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const registerBatch = page.getByRole('button', { name: '登记食品批次', exact: true });
  await expectTouchTarget(registerBatch, '登记批次按钮');
  await registerBatch.click();
  const dialog = page.getByTestId('food-batch-dialog');
  await expect(dialog).toBeVisible();
  await expectTouchTarget(dialog.getByRole('button', { name: '关闭', exact: true }), '关闭批次弹层');
  await expectTouchTarget(dialog.getByRole('button', { name: '到期日期设为7天后' }), '批次快捷日期');
  for (const label of ['批次数量', '批次入库日期', '批次生产日期', '批次到期日期', '批次开封日期']) {
    const input = dialog.getByLabel(label);
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeVisible();
  }
  const dragHandle = dialog.getByTestId('adaptive-dialog-drag-handle');
  await expectTouchTarget(dragHandle, '批次弹层拖动区域');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByText('批次与保质期', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByRole('button', { name: '智能菜单', exact: true }).click();
  await expect(page.getByTestId('smart-menu-panel')).toBeVisible();
  await expect(page.getByText('投票已结束', { exact: true })).toBeVisible();
  await expect(page.getByText('优先使用番茄等临期食材', { exact: true })).toBeVisible();
  await expectTouchTarget(page.getByRole('button', { name: '查看菜单家庭投票' }), '查看投票按钮');
  const adopt = page.getByRole('button', { name: '采纳投票结果', exact: true });
  await expectTouchTarget(adopt, '采纳投票按钮');
  await adopt.click();
  const confirm = page.getByRole('dialog', { name: '采纳家庭投票结果？' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/获得选择的 1 道菜/)).toBeVisible();
  await expectTouchTarget(confirm.getByRole('button', { name: '确认采纳', exact: true }), '确认采纳按钮');
  await confirm.getByRole('button', { name: '确认采纳', exact: true }).click();
  await expect(page.getByText('已加入菜单', { exact: true })).toBeVisible();
  await expect(page.getByText('已把 1 道菜加入一周菜单', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
