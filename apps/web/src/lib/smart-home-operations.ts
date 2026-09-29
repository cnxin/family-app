import type { SmartHomeCommand, SmartHomeWebhookEventRecord } from '@family/contracts';

// 设置页「最近的操作」按来源筛（H3 E5）：手动（家里人在小管家里按的）、联动（E4：家务打勾 / 日程到点让设备动）、
// HA 回报（E3：家电完成了事打给小管家）。前两种是控制审计，第三种是 webhook 事件，放进同一条时间线。

export type OperationSource = 'all' | 'manual' | 'link' | 'webhook';

export const OPERATION_SOURCES: { value: OperationSource; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'manual', label: '手动' },
  { value: 'link', label: '联动' },
  { value: 'webhook', label: 'HA 回报' },
];

const WEBHOOK_EVENTS: Record<string, string> = {
  laundry_done: '洗衣 / 烘干完成',
  vacuum_done: '扫地机扫完了',
  filter_low: '净水器滤芯低',
  ping: '连通测试',
};

export type Operation =
  | { kind: 'command'; id: string; at: string; entry: SmartHomeCommand }
  | { kind: 'webhook'; id: string; at: string; title: string; entry: SmartHomeWebhookEventRecord };

/** 两种记录按时间倒序合成一条线；筛「手动 / 联动」只取控制，「HA 回报」只取事件。 */
export function operationLog(
  commands: SmartHomeCommand[],
  events: SmartHomeWebhookEventRecord[],
  source: OperationSource,
  limit = 20,
): Operation[] {
  const fromCommands: Operation[] = commands
    .filter((entry) => source === 'all' || entry.source === source)
    .map((entry) => ({ kind: 'command', id: entry.id, at: entry.createdAt, entry }));
  const fromEvents: Operation[] =
    source === 'all' || source === 'webhook'
      ? events.map((entry) => ({
          kind: 'webhook',
          id: entry.id,
          at: entry.receivedAt,
          title: WEBHOOK_EVENTS[entry.event] ?? entry.event,
          entry,
        }))
      : [];
  return [...fromCommands, ...fromEvents].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
