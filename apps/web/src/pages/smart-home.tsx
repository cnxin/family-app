import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SmartHomeDeviceWithState } from '@family/contracts';
import { useAuth } from '../lib/auth';
import { useSmartHomeStates } from '../lib/queries';
import { groupByArea } from '../lib/smart-home-copy';
import { QueryFrame } from '../components/query-state';
import { ListSkeleton } from '../components/skeleton';
import { DeviceCard, SceneChip } from '../components/smart-home-card';
import { DeviceDetail } from '../components/smart-home-panel';
import { SoftLink } from '../components/soft-link';
import { Button, EmptyState, Page, Panel } from '../components/ui';

// 智能家居页（smart-home-redesign §2）：三层——场景一排（一键执行，没有就不出现）→ 房间分段 → 设备卡网格
// （手机两列、桌面四列）；点卡片打开这台设备的完整控制面板（§9）。状态经 /events 推送，页面不需要刷新按钮；
// HA 断开时顶上一条横幅（带「重试」），卡片保留上次状态去色、收起主按钮。

const isScene = (device: SmartHomeDeviceWithState) => device.primaryDomain === 'scene' || device.primaryDomain === 'script';

/** 房间按分组名排，没分组的归「其他」放最后；房间里离线的排到末尾（其余保持服务端的排序）。 */
function rooms(devices: SmartHomeDeviceWithState[]) {
  return groupByArea(devices).map((group) => ({
    ...group,
    items: [...group.items.filter((device) => device.online), ...group.items.filter((device) => !device.online)],
  }));
}

export function SmartHomePage() {
  const { session } = useAuth();
  const [picked, setOpened] = useState<{ id: string; name: string } | null>(null);
  // ?device=<id>：今天页「滤芯快用完了」这类留意卡直接打开那台的详情
  const [params, setParams] = useSearchParams();
  const linked = params.get('device');
  const manager = session?.member.role !== 'member';
  const timeZone = session?.householdTimezone ?? 'Asia/Shanghai';
  const states = useSmartHomeStates();
  const data = states.data;
  const live = Boolean(data?.connection.available);
  const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  const asOf = data?.asOf ? clock.format(new Date(data.asOf)) : null;
  const scenes = data?.devices.filter(isScene) ?? [];
  const groups = data ? rooms(data.devices.filter((device) => !isScene(device))) : [];
  const count = data?.devices.filter((device) => !isScene(device)).length ?? 0;
  const linkedDevice = linked ? data?.devices.find((device) => device.id === linked) : undefined;
  const opened = picked ?? (linkedDevice ? { id: linkedDevice.id, name: linkedDevice.displayName } : null);
  const close = () => {
    setOpened(null);
    if (linked) setParams({}, { replace: true });
  };

  return (
    <Page
      title="智能家居"
      subtitle={
        data ? (
          <span data-smart-home-connection={live ? 'ok' : 'down'} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-[7px] rounded-full ${live ? 'bg-accent' : data.connection.configured ? 'bg-danger' : 'bg-ink-soft'}`}
            />
            {count} 台设备 · {live ? `${asOf ?? ''} 同步` : data.connection.configured ? '连不上 Home Assistant' : '还没连上'}
          </span>
        ) : (
          '家里常用的几样设备：看一眼，按一下'
        )
      }
      actions={
        manager ? (
          <SoftLink
            to="/house/smart-home/settings"
            className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3.5 text-sm hover:bg-muted"
          >
            设置
          </SoftLink>
        ) : null
      }
    >
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <QueryFrame query={states} skeleton={<Panel className="p-3"><ListSkeleton rows={4} /></Panel>}>
          {data && data.connection.configured && !live ? (
            <div role="status" className="flex items-start gap-3 rounded-card bg-danger/10 px-3.5 py-3 text-sm text-danger">
              <span className="min-w-0 flex-1">
                连不上 Home Assistant{data.connection.message ? `（${data.connection.message}）` : ''}。
                {data.stale && asOf ? `下面是 ${asOf} 的状态，暂时按不了。` : ''}家里其他功能不受影响。
              </span>
              <Button
                variant="outline"
                className="min-h-9 shrink-0 px-3"
                disabled={states.isFetching}
                onClick={() => void states.refetch()}
              >
                {states.isFetching ? '正在连…' : '重试'}
              </Button>
            </div>
          ) : null}
          {data && !data.devices.length ? (
            <Panel className="p-3">
              <EmptyState
                emoji="🏠"
                title={data.connection.configured ? '还没挑设备' : '还没连上 Home Assistant'}
                hint={
                  manager ? (
                    <SoftLink to="/house/smart-home/settings" className="text-accent">
                      {data.connection.configured ? '去挑几台常用的设备' : '去填地址和令牌'}
                    </SoftLink>
                  ) : (
                    '等管理员连好之后，这里会列出家里常用的设备'
                  )
                }
              />
            </Panel>
          ) : (
            <>
              {scenes.length && live ? (
                <div aria-label="场景" role="group" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
                  {scenes.map((scene) => (
                    <SceneChip key={scene.id} device={scene} live={live} />
                  ))}
                </div>
              ) : null}
              {groups.map((group) => (
                <section key={group.area} aria-labelledby={`room-${group.area}`}>
                  <h2 id={`room-${group.area}`} className="mb-2 px-1 text-[13px] font-semibold tracking-wide text-ink-soft">
                    {group.area}
                  </h2>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {group.items.map((device) => (
                      <DeviceCard
                        key={device.id}
                        device={device}
                        live={live}
                        onOpen={() => setOpened({ id: device.id, name: device.displayName })}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </QueryFrame>
      </div>
      {opened ? <DeviceDetail deviceId={opened.id} name={opened.name} onClose={close} /> : null}
    </Page>
  );
}
