import { useState } from 'react';
import { useSmartHomeCommands, useSmartHomeDevices, useSmartHomeWebhookEvents } from '../lib/queries';
import { SMART_HOME_ACTION_LABELS } from '../lib/smart-home-copy';
import { OPERATION_SOURCES, operationLog, type Operation, type OperationSource } from '../lib/smart-home-operations';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { EmptyState, Panel, Segmented } from './ui';

const STATUS: Record<'pending' | 'succeeded' | 'failed' | 'processed' | 'ignored', [string, string]> = {
  pending: ['执行中', 'text-ink-soft'],
  succeeded: ['成功', 'text-accent'],
  failed: ['失败', 'text-danger'],
  processed: ['已处理', 'text-accent'],
  ignored: ['只记不做', 'text-ink-soft'],
};

const EMPTY: Record<OperationSource, [string, string]> = {
  all: ['还没有操作', '在智能家居页按的、联动按的、HA 打过来的，都会记在这里'],
  manual: ['还没人手动按过', '在智能家居页、今天页按的每一下都会记在这里'],
  link: ['联动还没按过设备', '「联动」里的规则让设备动了，会记在这里'],
  webhook: ['HA 还没打过来', '家电完成了事、HA 的自动化打给小管家，会记在这里'],
};

const time = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * 控制审计（home-assistant-plan §6.3）+ HA 回报（E3），按来源筛（H3 E5）：谁 / 哪条联动、什么时候、按了什么、HA 回了什么。
 * 只给管理员。控制按来源在服务端筛（各取最近 50 条），HA 回报取 webhook 事件。
 */
export function SmartHomeCommandsPanel() {
  const [source, setSource] = useState<OperationSource>('all');
  const commandSource = source === 'manual' || source === 'link' ? source : undefined;
  const commands = useSmartHomeCommands(source !== 'webhook', commandSource);
  const events = useSmartHomeWebhookEvents(source === 'all' || source === 'webhook');
  const devices = useSmartHomeDevices();
  const names = new Map(devices.data?.map((device) => [device.id, device.displayName]) ?? []);
  const query = source === 'webhook' ? events : commands;
  const log = operationLog(commands.data ?? [], events.data ?? [], source);
  const [emptyTitle, emptyHint] = EMPTY[source];

  const describe = (operation: Operation) => {
    if (operation.kind === 'webhook') {
      return { who: `HA · ${operation.title}`, detail: operation.entry.result, status: operation.entry.status, failed: false };
    }
    const entry = operation.entry;
    const who = entry.source === 'link' ? `联动「${entry.linkName ?? '已删除'}」` : entry.memberName;
    const target = (entry.deviceId && names.get(entry.deviceId)) || entry.entityId;
    return {
      who: `${who} · ${target} · ${SMART_HOME_ACTION_LABELS[entry.action]}`,
      detail: entry.status === 'failed' ? entry.message : null,
      status: entry.status,
      failed: entry.status === 'failed',
    };
  };

  return (
    <Panel
      title="最近的操作"
      grow={false}
      right={<Segmented<OperationSource> label="按来源筛" value={source} options={OPERATION_SOURCES} onChange={setSource} />}
    >
      <QueryFrame query={query} skeleton={<div className="p-3"><ListSkeleton rows={2} /></div>}>
        <div data-smart-home-commands data-source={source}>
        {log.length ? (
          <ul>
            {log.map((operation) => {
              const line = describe(operation);
              const [label, tone] = STATUS[line.status];
              return (
                <li
                  key={`${operation.kind}:${operation.id}`}
                  data-operation-kind={operation.kind === 'webhook' ? 'webhook' : operation.entry.source}
                  className="flex items-start gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{line.who}</span>
                    {line.detail ? (
                      <span className={`block truncate text-[12px] ${line.failed ? 'text-danger' : 'text-ink-soft'}`}>{line.detail}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right text-[12px]">
                    <span className={`block ${tone}`}>{label}</span>
                    <span className="block text-ink-soft">{time.format(new Date(operation.at))}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState emoji="🗒️" title={emptyTitle} hint={emptyHint} />
        )}
        </div>
      </QueryFrame>
    </Panel>
  );
}
