import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { watchPageErrors } from './helpers';

// I2a 房间识别（docs/item-location-plan.md §3 I2a）：浏览器 Worker 里跑。
// 样图：默认裁剪框把按钮裁掉 → 自动认出 ≥ 10 块草稿 → 命名步骤能删、能并进相邻房间，不用回第 2 步。
// 认不出（黑白线稿）：提示一句，直接落到手画，照样走完。

const sample = resolve(process.cwd(), '../../docs/ui-prototypes/floorplan-robot-sample.png');
const shots = resolve(process.cwd(), '../../.tmp-shots');

/** 白底黑框的线稿（没有颜色），识别不出房间 */
function lineDrawing(width = 400, height = 300) {
  const rows = Buffer.alloc((width * 3 + 1) * height, 0xff);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const edge = (x > 40 && x < 360 && (Math.abs(y - 40) < 3 || Math.abs(y - 260) < 3)) ||
        (y > 40 && y < 260 && (Math.abs(x - 40) < 3 || Math.abs(x - 360) < 3 || Math.abs(x - 200) < 3));
      if (edge) rows.fill(0, y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('样图自动识别：默认裁掉按钮 → ≥ 10 块草稿 → 命名时删一块、并一块', async ({ page, isMobile }) => {
  test.skip(isMobile, '导入在电脑上做');
  const errors = watchPageErrors(page);
  await page.goto('/house/map/import');
  await page.getByLabel('选择地图截图').setInputFiles(sample);
  // 默认裁剪框：比整张图窄（右边「90°」「地图显示」按钮在框外）
  await expect.poll(async () => page.getByRole('slider', { name: '裁剪框' }).getAttribute('aria-valuetext')).not.toBe('1187 × 1279');
  const [w] = ((await page.getByRole('slider', { name: '裁剪框' }).getAttribute('aria-valuetext')) ?? '').split(' × ').map(Number);
  expect(w).toBeLessThan(1000);
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.locator('[data-detect-state="done"]')).toBeVisible({ timeout: 15_000 });
  const count = await page.locator('[data-map-room]').count();
  expect(count).toBeGreaterThanOrEqual(10);
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: resolve(shots, 'map-import-detect-desktop.png') });
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.locator('[data-import-step="2"]')).toBeVisible();
  await expect(page.getByText(`第 1 / ${count} 个房间`)).toBeVisible();
  await page.getByRole('button', { name: '这块不是房间，删掉' }).click();
  await expect(page.getByText(`第 1 / ${count - 1} 个房间`)).toBeVisible();
  const merge = page.getByRole('button', { name: /^并进「/ }).first();
  await expect(merge).toBeVisible();
  await merge.click();
  await expect(page.getByText(new RegExp(`/ ${count - 2} 个房间`))).toBeVisible();
  await expect(page.locator('[data-map-room]')).toHaveCount(count - 2);
  expect(errors).toEqual([]);
});

test('认不出房间（黑白线稿）：提示一句，直接手画走完', async ({ page, isMobile }) => {
  test.skip(isMobile, '导入在电脑上做');
  await page.goto('/house/map/import');
  await page.getByLabel('选择地图截图').setInputFiles({ name: 'line.png', mimeType: 'image/png', buffer: lineDrawing() });
  await expect(page.locator('[data-import-crop] img')).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.locator('[data-detect-state="failed"]')).toContainText('直接在图上拖矩形画房间');
  await expect(page.getByRole('tab', { name: '画房间' })).toHaveAttribute('aria-selected', 'true');
  const area = (await page.locator('[data-map-canvas]').boundingBox())!;
  await page.mouse.move(area.x + area.width * 0.3, area.y + area.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.5, area.y + area.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-map-room]')).toHaveCount(1);
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.locator('[data-import-step="2"]')).toBeVisible();
});
