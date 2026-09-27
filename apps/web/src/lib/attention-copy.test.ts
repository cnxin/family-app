import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@family/contracts';
import { attentionCopy } from './attention-copy';

const entity = { id: '00000000-0000-4000-8000-000000000001', name: '净水器滤芯' };
function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  const kind = overrides.kind ?? 'maintenance';
  return {
    key: 'assets:attention', domain: 'assets', kind, kinds: overrides.kinds ?? [kind], count: 1,
    dueOn: '2026-09-25', overdue: false, entity, ...overrides,
  };
}

describe('attentionCopy', () => {
  it('把单件写成带天数的一句', () => {
    const copy = attentionCopy(item(), '2026-09-22');
    expect(copy.title).toBe('净水器滤芯 3 天后该换了');
    expect(copy.timeText).toBe('3 天后');
    expect(copy.path).toBe('/house/assets/00000000-0000-4000-8000-000000000001');
  });

  it('多件用合并说法', () => {
    const copy = attentionCopy(item({ count: 3, entity: undefined }), '2026-09-22');
    expect(copy.title).toBe('3 件资产快到期');
  });

  it('逾期写出已过的天数', () => {
    const copy = attentionCopy(item({ overdue: true, dueOn: '2026-09-19' }), '2026-09-22');
    expect(copy.title).toBe('净水器滤芯已逾期 3 天');
    expect(copy.timeText).toBe('已逾期 3 天');
  });

  it('多种 kind 落到域列表', () => {
    const copy = attentionCopy(item({
      domain: 'guests', kind: 'menu', kinds: ['menu', 'meal-request'], count: 2, entity: undefined,
    }));
    expect(copy.path).toBe('/house/guests');
    expect(copy.actionLabel).toBe('去处理');
  });

  it.each([
    ['assets', 'renewal', '/house/assets/00000000-0000-4000-8000-000000000001', '看这件资产'],
    ['guests', 'menu', '/eat/order?date=2026-09-25&mealType=dinner', '去点菜'],
    ['guests', 'meal-request', '/house/guests', '去处理'],
    ['travel', 'checklist', '/life/travel/00000000-0000-4000-8000-000000000001', '看清单'],
    ['inventory', 'expiry', '/house/inventory', '看库存'],
    ['polls', 'vote', '/schedule/polls?pollId=00000000-0000-4000-8000-000000000001', '去投票'],
    ['points', 'redemption', '/house/points?redemptionId=00000000-0000-4000-8000-000000000001', '去审批'],
    ['finance', 'budget', '/house/finance', '看预算'],
    ['backups', 'backup', '/house/backups', '看备份'],
  ])('maps %s/%s to an actionable route', (domain, kind, path, actionLabel) => {
    const copy = attentionCopy(item({ domain: domain as AttentionItem['domain'], kind, entity }));
    expect(copy.path).toBe(path);
    expect(copy.actionLabel).toBe(actionLabel);
  });
});
