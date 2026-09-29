import { describe, expect, it } from 'vitest';
import { clampRect, labelPoint, pointInShape, polygonArea, shapeBounds, shapesTouch, type MapGeometryShape } from '@family/shared';

// 家庭地图几何（packages/shared/src/map-geometry.ts）：API 校验形状和编辑器共用的那几条。

const L: MapGeometryShape = { type: 'polygon', points: [[0, 0], [400, 0], [400, 200], [200, 200], [200, 400], [0, 400]] };

describe('地图几何', () => {
  it('点在不在房间里：L 形缺口里不算，压在边上算', () => {
    expect(pointInShape([100, 100], L)).toBe(true);
    expect(pointInShape([300, 300], L)).toBe(false);
    expect(pointInShape([400, 100], L)).toBe(true);
    expect(pointInShape([50, 50], { type: 'rect', x: 0, y: 0, w: 100, h: 100 })).toBe(true);
  });

  it('面积与外接框', () => {
    expect(polygonArea(L.type === 'polygon' ? L.points : [])).toBe(400 * 200 + 200 * 200);
    expect(shapeBounds(L)).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 400 });
  });

  it('房名落在房间里面，不在 L 形的外接框中心（那里是缺口）', () => {
    const [x, y] = labelPoint(L);
    expect(pointInShape([x, y], L)).toBe(true);
    expect(x < 200 || y < 200).toBe(true);
  });

  it('房名让开房间里画了的柜子', () => {
    const room: MapGeometryShape = { type: 'rect', x: 0, y: 0, w: 300, h: 300 };
    const cabinet = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
    const [x, y] = labelPoint(room, [cabinet]);
    const inside = x >= cabinet.minX && x <= cabinet.maxX && y >= cabinet.minY && y <= cabinet.maxY;
    expect(inside).toBe(false);
    expect(pointInShape([x, y], room)).toBe(true);
  });

  it('柜子拖出房间就夹回来；比房间还大就缩到房间那么大', () => {
    const room = { minX: 100, minY: 100, maxX: 300, maxY: 200 };
    expect(clampRect({ x: 280, y: 90, w: 50, h: 30 }, room)).toEqual({ type: 'rect', x: 250, y: 100, w: 50, h: 30 });
    expect(clampRect({ x: 0, y: 0, w: 500, h: 500 }, room)).toEqual({ type: 'rect', x: 100, y: 100, w: 200, h: 100 });
  });

  it('相邻房间：共用一段墙算相邻，隔着一段距离不算', () => {
    const a: MapGeometryShape = { type: 'rect', x: 0, y: 0, w: 100, h: 100 };
    const b: MapGeometryShape = { type: 'rect', x: 103, y: 20, w: 100, h: 50 };
    const far: MapGeometryShape = { type: 'rect', x: 150, y: 0, w: 50, h: 50 };
    expect(shapesTouch(a, b, 6)).toBe(true);
    expect(shapesTouch(a, far, 6)).toBe(false);
  });
});
