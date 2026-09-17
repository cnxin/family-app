// 用法：node .tmp-shot.mjs <path> <name> [dark] [--click "<button name>"]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [path, name, ...rest] = process.argv.slice(2);
const dark = rest.includes('dark');
const clickIdx = rest.indexOf('--click');
const click = clickIdx >= 0 ? rest[clickIdx + 1] : null;
mkdirSync('.tmp-shots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
for (const [label, viewport, state, mobile] of [
  ['mobile', { width: 390, height: 844 }, 'e2e/.auth/mobile.json', true],
  ['desktop', { width: 1280, height: 800 }, 'e2e/.auth/desktop.json', false],
]) {
  const context = await browser.newContext({ storageState: state, viewport, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`http://localhost:5180${path}`);
  if (dark) {
    await page.evaluate(() => { localStorage.setItem('family-app.theme', 'dark'); });
    await page.reload();
  }
  await page.waitForLoadState('networkidle');
  if (click) await page.getByRole('button', { name: click }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `.tmp-shots/${name}-${label}${dark ? '-dark' : ''}.png` });
  await context.close();
}
await browser.close();
console.log('shots ok');
