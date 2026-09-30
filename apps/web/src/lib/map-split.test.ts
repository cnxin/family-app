import { describe, expect, it } from 'vitest';
import { polygonArea, splitPolygon, straightenLine, type MapPoint } from '@family/shared';

// 拆分房间的几何（地图编辑器 v2 §2.3）：线要从墙到墙正好交两次；差一点没画到墙上也认；斜一点拉正。

const rect: MapPoint[] = [[0, 0], [400, 0], [400, 300], [0, 300]];

describe('splitPolygon', () => {
  it('竖线把矩形切成左右两块，面积加起来不变', () => {
    const pieces = splitPolygon(rect, [100, -5], [100, 305])!;
    expect(pieces).not.toBeNull();
    const areas = pieces.map((piece) => Math.abs(polygonArea(piece))).sort((a, b) => a - b);
    expect(areas).toEqual([30000, 90000]);
  });

  it('线两头差一点没碰到墙也认（放宽）', () => {
    const pieces = splitPolygon(rect, [200, 20], [200, 280]);
    expect(pieces).not.toBeNull();
  });

  it('没穿过房间、只碰到一面墙：不生效', () => {
    expect(splitPolygon(rect, [500, 0], [500, 300])).toBeNull();
    expect(splitPolygon(rect, [100, 150], [100, 400], 0)).toBeNull();
  });

  it('L 形：只切画到的那一段，切出两块', () => {
    const ell: MapPoint[] = [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]];
    const pieces = splitPolygon(ell, [-2, 150], [102, 150], 0.05)!;
    expect(pieces).not.toBeNull();
    const areas = pieces.map((piece) => Math.abs(polygonArea(piece))).sort((a, b) => a - b);
    expect(areas).toEqual([15000, 35000]);
  });

  it('差不多横平竖直的线拉正', () => {
    expect(straightenLine([0, 100], [400, 108])).toEqual([[0, 104], [400, 104]]);
    expect(straightenLine([0, 0], [100, 100])).toEqual([[0, 0], [100, 100]]);
  });
});
