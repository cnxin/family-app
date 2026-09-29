import { useMemo, type ReactNode } from 'react';
import { SMART_HOME_TODAY_LIMIT, type SmartHomePanel, type SmartHomePanelEntity } from '@family/contracts';
import { useAuth } from '../lib/auth';
import { useSmartHomePanel, useSmartHomeStates, useUpdateSmartHomeDevice } from '../lib/queries';
import { SMART_HOME_ACTION_LABELS } from '../lib/smart-home-copy';
import { deviceStatusLine } from '../lib/smart-home-device-copy';
import { pushToast } from '../lib/toast';
import { useMediaQuery } from '../lib/use-media-query';
import { usePendingCommands, type PendingCommands } from '../lib/use-pending-commands';
import { QueryFailure } from './query-state';
import { ListSkeleton } from './skeleton';
import { SmartHomeIcon } from './smart-home-icon';
import { EntityRow } from './smart-home-entity-control';
import { FeaturedSection, PrimaryPanel } from './smart-home-panel-main';
import { SoftLink } from './soft-link';
import { DetentSheet } from './ui/detent-sheet';
import { Switch } from './ui/switch';
import { Button, Dialog } from './ui';

// 智能家居详情面板（smart-home-redesign §9）：卡片是入口，这里是这台设备的完整控制面板。
// 固定顺序：头部 → 主面板（按主实体类型定制）→ 主面板项 → 更多设置 → 设备信息 → 最近操作 → 管理（仅管理员）；空段不出现。
// 手机是两档 sheet（约 60% / 全屏），桌面居中弹窗、最大高 80vh；内容是同一份。

const TONE_TILE = {
  on: 'bg-accent text-white',
  off: 'bg-muted text-ink-soft',
  warn: 'bg-warm-soft text-warm',
  muted: 'bg-muted text-ink-soft opacity-60',
} as const;
const TONE_TEXT = { on: 'text-accent', off: 'text-ink', warn: 'text-warm', muted: 'text-ink-soft' } as const;

function allEntities(panel: SmartHomePanel): SmartHomePanelEntity[] {
  return [panel.primary, ...panel.featured, ...panel.more, ...panel.info];
}

function Header({ panel, timeZone, onClose }: { panel: SmartHomePanel; timeZone: string; onClose?: () => void }) {
  const { device } = panel;
  const line = deviceStatusLine(
    { icon: device.icon, primaryDomain: device.primaryDomain, primary: panel.primary.state, featured: panel.featured },
    { long: true },
  );
  const where = [device.area, [panel.manufacturer, panel.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const asOf = panel.asOf
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(panel.asOf))
    : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3.5">
        <span className={`grid size-[52px] shrink-0 place-items-center rounded-2xl ${TONE_TILE[line.tone]}`}>
          <SmartHomeIcon kind={device.icon} size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[22px] font-bold leading-tight">{device.displayName}</h2>
          {where ? <p className="truncate text-[13px] text-ink-soft">{where}</p> : null}
        </div>
        {onClose ? (
          <button
            type="button"
            aria-label="关闭"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-ink-soft transition-transform duration-150 active:scale-[.95]"
            onClick={onClose}
          >
            ✕
          </button>
        ) : null}
      </div>
      <div>
        <p data-smart-home-big-status className={`text-[19px] font-semibold leading-snug ${TONE_TEXT[line.tone]}`}>
          {line.text}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {!panel.connection.available && panel.connection.configured ? (
            <Tag tone="danger">{asOf ? `连不上 Home Assistant，显示的是 ${asOf} 的状态` : '连不上 Home Assistant'}</Tag>
          ) : null}
          {panel.primary.state?.assumed && panel.primary.state.state !== 'unavailable' ? <Tag>≈ 按上次操作显示</Tag> : null}
        </div>
      </div>
    </div>
  );
}

function Tag({ children, tone = 'warm' }: { children: ReactNode; tone?: 'warm' | 'danger' }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] ${tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warm-soft text-warm'}`}
    >
      {children}
    </span>
  );
}

