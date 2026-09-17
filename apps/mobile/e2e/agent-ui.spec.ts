import { expect, test, type Locator, type Page } from '@playwright/test';

async function openAuthenticated(
  page: Page,
  path: string,
  projectName: string,
) {
  await page.goto(path);
  if (/\/login\/?$/.test(new URL(page.url()).pathname)) {
    const password = process.env.E2E_ACCOUNT_PASSWORD;
    expect(
      password,
      '浏览器回归缺少 E2E_ACCOUNT_PASSWORD；空字符串表示无密码账号',
    ).not.toBeUndefined();
    await page
      .getByPlaceholder('输入账号')
      .fill(process.env.E2E_LOGIN_NAME ?? '爸爸');
    await page.getByPlaceholder('输入密码').fill(password ?? '');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL((url) => !/\/login\/?$/.test(url.pathname));
    if (path !== '/') await page.goto(path);
  }
  await page.context().storageState({
    path:
      projectName === 'desktop-chrome'
        ? 'e2e/.auth/desktop.json'
        : 'e2e/.auth/mobile.json',
  });
}

async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} 应该可见`).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
}

async function activate(locator: Locator, touch: boolean) {
  await locator.scrollIntoViewIfNeeded();
  if (touch) await locator.tap();
  else await locator.click();
}

// 助理输入框挂在 RN Web 的受控组件上：点「新对话」后会话切换是异步的，晚到的一次
// 重渲染可能把刚填进去的草稿又冲掉，于是发送按钮停留在 disabled——本地快就看不见，
// CI 慢一点就必红。所以这里不是「填一次然后断言」，而是填到发送按钮真的可用为止。
async function fillDraft(input: Locator, send: Locator, text: string) {
  await expect(input).toBeEditable();
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1_000 });
    await expect(send).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test('管理员可用鼠标或触控使用小管家并查看运行时设置', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openAuthenticated(page, '/assistant', testInfo.project.name);
  await expect(page.getByRole('heading', { name: '问问小管家', exact: true })).toBeVisible();
  const settingsTrigger = page.getByTestId('agent-settings-trigger');
  await expectTouchTarget(settingsTrigger, '助理设置入口');
  await activate(settingsTrigger, testInfo.project.name === 'mobile-chrome');
  await expect(page.getByTestId('agent-settings-panel')).toBeVisible();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect(page.getByTestId('adaptive-dialog-drag-handle')).toBeVisible();
  }
  await activate(
    page.getByTestId('agent-settings-close'),
    testInfo.project.name === 'mobile-chrome',
  );

  const historyTrigger = page.getByTestId('agent-history-trigger');
  await expectTouchTarget(historyTrigger, '会话历史入口');
  await activate(historyTrigger, testInfo.project.name === 'mobile-chrome');
  await expect(page.getByTestId('agent-history-sheet')).toBeVisible();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect(page.getByTestId('adaptive-dialog-drag-handle')).toBeVisible();
  }
  await activate(
    page.getByTestId('agent-history-close'),
    testInfo.project.name === 'mobile-chrome',
  );

  const input = page.getByTestId('agent-message-input');
  const send = page.getByTestId('agent-send-button');
  const newConversation = page.getByTestId('agent-new-conversation');
  await expectTouchTarget(send, '发送按钮');
  await expectTouchTarget(newConversation, '新对话按钮');
  // 输入框可编辑 == 助理状态查询已落地。不等这一步就读下面的标题文案，读到的会是
  // status 还没回来时的「离线模式可用」，整段核心断言会被静默跳过——CI 慢一点就走进来、
  // 本地快就跳过，两边结论不一样。
  await expect(input).toBeEditable();
  const localRuntime = await page
    .getByText('本地家庭摘要可用', { exact: true })
    .isVisible();
  if (localRuntime) {
    await activate(newConversation, testInfo.project.name === 'mobile-chrome');
    await fillDraft(input, send, '这周还有哪些家庭任务？');
    await send.click();
    const taskResult = page.getByTestId('agent-result-tasks').last();
    await expect(taskResult).toBeVisible({ timeout: 60_000 });
    await expectTouchTarget(
      page.getByTestId('agent-result-open-tasks').last(),
      '任务结果跳转入口',
    );

    const proposalTitle = `触控回归任务-${Date.now()}`;
    const proposalDate = new Date().toISOString().slice(0, 10);
    await fillDraft(input, send, `创建任务：${proposalTitle} ${proposalDate}`);
    await activate(send, testInfo.project.name === 'mobile-chrome');
    const confirm = page.getByRole('button', { name: '确认执行', exact: true }).last();
    const reject = page.getByRole('button', { name: '放弃', exact: true }).last();
    await expect(page.getByText(proposalTitle, { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expectTouchTarget(confirm, '提案确认按钮');
    await expectTouchTarget(reject, '提案放弃按钮');
    await activate(reject, testInfo.project.name === 'mobile-chrome');
    await expect(page.getByText('操作提案 · 已放弃').last()).toBeVisible();
  } else {
    await input.fill('这周还有哪些家庭任务？');
    await expect(input).toHaveValue('这周还有哪些家庭任务？');
    await input.fill('');
  }
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name === 'desktop-chrome') {
    await expect(page.getByRole('link', { name: '问问小管家', exact: true })).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath(`agent-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test('菜品详情可用页面上下文进入小管家并清除', async ({ page }, testInfo) => {
  await openAuthenticated(page, '/recipes', testInfo.project.name);
  const dishEntry = page.locator('[data-testid^="recipe-dish-"]').first();
  await expect(dishEntry).toBeVisible();
  await activate(dishEntry, testInfo.project.name === 'mobile-chrome');
  await expect(page).toHaveURL(/\/dish\/[0-9a-f-]{36}$/);
  const dishId = new URL(page.url()).pathname.split('/').at(-1)!;
  const dishName = await page.getByTestId('dish-detail-name').innerText();
  const entry = page.getByTestId('dish-ask-assistant');
  await expectTouchTarget(entry, '菜品页小管家入口');
  await activate(entry, testInfo.project.name === 'mobile-chrome');

  await expect(page).toHaveURL(/\/assistant\?.*entityType=dish/);
  const context = page.getByTestId('agent-page-context');
  await expect(context).toContainText(`正在参考：${dishName}`);
  const clear = page.getByTestId('agent-page-context-clear');
  await expectTouchTarget(clear, '页面上下文清除按钮');

  const messageRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      /\/agent\/conversations\/[0-9a-f-]{36}\/messages$/.test(
        new URL(request.url()).pathname,
      ),
  );
  await page.getByTestId('agent-message-input').fill('这道菜需要什么食材');
  await activate(
    page.getByTestId('agent-send-button'),
    testInfo.project.name === 'mobile-chrome',
  );
  const sent = (await messageRequest).postDataJSON() as {
    pageContext?: Record<string, unknown>;
  };
  expect(sent.pageContext).toEqual({
    route: `/dish/${dishId}`,
    entityType: 'dish',
    entityId: dishId,
  });

  if (testInfo.project.name === 'mobile-chrome') {
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(context).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect(context).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  await activate(clear, testInfo.project.name === 'mobile-chrome');
  await expect(context).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
