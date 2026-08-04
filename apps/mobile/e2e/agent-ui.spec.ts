import { expect, test, type Locator, type Page } from '@playwright/test';

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

test('管理员可用鼠标或触控使用小管家并查看运行时设置', async ({ page }, testInfo) => {
  await page.goto('/assistant');
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

  await input.fill('最近有哪些东西快没了？');
  await expect(input).toHaveValue('最近有哪些东西快没了？');
  await send.click();
  await expect(page.getByText(/库存|低库存/).last()).toBeVisible({ timeout: 15_000 });

  const proposalTitle = `触控回归任务-${Date.now()}`;
  const proposalDate = new Date().toISOString().slice(0, 10);
  await input.fill(`创建任务：${proposalTitle} ${proposalDate}`);
  await activate(send, testInfo.project.name === 'mobile-chrome');
  const confirm = page.getByRole('button', { name: '确认执行', exact: true }).last();
  const reject = page.getByRole('button', { name: '放弃', exact: true }).last();
  await expect(page.getByText(proposalTitle, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expectTouchTarget(confirm, '提案确认按钮');
  await expectTouchTarget(reject, '提案放弃按钮');
  await activate(reject, testInfo.project.name === 'mobile-chrome');
  await expect(page.getByText('操作提案 · 已放弃').last()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name === 'desktop-chrome') {
    await expect(page.getByRole('link', { name: '问问小管家', exact: true })).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath(`agent-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
