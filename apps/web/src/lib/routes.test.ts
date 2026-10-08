import { describe, expect, it } from 'vitest';
import { toNewRoute } from './routes';

describe('toNewRoute', () => {
  it('旧的一层路径换成新路径，查询串原样带过去', () => {
    expect(toNewRoute('/kitchen?date=2026-09-28&mealType=dinner')).toBe('/eat/kitchen?date=2026-09-28&mealType=dinner');
    expect(toNewRoute('/polls?pollId=abc')).toBe('/schedule/polls?pollId=abc');
    expect(toNewRoute('/tasks?date=2026-10-08&taskId=abc')).toBe('/schedule/tasks?date=2026-10-08&taskId=abc');
  });

  it('已经是新路径的原样放行（小管家点菜提案直接给 /eat/order）', () => {
    expect(toNewRoute('/eat/order?date=2026-09-28&meal=dinner')).toBe('/eat/order?date=2026-09-28&meal=dinner');
    expect(toNewRoute('/house/assets/1')).toBe('/house/assets/1');
    expect(toNewRoute('/home')).toBe('/home');
    expect(toNewRoute('/schedule/tasks?date=2026-10-08&taskId=abc')).toBe('/schedule/tasks?date=2026-10-08&taskId=abc');
  });

  it('认不出来的返回 null，没有旧版可回', () => {
    expect(toNewRoute('/menu?date=2026-09-28')).toBeNull();
    expect(toNewRoute(null)).toBeNull();
  });
});