function Folded({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="group rounded-[14px] border border-border">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-3.5 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-[13px] font-normal text-ink-soft">
          {count} 项 <span aria-hidden="true" className="inline-block transition-transform duration-150 group-open:rotate-90">›</span>
        </span>
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
  );
}

const time = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function Recent({ panel }: { panel: SmartHomePanel }) {
  const names = new Map(allEntities(panel).map((entity) => [entity.entityId, entity.name]));
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-ink-soft">最近操作</h3>
      {panel.recent.length ? (
        <ul data-smart-home-recent className="rounded-[14px] border border-border">
          {panel.recent.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-2.5 border-t border-border px-3 py-2.5 text-[13.5px] first:border-t-0">
              <span className="min-w-0 flex-1">
                {entry.memberName} · {entry.entityId !== panel.primary.entityId ? `${names.get(entry.entityId) ?? entry.entityId} · ` : ''}
                {SMART_HOME_ACTION_LABELS[entry.action]}
                {entry.status === 'failed' && entry.message ? (
                  <span className="block text-[12px] text-ink-soft">{entry.message}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-[12px] text-ink-soft">{time.format(new Date(entry.createdAt))}</span>
              <span className={entry.status === 'failed' ? 'text-danger' : entry.status === 'succeeded' ? 'text-accent' : 'text-ink-soft'}>
                {entry.status === 'failed' ? '✕' : entry.status === 'succeeded' ? '✓' : '…'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-soft">还没有人在小管家里操作过这台</p>
      )}
    </section>
  );
}

function Manage({ panel }: { panel: SmartHomePanel }) {
  const update = useUpdateSmartHomeDevice();
  const states = useSmartHomeStates();
  const { device } = panel;
  const pinned = (states.data?.devices ?? []).filter((one) => one.pinnedToToday && one.id !== device.id).length;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-ink-soft">管理</h3>
      <div className="rounded-[14px] border border-border">
        <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2">
          <span className="min-w-0 flex-1 text-sm">
            在今天页显示
            {!device.pinnedToToday && pinned >= SMART_HOME_TODAY_LIMIT ? (
              <span className="block text-[12px] text-warm">今天页已经有 {pinned} 台了，只显示前 {SMART_HOME_TODAY_LIMIT} 台</span>
            ) : null}
          </span>
          <Switch
            label="在今天页显示"
            checked={device.pinnedToToday}
            pending={update.isPending}
            onChange={(next) => update.mutate({ id: device.id, body: { pinnedToToday: next } })}
          />
        </div>
        {panel.pending.length ? (
          <div data-smart-home-pending className="flex items-center gap-3 border-t border-border px-3.5 py-2.5">
            <span className="min-w-0 flex-1 text-sm">
              {panel.pending.length} 个新实体待确认
              <span className="block truncate text-[12px] text-ink-soft">{panel.pending.map((one) => one.name).join('、')}</span>
            </span>
            <Button
              variant="outline"
              className="min-h-11 shrink-0 px-3"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { id: device.id, body: { acceptEntityIds: panel.pending.map((one) => one.entityId) } },
                  { onSuccess: () => pushToast('放出来了') },
                )
              }
            >
              放出来
            </Button>
          </div>
        ) : null}
        <div className="flex min-h-[52px] items-center gap-3 border-t border-border px-3.5 py-2">
          <span className="min-w-0 flex-1 text-sm">
            名称、房间、主实体和主面板项
            <span className="block truncate text-[12px] text-ink-soft">
              {device.displayName}
              {device.area ? ` · ${device.area}` : ''} · 主面板项 {device.featuredEntityIds.length} 个
            </span>
          </span>
          <SoftLink to={`/house/smart-home/settings?device=${device.id}`} className="shrink-0 text-sm text-accent">
            去设置 ›
          </SoftLink>
        </div>
      </div>
    </section>
  );
}

