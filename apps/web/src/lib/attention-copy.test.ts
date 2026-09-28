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
    expect(copy.title).toBe('3 件资产该保养了');
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

type Case = { domain: AttentionItem['domain']; kind: string; name: string; single: string; plural: string };

// 每个域、每种事：单件说出是哪一件，多件用家里人会说的合并说法（today = 2026-09-22，dueOn = 09-25）
const cases: Case[] = [
  { domain: 'assets', kind: 'maintenance', name: '净水器滤芯', single: '净水器滤芯 3 天后该换了', plural: '3 件资产该保养了' },
  { domain: 'assets', kind: 'renewal', name: '视频会员', single: '视频会员 3 天后该续费了', plural: '3 项订阅该续费了' },
  { domain: 'assets', kind: 'warranty', name: '洗衣机', single: '洗衣机 3 天后保修到期', plural: '3 件资产保修快到期' },
  { domain: 'guests', kind: 'menu', name: '小林来吃饭', single: '小林来吃饭（3 天后）还没定菜', plural: '本周有 3 场来访要准备' },
  { domain: 'guests', kind: 'meal-request', name: '小林', single: '小林的点菜请求等你处理', plural: '3 条访客点菜等你处理' },
  { domain: 'travel', kind: 'checklist', name: '国庆回老家', single: '国庆回老家 3 天后出发，清单还没准备好', plural: '3 个行程还没准备好' },
  { domain: 'inventory', kind: 'expiry', name: '牛奶', single: '牛奶 3 天后过期', plural: '3 样快过期' },
  { domain: 'polls', kind: 'vote', name: '周末去哪', single: '「周末去哪」还没投，3 天后截止', plural: '3 个投票等你' },
  { domain: 'points', kind: 'redemption', name: '妈妈', single: '妈妈的兑换等你审批', plural: '3 个兑换等你审批' },
  { domain: 'finance', kind: 'budget', name: '餐饮', single: '餐饮本月预算超了', plural: '3 个分类超预算了' },
  { domain: 'backups', kind: 'backup', name: '备份', single: '备份需要看一下', plural: '备份有 3 件事要看一下' },
];

const noDueKinds = new Set(['meal-request', 'redemption', 'budget', 'backup']);

describe('attentionCopy：逐域的单件与合并说法', () => {
  for (const c of cases) {
    it(`${c.domain}/${c.kind}`, () => {
      const dueOn = noDueKinds.has(c.kind) ? undefined : '2026-09-25';
      const single = attentionCopy(
        item({ domain: c.domain, kind: c.kind, dueOn, entity: { id: entity.id, name: c.name } }),
        '2026-09-22',
      );
      expect(single.title).toBe(c.single);
      const plural = attentionCopy(
        item({ domain: c.domain, kind: c.kind, dueOn, count: 3, entity: undefined }),
        '2026-09-22',
      );
      expect(plural.title).toBe(c.plural);
      // 旧的通用模板「N 件<域>快到期 / 已逾期 / 待处理」不再出现（「8 件访客快到期」就是它）
      expect(plural.title).not.toMatch(/^\d+ 件(资产|访客|出行|库存|投票|积分|财务|备份|智能家居)(快到期|已逾期|待处理)$/);
    });
  }

  it('多件里有逾期的，只说「有的」已经过期，不夸大成全部', () => {
    const copy = attentionCopy(
      item({ domain: 'inventory', kind: 'expiry', count: 2, overdue: true, dueOn: '2026-09-10', entity: undefined }),
      '2026-09-22',
    );
    expect(copy.title).toBe('2 样快过期，有的已经过期了');
    expect(copy.timeText).toBe('已逾期 12 天');
  });

  it('同一个域混了几种事，用这个域的总说法', () => {
    expect(attentionCopy(item({ kinds: ['maintenance', 'renewal'], count: 4, entity: undefined })).title).toBe('4 件资产要处理');
    expect(
      attentionCopy(item({ domain: 'guests', kind: 'menu', kinds: ['menu', 'meal-request'], count: 2, entity: undefined })).title,
    ).toBe('2 件访客的事要处理');
  });
});
