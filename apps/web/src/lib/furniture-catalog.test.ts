import { describe, expect, it } from 'vitest';
import type { MapShape } from '@family/contracts';
import { FURNITURE, furnitureSpec, isStorageFurniture, nextFurnitureName, placementRect } from '../components/map/furniture-catalog';

// 家具库目录（地图编辑器 v2 §3）：18 种、默认尺寸按 1 单位 ≈ 1 厘米、放不下缩到房间短边 60%、不叠在已有家具上、自动编号。

const room: MapShape = { type: 'polygon', points: [[0, 0], [400, 0], [400, 300], [0, 300]] };

describe('家具库目录', () => {
  it('收纳 10 种、装饰 8 种，键和契约一致', () => {
    expect(FURNITURE.filter((one) => one.group === 'storage')).toHaveLength(10);
    expect(FURNITURE.filter((one) => one.group === 'decor')).toHaveLength(8);
    expect(FURNITURE.filter((one) => one.group === 'storage').every((one) => isStorageFurniture(one.key))).toBe(true);
    expect(isStorageFurniture('sofa')).toBe(false);
    expect(furnitureSpec('bed')?.label).toBe('床');
  });

  it('放得下按默认尺寸落在房间中央', () => {
    expect(placementRect({ w: 160, h: 60 }, room)).toEqual({ type: 'rect', x: 120, y: 120, w: 160, h: 60 });
  });

  it('超过房间短边 60% 等比缩到 60%', () => {
    const rect = placementRect({ w: 180, h: 200 }, { type: 'polygon', points: [[0, 0], [200, 0], [200, 200], [0, 200]] })!;
    expect(rect.h).toBe(120);
    expect(rect.w).toBe(108);
  });

  it('中央已经摆了东西就挪到旁边空地；L 形缺口里不放', () => {
    const taken = { minX: 120, minY: 120, maxX: 280, maxY: 180 };
    const rect = placementRect({ w: 100, h: 40 }, room, [taken])!;
    const overlaps = rect.x < taken.maxX && rect.x + rect.w > taken.minX && rect.y < taken.maxY && rect.y + rect.h > taken.minY;
    expect(overlaps).toBe(false);
    const ell: MapShape = { type: 'polygon', points: [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]] };
    const inEll = placementRect({ w: 40, h: 40 }, ell)!;
    expect(inEll.x + inEll.w <= 100 || inEll.y + inEll.h <= 100).toBe(true);
  });

  it('同一房间里不重名：衣柜、衣柜 2、衣柜 3', () => {
    expect(nextFurnitureName('衣柜', ['鞋柜'])).toBe('衣柜');
    expect(nextFurnitureName('衣柜', ['衣柜'])).toBe('衣柜 2');
    expect(nextFurnitureName('衣柜', ['衣柜', '衣柜 2'])).toBe('衣柜 3');
  });
});
