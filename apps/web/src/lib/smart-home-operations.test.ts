import { describe, expect, it } from 'vitest';
import type { SmartHomeCommand, SmartHomeWebhookEventRecord } from '@family/contracts';
import { operationLog } from './smart-home-operations';

const command = (id: string, at: string, source: SmartHomeCommand['source']): SmartHomeCommand => ({
  id, deviceId: null, entityId: 'vacuum.s8', action: 'start', status: 'succeeded', message: null, memberName: '爸爸',
  createdAt: at, finishedAt: at, replayed: false, source, linkName: source === 'link' ? '打扫就扫地' : null,
});
const event = (id: string, at: string, name = 'laundry_done'): SmartHomeWebhookEventRecord => ({
  id, eventId: `ctx-${id}`, event: name, status: 'processed', result: '建了家务「晾衣服」', receivedAt: at,
});

describe('operationLog', () => {
  const commands = [command('c1', '2026-09-29T10:00:00.000Z', 'manual'), command('c2', '2026-09-29T08:00:00.000Z', 'link')];
  const events = [event('e1', '2026-09-29T09:00:00.000Z'), event('e2', '2026-09-29T07:00:00.000Z', 'custom')];

  it('全部：控制和 HA 回报按时间倒序合成一条线，事件名翻成人话（认不出的原样）', () => {
    const log = operationLog(commands, events, 'all');
    expect(log.map((one) => one.id)).toEqual(['c1', 'e1', 'c2', 'e2']);
    expect(log[1]).toMatchObject({ kind: 'webhook', title: '洗衣 / 烘干完成' });
    expect(log[3]).toMatchObject({ kind: 'webhook', title: 'custom' });
  });

  it('按来源筛：手动 / 联动只看控制，HA 回报只看事件；条数有上限', () => {
    expect(operationLog(commands, events, 'manual').map((one) => one.id)).toEqual(['c1']);
    expect(operationLog(commands, events, 'link').map((one) => one.id)).toEqual(['c2']);
    expect(operationLog(commands, events, 'webhook').map((one) => one.id)).toEqual(['e1', 'e2']);
    expect(operationLog(commands, events, 'all', 2)).toHaveLength(2);
  });
});
