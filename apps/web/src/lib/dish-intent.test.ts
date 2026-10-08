import { describe, expect, it } from 'vitest';
import { dishIntentStep, type DishListQuery } from './dish-intent';

const dishes = [{ id: 'd1' }, { id: 'd2' }];
const q = (data: DishListQuery['data'], isFetching = false, isError = false): DishListQuery => ({ data, isFetching, isError });

describe('dishIntentStep', () => {
  it('列表里有这道菜就打开；后台还在重取也先开', () => {
    expect(dishIntentStep(q(dishes), 'd2')).toBe('open');
    expect(dishIntentStep(q(dishes, true), 'd2')).toBe('open');
    expect(dishIntentStep(q(dishes, false, true), 'd1')).toBe('open'); // 重取失败但缓存里有
  });

  it('还没取到、离线暂停、或缓存里没有但正在重取：先等，参数留着', () => {
    expect(dishIntentStep(q(undefined, true), 'd1')).toBe('wait');
    expect(dishIntentStep(q(undefined), 'd1')).toBe('wait');
    expect(dishIntentStep(q(dishes, true), 'gone')).toBe('wait');
  });

  it('取完了没有、空列表、读失败：只抹参数', () => {
    expect(dishIntentStep(q(dishes), 'gone')).toBe('drop');
    expect(dishIntentStep(q([]), 'd1')).toBe('drop');
    expect(dishIntentStep(q(undefined, false, true), 'd1')).toBe('drop');
    expect(dishIntentStep(q(dishes, false, true), 'gone')).toBe('drop');
  });

  it('空 id（?dish=）直接抹参数，不等列表', () => {
    expect(dishIntentStep(q(undefined, true), '')).toBe('drop');
    expect(dishIntentStep(q(dishes), '')).toBe('drop');
  });
});
