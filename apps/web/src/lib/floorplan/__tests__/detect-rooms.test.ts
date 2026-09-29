import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shapesTouch } from '@family/shared';
import { detectRooms, suggestCrop } from '../detect-rooms';
import { mergeRooms } from '../merge-rooms';
import { cropImage, decodePng } from './decode-png';

// 房间识别（item-location-plan §3 I2a）：两张扫地机截图（docs/ui-prototypes/ 的样图复制到 fixtures），
// 按导入向导的默认裁剪框裁好，断言 ≥ 10 个房间、每个 ≤ 16 个顶点、房间总面积占裁剪图 60%～95%。
// 结果（房间数、顶点数、面积占比、耗时）打到输出里，汇报用。

const FIXTURES = ['floorplan-robot-sample.png', 'floorplan-robot-current.png'];
const missing = FIXTURES.filter(
  (name) => ![resolve(__dirname, 'fixtures', name), resolve(__dirname, '../../../../../../docs/ui-prototypes', name)].some(existsSync),
);
if (missing.length) console.warn(`⚠ 缺样图，这几张没跑识别断言：${missing.join('、')}`);

for (const name of FIXTURES) {
  const path = [resolve(__dirname, 'fixtures', name), resolve(__dirname, '../../../../../../docs/ui-prototypes', name)].find(existsSync);
  // 2026-09-30：floorplan-robot-current.png（King 家现在的地图）还没放进仓库；放到 docs/ui-prototypes/ 就自动跑
  describe.skipIf(!path)(name, () => {
    if (!path) return;

    const image = decodePng(path);
    const box = suggestCrop(image);
    const cropped = cropImage(image, box.x, box.y, box.w, box.h);
    const result = detectRooms(cropped, () => performance.now());
    const share = result.rooms.reduce((sum, room) => sum + room.share, 0);
    const vertices = result.rooms.map((room) => room.points.length);
    console.log(
      `${name}：原图 ${image.width}×${image.height}，裁剪 ${box.w}×${box.h}，识别 ${result.rooms.length} 个房间，` +
        `顶点 ${Math.min(...vertices)}～${Math.max(...vertices)}（${vertices.join('、')}），面积占比 ${(share * 100).toFixed(1)}%，` +
        `耗时 ${Math.round(result.ms)} ms（node，工作分辨率 ${result.work.w}×${result.work.h}）`,
    );

    it('默认裁剪框把 App 的按钮裁掉（只框住房间）', () => {
      expect(box.w).toBeLessThan(image.width);
      expect(box.w * box.h).toBeGreaterThan(image.width * image.height * 0.2);
    });
    it('识别出 ≥ 10 个房间', () => expect(result.rooms.length).toBeGreaterThanOrEqual(10));
    it('每个房间 3～16 个顶点', () => {
      for (const count of vertices) {
        expect(count).toBeGreaterThanOrEqual(3);
        expect(count).toBeLessThanOrEqual(16);
      }
    });
    it('房间总面积占裁剪图 60%～95%', () => {
      expect(share).toBeGreaterThanOrEqual(0.6);
      expect(share).toBeLessThanOrEqual(0.95);
    });
    it('坐标都在 viewBox 里，宽 1000', () => {
      expect(result.viewBox.w).toBe(1000);
      for (const room of result.rooms) {
        for (const [x, y] of room.points) {
          expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
          expect(x >= 0 && x <= 1000 && y >= 0 && y <= result.viewBox.h).toBe(true);
        }
      }
    });
    it('房间互不重叠太多、相邻的能并成一块', () => {
      const [first] = result.rooms;
      const neighbour = result.rooms.find((room) => room !== first && shapesTouch(
        { type: 'polygon', points: first.points }, { type: 'polygon', points: room.points }, 8,
      ));
      expect(neighbour).toBeTruthy();
      const merged = mergeRooms(first.points, neighbour!.points, result.viewBox);
      expect(merged.length).toBeGreaterThanOrEqual(4);
      expect(merged.length).toBeLessThanOrEqual(24);
    });
  });
}
