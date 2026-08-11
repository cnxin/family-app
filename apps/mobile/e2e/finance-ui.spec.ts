import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import type {
  FinanceAccount,
  FinanceBudget,
  FinanceCategory,
  FinanceTransaction,
  Member,
} from '../src/lib/types';

const householdId = 'household-finance-web-fixture';
const now = '2026-08-12T08:00:00.000Z';
const currentDate = '2026-08-12';
const currentMonth = currentDate.slice(0, 7);
const member: Member = {
  id: 'member-finance-web-fixture',
  householdId,
  name: '爸爸',
  avatarEmoji: 'F',
  role: 'owner',
  prefersCooking: true,
  disabledAt: null,
  createdAt: now,
};
const accountProfile = {
  id: 'account-finance-web-fixture',
  loginName: 'finance-web-fixture',
  requiresPasswordSetup: false,
};

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: 'application/json',
    status,
  });
}

function category(
  id: string,
  name: string,
  kind: FinanceCategory['kind'],
): FinanceCategory {
  return {
    id,
    householdId,
    name,
    kind,
    systemKey: kind === 'expense' ? 'food' : 'salary',
    icon: 'circle',
    color: kind === 'expense' ? '#26734D' : '#2563A8',
    sortOrder: 10,
    isActive: true,
    version: 1,
    createdById: member.id,
    createdBy: member,
    createdAt: now,
    updatedAt: now,
  };
}

function account(
  id: string,
  name: string,
  openingBalance: number,
): FinanceAccount {
  return {
    id,
    householdId,
    name,
    type: 'bank',
    openingBalance,
    balance: openingBalance,
    currency: 'CNY',
    isActive: true,
    version: 1,
    createdById: member.id,
    createdBy: member,
    createdAt: now,
    updatedAt: now,
  };
}

async function installFixtureSession(page: Page) {
  await page.addInitScript(
    ({ accountFixture, memberFixture }) => {
      window.localStorage.setItem('family-app-token', 'finance-web-token');
      window.localStorage.setItem(
        'family-app-refresh-token',
        'finance-web-refresh-token',
      );
      window.localStorage.setItem(
        'family-app-account',
        JSON.stringify(accountFixture),
      );
      window.localStorage.setItem(
        'family-app-member',
        JSON.stringify(memberFixture),
      );
    },
    { accountFixture: accountProfile, memberFixture: member },
  );
  await page.route(/\/auth\/refresh$/, (route) =>
    json(route, {
      accessToken: 'finance-web-token-refreshed',
      refreshToken: 'finance-web-refresh-token-refreshed',
      account: accountProfile,
      member,
    }),
  );
  await page.route(/\/notifications(?:\?.*)?$/, (route) => json(route, []));
}

