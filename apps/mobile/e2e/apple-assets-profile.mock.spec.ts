import { expect, test, type Route } from '@playwright/test';

const createdAt = '2026-08-12T08:00:00.000Z';
const assetId = '00000000-0000-4000-8000-000000000901';
const account = {
  id: '00000000-0000-4000-8000-000000000902',
  loginName: 'apple-ui-fixture',
  requiresPasswordSetup: false,
};
const member = {
  id: '00000000-0000-4000-8000-000000000903',
  householdId: '00000000-0000-4000-8000-000000000904',
  name: '家庭管理员',
  avatarEmoji: '家',
  role: 'admin',
  prefersCooking: true,
};

async function json(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

test.beforeEach(async ({ page }) => {
  let renewsOn = '2026-08-19';
  let deliveryEnabled = false;
  await page.addInitScript(
    ({ accountFixture, memberFixture }) => {
      window.localStorage.setItem('family-app-token', 'apple-ui-token');
      window.localStorage.setItem('family-app-refresh-token', 'apple-ui-refresh');
      window.localStorage.setItem('family-app-account', JSON.stringify(accountFixture));
      window.localStorage.setItem('family-app-member', JSON.stringify(memberFixture));
    },
    { accountFixture: account, memberFixture: member },
  );
  await page.route(/\/auth\/refresh$/, (route) =>
    json(route, {
      accessToken: 'apple-ui-token',
      refreshToken: 'apple-ui-refresh',
      account,
      member,
    }),
  );
  await page.route(/\/members$/, (route) => json(route, [member]));
  await page.route(/\/notifications(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/household\/invitations$/, (route) => json(route, []));
  await page.route(new RegExp(`/assets/${assetId}/renew$`), async (route) => {
    renewsOn = '2026-09-19';
    await json(route, subscription());
  });
  await page.route(new RegExp(`/assets/${assetId}$`), (route) =>
    json(route, subscription()),
  );
  await page.route(/\/assets\?status=all$/, (route) => json(route, [subscription()]));
  await page.route(/\/agent(?:\/[^?]*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/agent/profile') {
      await json(route, {
        id: 'profile-apple-ui',
        memberId: member.id,
        enabled: true,
        assistantName: '小管家',
        responseStyle: 'balanced',
        memoryEnabled: true,
        memorySuggestionEnabled: true,
        proactiveRoutinesEnabled: false,
        version: 1,
        createdAt,
        updatedAt: createdAt,
      });
      return;
    }
    if (path === '/agent/settings') {
      await json(route, {
        enabled: true,
        runtimeKind: 'hermes',
        runtimeProfile: 'familyapp',
        modelAlias: 'longcat-2.0-free',
        retentionDays: 30,
        dailyRoutineNotificationLimit: 3,
        routineNotificationsEnabled: deliveryEnabled,
        readToolsEnabled: [],
        proposalToolsEnabled: [],
        version: deliveryEnabled ? 2 : 1,
        updatedAt: createdAt,
      });
      return;
    }
    if (path === '/agent/routines') {
      await json(route, [nightlyRoutine()]);
      return;
    }
    if (path === '/agent/routines/nightly_digest/delivery') {
      deliveryEnabled = JSON.parse(request.postData() ?? '{}').enabled;
      await json(route, {
        enabled: deliveryEnabled,
        routine: nightlyRoutine(),
        settingsVersion: deliveryEnabled ? 2 : 3,
      });
      return;
    }
    await json(route, []);
  });

  function subscription() {
    return {
      id: assetId,
      name: '家庭影音订阅',
      category: 'subscription',
      location: '家庭账户',
      brand: 'Plex Pass',
      model: null,
      serialNumber: null,
      purchaseDate: null,
      purchasePrice: null,
      warrantyExpiresOn: null,
      renewsOn,
      renewalIntervalMonths: 1,
      status: 'active',
      note: null,
      createdById: member.id,
      createdBy: member,
      documents: [],
      maintenancePlans: [],
      maintenanceRecords: [],
      createdAt,
      updatedAt: createdAt,
    };
  }

  function nightlyRoutine() {
    return {
      id: '00000000-0000-4000-8000-000000000905',
      kind: 'nightly_digest',
      enabled: deliveryEnabled,
      scheduleHour: 21,
      scheduleMinute: 0,
      lastRunAt: null,
      nextRunAt: createdAt,
      version: deliveryEnabled ? 2 : 1,
      createdAt,
      updatedAt: createdAt,
    };
  }
});

test('订阅资产显示续费周期并可确认续费', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/asset/${assetId}`);

  await expect(page.getByTestId('asset-renewal-status')).toBeVisible();
  await expect(page.getByText('每月', { exact: true })).toBeVisible();
  await page.getByTestId('asset-mark-renewed').click();
  await expect(page.getByText('确认已续费', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '标记已续费', exact: true }).click();
  await expect(page.getByText('2026/9/19', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('subscription-detail-light.png'),
    fullPage: true,
  });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('主动提醒开关原子启用夜间汇总', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/profile');

  const delivery = page.getByRole('switch', { name: '启用家庭主动提醒' });
  await expect(delivery).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText(/每天 21:00 汇总临期订阅、药品和家庭待办/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('profile-reminders-light.png'),
    fullPage: true,
  });
  await delivery.click();
  await expect(delivery).toHaveAttribute('aria-checked', 'true');

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByTestId('nightly-delivery-switch')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('profile-reminders-dark.png'),
    fullPage: true,
  });
});

test('家庭资产在手机上使用分组列表', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/home-assets');
  await expect(page.getByText('家庭影音订阅', { exact: true })).toBeVisible();
  await expect(page.getByText(/下次续费/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('assets-list-light.png'),
    fullPage: true,
  });
});