function Body({ panel, commands, timeZone, manager }: { panel: SmartHomePanel; commands: PendingCommands; timeZone: string; manager: boolean }) {
  // 断开时头部已经说了；传感器为主的设备本来就只能看
  const sensorOnly = panel.device.primaryDomain === 'sensor' || panel.device.primaryDomain === 'binary_sensor';
  const readOnlyNote =
    panel.canControl || !panel.connection.available
      ? null
      : panel.device.controllable
        ? '这台只有管理员能控制'
        : sensorOnly && !panel.device.controllable
          ? '这台在小管家里只能看'
          : '管理员还没开放控制';
  return (
    <div className="flex flex-col gap-5 pb-2">
      {readOnlyNote ? <p className="rounded-xl bg-muted px-3 py-2.5 text-[13px] text-ink-soft">{readOnlyNote}</p> : null}
      <PrimaryPanel panel={panel} commands={commands} timeZone={timeZone} />
      <FeaturedSection panel={panel} commands={commands} timeZone={timeZone} />
      {panel.more.length ? (
        <Folded title="更多设置" count={panel.more.length}>
          <ul data-smart-home-more>
            {panel.more.map((entity) => (
              <EntityRow key={entity.entityId} entity={entity} commands={commands} timeZone={timeZone} />
            ))}
          </ul>
        </Folded>
      ) : null}
      {panel.info.length + panel.excluded.length ? (
        <Folded title="设备信息" count={panel.info.length + panel.excluded.length}>
          <ul data-smart-home-info>
            {panel.info.map((entity) => (
              <EntityRow key={entity.entityId} entity={{ ...entity, control: null }} commands={commands} timeZone={timeZone} />
            ))}
            {panel.excluded.map((entity) => (
              <li key={entity.entityId} data-smart-home-excluded={entity.entityId} className="border-t border-border px-3.5 py-2.5 first:border-t-0">
                <span className="block text-sm text-ink-soft">{entity.name}</span>
                <span className="block text-[12px] text-ink-soft">此操作请在厂商 App 完成</span>
              </li>
            ))}
          </ul>
        </Folded>
      ) : null}
      <Recent panel={panel} />
      {manager ? <Manage panel={panel} /> : null}
    </div>
  );
}

/** 打开一台设备的详情：手机两档 sheet，桌面（≥ 640px）居中弹窗。 */
export function DeviceDetail({ deviceId, name, onClose }: { deviceId: string; name: string; onClose: () => void }) {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const timeZone = session?.householdTimezone ?? 'Asia/Shanghai';
  const panel = useSmartHomePanel(deviceId);
  const lastUpdated = useMemo(
    () => Object.fromEntries((panel.data ? allEntities(panel.data) : []).map((entity) => [entity.entityId, entity.state?.lastUpdated ?? null])),
    [panel.data],
  );
  const commands = usePendingCommands(deviceId, lastUpdated);
  const desktop = useMediaQuery('(min-width: 640px)');

  const body = panel.data ? (
    <Body panel={panel.data} commands={commands} timeZone={timeZone} manager={manager} />
  ) : panel.isError ? (
    <QueryFailure onRetry={() => void panel.refetch()} />
  ) : (
    <ListSkeleton rows={4} />
  );

  if (desktop) {
    return (
      <Dialog title={name} onClose={onClose} maxWidth={520} maxHeight="80vh" place="center" titleBar={false}>
        <div data-smart-home-panel={deviceId} className="flex flex-col gap-5 px-1 pt-1">
          {panel.data ? <Header panel={panel.data} timeZone={timeZone} onClose={onClose} /> : null}
          {body}
        </div>
      </Dialog>
    );
  }
  return (
    <DetentSheet
      title={name}
      onClose={onClose}
      header={
        panel.data ? (
          <Header panel={panel.data} timeZone={timeZone} onClose={onClose} />
        ) : (
          <h2 className="text-[22px] font-bold">{name}</h2>
        )
      }
    >
      <div data-smart-home-panel={deviceId}>{body}</div>
    </DetentSheet>
  );
}