async function installFinanceRoutes(page: Page, withAccount: boolean) {
  const accounts: FinanceAccount[] = withAccount
    ? [account('finance-account-viewport', '视口测试账户', 1000)]
    : [];
  const categories = [
    category('finance-category-food', '餐饮', 'expense'),
    category('finance-category-salary', '工资', 'income'),
  ];
  const budgets: FinanceBudget[] = [];
  const transactions: FinanceTransaction[] = [];
  let sequence = 0;

  await page.route(/\/finance(?:\/[^?]*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.resourceType() === 'document') {
      await route.continue();
      return;
    }
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/finance/accounts') {
      return json(route, accounts);
    }
    if (method === 'GET' && path === '/finance/categories') {
      return json(route, categories);
    }
    if (method === 'GET' && path === '/finance/transactions') {
      const type = url.searchParams.get('type');
      return json(
        route,
        type
          ? transactions.filter((entry) => entry.type === type)
          : transactions,
      );
    }
    if (method === 'GET' && path === '/finance/summary') {
      const expense = transactions
        .filter((entry) => entry.type === 'expense' && !entry.reversed)
        .reduce((sum, entry) => sum + entry.amount, 0);
      const income = transactions
        .filter((entry) => entry.type === 'income' && !entry.reversed)
        .reduce((sum, entry) => sum + entry.amount, 0);
      return json(route, {
        month: url.searchParams.get('month') ?? currentMonth,
        currency: 'CNY',
        income,
        expense,
        net: income - expense,
        totalBalance: accounts.reduce((sum, entry) => sum + entry.balance, 0),
        accounts,
        categories,
        budgets,
        categorySpending: expense
          ? [{ category: categories[0], amount: expense }]
          : [],
      });
    }
    if (method === 'POST' && path === '/finance/accounts') {
      const body = request.postDataJSON() as {
        name: string;
        openingBalance?: number;
      };
      const created = account(
        `finance-account-${++sequence}`,
        body.name,
        body.openingBalance ?? 0,
      );
      accounts.push(created);
      return json(route, created, 201);
    }
    if (method === 'PUT' && path === '/finance/budgets') {
      const body = request.postDataJSON() as {
        amount: number;
        categoryId: string;
        month: string;
      };
      const targetCategory = categories.find(
        (entry) => entry.id === body.categoryId,
      )!;
      const saved: FinanceBudget = {
        id: `finance-budget-${++sequence}`,
        householdId,
        categoryId: targetCategory.id,
        category: targetCategory,
        month: body.month,
        amount: body.amount,
        spent: 0,
        remaining: body.amount,
        ratio: 0,
        version: 1,
        updatedById: member.id,
        updatedBy: member,
        createdAt: now,
        updatedAt: now,
      };
      budgets.splice(0, budgets.length, saved);
      return json(route, saved);
    }
    if (method === 'POST' && path === '/finance/transactions') {
      const body = request.postDataJSON() as {
        accountId: string;
        amount: number;
        categoryId: string;
        note?: string | null;
        occurredOn: string;
        title: string;
        type: 'expense' | 'income';
      };
      const targetAccount = accounts.find(
        (entry) => entry.id === body.accountId,
      )!;
      const targetCategory = categories.find(
        (entry) => entry.id === body.categoryId,
      )!;
      const delta = body.type === 'expense' ? -body.amount : body.amount;
      targetAccount.balance += delta;
      const created: FinanceTransaction = {
        id: `finance-transaction-${++sequence}`,
        householdId,
        type: body.type,
        amount: body.amount,
        currency: 'CNY',
        title: body.title,
        note: body.note ?? null,
        occurredOn: body.occurredOn,
        categoryId: targetCategory.id,
        category: targetCategory,
        actorId: member.id,
        actor: member,
        actorName: member.name,
        sourceType: 'manual',
        sourceId: `finance-source-${sequence}`,
        reversalOfId: null,
        postings: [
          {
            id: `finance-posting-${sequence}`,
            transactionId: `finance-transaction-${sequence}`,
            accountId: targetAccount.id,
            account: targetAccount,
            delta,
            createdAt: now,
          },
        ],
        reversed: false,
        reversalId: null,
        createdAt: now,
      };
      transactions.unshift(created);
      return json(route, created, 201);
    }
    const reversal = path.match(/^\/finance\/transactions\/([^/]+)\/reverse$/);
    if (method === 'POST' && reversal) {
      const original = transactions.find((entry) => entry.id === reversal[1])!;
      const targetAccount = original.postings[0].account;
      targetAccount.balance -= original.postings[0].delta;
      original.reversed = true;
      original.reversalId = `finance-reversal-${++sequence}`;
      const reversed: FinanceTransaction = {
        ...original,
        id: original.reversalId,
        type: 'reversal',
        title: `撤销：${original.title}`,
        sourceType: 'finance_transaction',
        sourceId: original.id,
        reversalOfId: original.id,
        postings: original.postings.map((posting) => ({
          ...posting,
          id: `finance-reversal-posting-${sequence}`,
          transactionId: original.reversalId!,
          delta: -posting.delta,
        })),
        reversed: false,
        reversalId: null,
      };
      transactions.unshift(reversed);
      return json(route, reversed, 201);
    }
    await route.fulfill({
      body: JSON.stringify({
        error: { code: 'UNHANDLED_FINANCE_FIXTURE', message: path },
      }),
      contentType: 'application/json',
      status: 501,
    });
  });
}

async function openFinance(page: Page) {
  await page.goto('/finance');
  await expect(page).not.toHaveURL(/\/login\/?$/);
}

