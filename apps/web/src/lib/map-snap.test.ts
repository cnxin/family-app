import { describe, expect, it } from 'vitest';
import { alignToNeighbours, rectangularize, snapRect, snapVertex, type MapPoint } from '@family/shared';

// 地图编辑器 v2 §2：吸附、矩形化、对齐相邻（packages/shared/src/map-snap.ts）。

const neighbour: MapPoint[] = [[200, 0], [400, 0], [400, 200], [200, 200]];

describe('拖顶点吸附', () => {
  it('贴近相邻房间的顶点：吸到那个顶点', () => {
    const result = snapVertex([204, 197], [100, 200], [100, 300], [neighbour], 8);
    expect(result.point).toEqual([200, 200]);
  });

  it('贴近相邻房间的墙：吸到墙上，再沿墙吸直角', () => {
    // 房间的这个顶点在邻居左墙（x = 200）附近，前一个顶点 y = 120：吸到墙上，y 也吸成 120
    const result = snapVertex([195, 124], [50, 120], [60, 300], [neighbour], 8);
    expect(result.point).toEqual([200, 120]);
    expect(result.guides.length).toBeGreaterThanOrEqual(2);
  });

  it('离谁都远：只吸直角', () => {
    expect(snapVertex([503, 297], [500, 100], [700, 300], [neighbour], 8).point).toEqual([500, 300]);
    expect(snapVertex([530, 260], [500, 100], [700, 300], [neighbour], 8).point).toEqual([530, 260]);
  });
});

describe('柜子吸墙', () => {
  it('贴近房间的墙或旁边柜子的边就贴上', () => {
    const room = { minX: 0, minY: 0, maxX: 300, maxY: 200 };
    const sibling = { minX: 100, minY: 150, maxX: 180, maxY: 200 };
    const snapped = snapRect({ x: 5, y: 60, w: 50, h: 40 }, room, [sibling], 8);
    expect(snapped.x).toBe(0);
    expect(snapped.y).toBe(60);
    expect(snapRect({ x: 120, y: 106, w: 50, h: 40 }, room, [sibling], 8).y).toBe(110);
  });
});

describe('矩形化与对齐相邻', () => {
  it('矩形化：换成外接矩形', () => {
    expect(rectangularize({ type: 'polygon', points: [[10, 10], [90, 12], [95, 80], [8, 85]] })).toEqual([[8, 10], [95, 10], [95, 85], [8, 85]]);
  });

  it('对齐相邻：只把挨得近、有重叠的边挪到邻居的墙上', () => {
    // 选中房间右墙在 x = 194，邻居左墙在 x = 200、上下有重叠：挪过去；
    // 上墙 y = 3 离邻居上墙 y = 0 虽近，但左右没有重叠（0～194 对 200～400），不动
    const room: MapPoint[] = [[0, 3], [194, 3], [194, 180], [0, 180]];
    const { points, moved } = alignToNeighbours(room, [neighbour], 12);
    expect(points).toEqual([[0, 3], [200, 3], [200, 180], [0, 180]]);
    expect(moved).toBe(1);
    // 离得远（30）不动
    expect(alignToNeighbours([[0, 0], [170, 0], [170, 180], [0, 180]], [neighbour], 12).moved).toBe(0);
  });
});
