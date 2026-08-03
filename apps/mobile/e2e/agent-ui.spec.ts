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

test('管理员可用鼠标或触控使用小管家并查看运行时设置', async ({ page }, testInfo) => {
  await page.goto('/assistant');
  await expect(page.getByRole('heading', { name: '问问小管家', exact: true })).toBeVisible();
  await expect(page.getByTestId('agent-settings-panel')).toBeVisible();

  const input = page.getByTestId('agent-message-input');
  const send = page.getByTestId('agent-send-button');
  const newConversation = page.getByTestId('agent-new-conversation');
  await expectTouchTarget(send, '发送按钮');
  await expectTouchTarget(newConversation, '新对话按钮');

  await input.fill('最近有哪些东西快没了？');
  await expect(input).toHaveValue('最近有哪些东西快没了？');
  await send.click();
  await expect(page.getByText(/库存|低库存/).last()).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name === 'desktop-chrome') {
    await expect(page.getByRole('link', { name: '问问小管家', exact: true })).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath(`agent-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