async function expectTouchTarget(locator: Locator, label: string) {
  await expect(locator, `${label} 应可见`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} 应有可测量尺寸`).not.toBeNull();
  expect(box?.width ?? 0, `${label} 宽度`).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0, `${label} 高度`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(widths.body).toBeLessThanOrEqual(1);
  expect(widths.root).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }, testInfo) => {
  await installFixtureSession(page);
  await installFinanceRoutes(page, !testInfo.title.includes('首次建账'));
});

test('管理员可从空账本完成首次建账、预算、记账和撤销', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome');
  test.setTimeout(90_000);
  await openFinance(page);

  await expect(page.getByRole('heading', { name: '家庭财务', exact: true })).toBeVisible();
  await expect(page.getByText('还没有财务账户', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '账户', exact: true }).click();

  const createAccount = page.getByRole('button', { name: '新增账户', exact: true });
  await expectTouchTarget(createAccount, '新增账户按钮');
  await createAccount.click();
  await page.getByLabel('账户名称', { exact: true }).fill('家庭日常账户');
  await page.getByLabel('初始余额', { exact: true }).fill('1000');
  await page.getByRole('button', { name: '保存账户', exact: true }).click();
  await expect(page.getByText('家庭日常账户', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '预算', exact: true }).click();
  await page.getByRole('button', { name: '设置餐饮预算', exact: true }).click();
  await page.getByLabel('预算金额', { exact: true }).fill('500');
  await page.getByRole('button', { name: '保存预算', exact: true }).click();
  await expect(page.getByText('¥500.00', { exact: true })).toBeVisible();

  const record = page.getByRole('button', { name: '记一笔', exact: true });
  await expectTouchTarget(record, '记一笔按钮');
  await record.click();
  await page.getByLabel('金额', { exact: true }).fill('88.80');
  await page.getByLabel('账目名称', { exact: true }).fill('周末家庭聚餐');
  await page.getByRole('button', { name: '确认记账', exact: true }).click();

  await page.getByRole('button', { name: '流水', exact: true }).click();
  await expect(page.getByText('周末家庭聚餐', { exact: true })).toBeVisible();
  const reverse = page.getByRole('button', { name: '撤销周末家庭聚餐', exact: true });
  await expectTouchTarget(reverse, '撤销流水按钮');
  await reverse.click();
  await page.getByRole('button', { name: '确认撤销', exact: true }).click();
  await expect(page.getByText('已由反向流水撤销', { exact: true })).toBeVisible();
  await expect(page.getByText(/cannot contain a nested/)).toHaveCount(0);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('finance-workflow-mobile.png'),
  });
});

test('家庭财务在移动和桌面视口无横向溢出且弹层可操作', async ({ page }, testInfo) => {
  await openFinance(page);
  await expect(page.getByRole('heading', { name: '家庭财务', exact: true })).toBeVisible();
  await expectTouchTarget(page.getByRole('button', { name: '问小管家', exact: true }), '问小管家按钮');
  await expectTouchTarget(page.getByRole('button', { name: '上个月', exact: true }), '上个月按钮');
  await expectTouchTarget(page.getByRole('button', { name: '概览', exact: true }), '概览分段按钮');
  await expectNoHorizontalOverflow(page);

  const record = page.getByRole('button', { name: '记一笔', exact: true });
  await expect(record).toBeEnabled();
  await record.click();
  await expect(page.getByText('确认后写入不可变家庭流水，误记可由管理员撤销', { exact: true })).toBeVisible();
  await expectTouchTarget(page.getByRole('button', { name: '关闭', exact: true }).last(), '关闭记账弹层按钮');
  await expectTouchTarget(page.getByRole('button', { name: '确认记账', exact: true }), '确认记账按钮');
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(500);

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`finance-dialog-${testInfo.project.name}.png`),
  });
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
});

test('家庭财务适配 375 像素小屏、横屏、深色和减少动态效果', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

  for (const viewport of [
    { name: 'small', width: 375, height: 812 },
    { name: 'landscape', width: 844, height: 390 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openFinance(page);
    await expect(page.getByRole('heading', { name: '家庭财务', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`finance-${viewport.name}-dark-reduced-motion.png`),
    });
  }
});
