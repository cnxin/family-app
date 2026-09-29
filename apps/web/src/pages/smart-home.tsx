import { useState } from 'react';
import type { SmartHomeConnection, SmartHomeDeviceWithState } from '@family/contracts';
import { useAuth } from '../lib/auth';
import { useSmartHomeStates } from '../lib/queries';
import { groupByArea, smartHomeStateLine, type StateLine } from '../lib/smart-home-copy';
import { QueryFrame } from '../components/query-state';
import { ListSkeleton } from '../components/skeleton';
import { SmartHomeControls } from '../components/smart-home-controls';
import { DeviceDetail } from '../components/smart-home-panel';
import { SoftLink } from '../components/soft-link';
import { Button, EmptyState, Page, Panel } from '../components/ui';

// H3：家里人在天天打开的页面上看一眼、按一下常用设备；要看全部实体、做复杂设置，去 HA App（方案 §0）。
// 能不能按由服务端按设备的 minRole 算好（canControl），每次按还会再校验一次。

const TONE: Record<StateLine['tone'], string> = {
  on: 'text-accent',
  warn: 'text-warm',
  off: 'text-ink',
  muted: 'text-ink-soft',
};

function DeviceRow({
  device,
  timeZone,
  live,
  onOpen,
}: {
  device: SmartHomeDeviceWithState;
  timeZone: string;
  live: boolean;
  onOpen: () => void;
}) {
  const line = smartHomeStateLine(device.primaryDomain, device.primary, timeZone);
  return (
    <li data-smart-home-device={device.primaryEntityId} className="border-b border-border px-3.5 py-2.5 last:border-b-0">
      <div className="flex min-h-7 items-center gap-3">
        <button
          type="button"
          aria-label={`打开${device.displayName}的详情`}
          className="min-h-11 min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-accent"
          onClick={onOpen}
        >
          {device.displayName}
        </button>
        <span className="shrink-0 text-right">
          <span className={`block text-sm ${TONE[line.tone]}`}>{line.text}</span>
          {line.detail ? <span className="block text-[12px] text-ink-soft">{line.detail}</span> : null}
          {device.primary?.assumed && device.primary.state !== 'unavailable' ? (
            <span data-smart-home-assumed className="block text-[11px] text-warm">按上次操作显示</span>
          ) : null}
        </span>
      </div>
      {device.canControl && live ? (
        <div className="mt-2 flex justify-end">
          <SmartHomeControls device={device} />
        </div>
      ) : null}
    </li>
  );
}

function ConnectionPanel({ connection, manager }: { connection: SmartHomeConnection; manager: boolean }) {
  const checked = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(connection.checkedAt),
  );
  return (
    <Panel title="Home Assistant" grow={false}>
      <div data-smart-home-connection={connection.available ? 'ok' : 'down'} className="flex flex-col gap-1 px-3.5 py-3">
        <p className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${connection.available ? 'bg-accent' : connection.configured ? 'bg-danger' : 'bg-ink-soft'}`}
          />
          {connection.available ? '已连接' : connection.configured ? '连不上' : '还没连上'}
        </p>
        <p className="text-[12px] text-ink-soft">
          {connection.available
            ? `${checked} 读的状态`
            : connection.configured
              ? connection.message
              : manager
                ? '填好地址和长期访问令牌就能连上'
                : '等管理员连好'}
        </p>
        {manager ? (
          <SoftLink to="/house/smart-home/settings" className="mt-1 text-[13px] text-accent">
            连接与设备设置
          </SoftLink>
        ) : null}
      </div>
    </Panel>
  );
}

export function SmartHomePage() {
  const { session } = useAuth();
  const [opened, setOpened] = useState<{ id: string; name: string } | null>(null);
  const manager = session?.member.role !== 'member';
  const timeZone = session?.householdTimezone ?? 'Asia/Shanghai';
  const states = useSmartHomeStates();
  const data = states.data;
  const isScene = (device: SmartHomeDeviceWithState) => device.primaryDomain === 'scene' || device.primaryDomain === 'script';
  const scenes = data?.devices.filter(isScene) ?? [];
  const groups = data ? groupByArea(data.devices.filter((device) => !isScene(device))) : [];
  // HA 连不上时服务端给的是上次的状态（stale）：照样显示，但按不了
  const live = Boolean(data?.connection.available);
  const staleAt =
    data?.stale && data.asOf
      ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(data.asOf))
      : null;

  return (
    <Page
      title="智能家居"
      subtitle="家里常用的几样设备：看一眼，按一下"
      actions={
        <Button
          variant="outline"
          className="min-h-11 px-3"
          disabled={states.isFetching}
          onClick={() => void states.refetch()}
        >
          {states.isFetching ? '正在读…' : '刷新'}
        </Button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <QueryFrame query={states} skeleton={<Panel className="p-3"><ListSkeleton rows={4} /></Panel>}>
          {data && data.connection.configured && !data.connection.available ? (
            <p role="status" className="rounded-card border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
              连不上 Home Assistant：{data.connection.message}。{staleAt ? `下面是 ${staleAt} 的状态，暂时按不了。` : ''}家里其他功能不受影响。
            </p>
          ) : null}
          {data && !data.devices.length ? (
            <Panel className="p-3">
              <EmptyState
                emoji="🏠"
                title={data.connection.configured ? '还没挑设备' : '还没连上 Home Assistant'}
                hint={
                  manager ? (
                    <SoftLink to="/house/smart-home/settings" className="text-accent">
                      {data.connection.configured ? '去挑几样常用的设备' : '去填地址和令牌'}
                    </SoftLink>
                  ) : (
                    '等管理员连好之后，这里会列出家里常用的设备'
                  )
                }
              />
            </Panel>
          ) : (
            groups.map((group) => (
              <Panel key={group.area} title={group.area} grow={false}>
                <ul>
                  {group.items.map((device) => (
                    <DeviceRow
                      key={device.id}
                      device={device}
                      timeZone={timeZone}
                      live={live}
                      onOpen={() => setOpened({ id: device.id, name: device.displayName })}
                    />
                  ))}
                </ul>
              </Panel>
            ))
          )}
        </QueryFrame>
      </div>
      {data ? (
        <aside className="flex shrink-0 flex-col gap-4 lg:w-[300px]">
          {scenes.length ? (
            <Panel title="场景" grow={false}>
              <ul>
                {scenes.map((scene) => (
                  <li
                    key={scene.id}
                    data-smart-home-device={scene.primaryEntityId}
                    className="flex min-h-12 items-center gap-3 border-b border-border px-3.5 py-2 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{scene.displayName}</span>
                    {live ? <SmartHomeControls device={scene} /> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <ConnectionPanel connection={data.connection} manager={manager} />
        </aside>
      ) : null}
      {opened ? <DeviceDetail deviceId={opened.id} name={opened.name} onClose={() => setOpened(null)} /> : null}
    </Page>
  );
}
