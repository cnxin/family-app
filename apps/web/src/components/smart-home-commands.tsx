import type { SmartHomeAction } from '@family/contracts';
import { useSmartHomeCommands, useSmartHomeDevices } from '../lib/queries';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { EmptyState, Panel } from './ui';

const ACTION_LABEL: Record<SmartHomeAction, string> = {
  start: '开始清扫',
  pause: '暂停',
  return_to_base: '回充',
  open: '打开',
  stop: '停',
  close: '关上',
  turn_on: '打开',
  turn_off: '关掉',
  activate: '执行',
  mode_cool: '制冷',
  mode_heat: '制热',
  mode_fan_only: '送风',
  mode_auto: '自动',
  temperature_up: '调高 1°',
  temperature_down: '调低 1°',
};

const STATUS: Record<'pending' | 'succeeded' | 'failed', [string, string]> = {
  pending: ['执行中', 'text-ink-soft'],
  succeeded: ['成功', 'text-accent'],
  failed: ['失败', 'text-danger'],
};

/** 控制审计（home-assistant-plan §6.3）：谁、什么时候、按了什么、HA 回了什么。只给管理员。 */
export function SmartHomeCommandsPanel() {
  const commands = useSmartHomeCommands(true);
  const devices = useSmartHomeDevices();
  const names = new Map(devices.data?.map((device) => [device.entityId, device.displayName]) ?? []);
  const time = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <Panel title="最近的操作" grow={false}>
      <QueryFrame query={commands} skeleton={<div className="p-3"><ListSkeleton rows={2} /></div>}>
        {commands.data?.length ? (
          <ul data-smart-home-commands>
            {commands.data.slice(0, 20).map((entry) => {
              const [label, tone] = STATUS[entry.status];
              return (
                <li key={entry.id} className="flex items-start gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {entry.memberName} · {names.get(entry.entityId) ?? entry.entityId} · {ACTION_LABEL[entry.action]}
                    </span>
                    {entry.status === 'failed' && entry.message ? (
                      <span className="block truncate text-[12px] text-danger">{entry.message}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right text-[12px]">
                    <span className={`block ${tone}`}>{label}</span>
                    <span className="block text-ink-soft">{time.format(new Date(entry.createdAt))}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState emoji="🗒️" title="还没人按过" hint="在智能家居页按的每一下都会记在这里" />
        )}
      </QueryFrame>
    </Panel>
  );
}
