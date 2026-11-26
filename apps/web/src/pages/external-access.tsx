import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  type DeviceFilter,
  deviceAttentionNeeded,
  filterDevices,
  formatClock,
  sortDevices,
} from '../lib/external-access-copy';
import {
  useExternalAccessOverview,
  useRefreshExternalAccessOverview,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { ExternalAccessDeviceSheet } from '../components/external-access-device-sheet';
import {
  AlertsBanner,
  DeviceRow,
  PublicAccessCard,
  ServerNodeCard,
  SummaryStrip,
} from '../components/external-access-overview-parts';
import { QueryFrame } from '../components/query-state';
import { ListSkeleton } from '../components/skeleton';
import { SoftLink } from '../components/soft-link';
import { Button, EmptyState, Page, Panel, Segmented } from '../components/ui';

const FILTERS: { value: DeviceFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'online', label: '在线' },
  { value: 'attention', label: '需留意' },
];

/** /house/external-access：Tailscale 只读概览、小管家节点、私有入口二维码与设备列表（仅管理员）。 */
export function ExternalAccessPage() {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const timeZone = session?.householdTimezone ?? 'Asia/Shanghai';
  const overview = useExternalAccessOverview(manager);
  const refresh = useRefreshExternalAccessOverview();
  const [filter, setFilter] = useState<DeviceFilter>('all');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  if (!manager) {
    return (
      <Page title="外部访问" subtitle="通过 Tailscale 在家外安全访问小管家">
        <Panel className="p-3">
          <EmptyState
            emoji="🔐"
            title="这一页只有家庭管理员能看"
            hint="里面包含家庭 tailnet 的节点与设备状态"
          />
        </Panel>
      </Page>
    );
  }

  const data = overview.data;
  const linkedId = params.get('device');
  const openedId = pickedId ?? (linkedId && data?.devices.some((device) => device.id === linkedId) ? linkedId : null);
  const openedSummary = openedId ? data?.devices.find((device) => device.id === openedId) : undefined;
  const closeSheet = () => {
    setPickedId(null);
    if (linkedId) setParams({}, { replace: true });
  };

  const restricted = data?.accessScope === 'restricted';
  const configured = Boolean(data?.connection.configured);
  const live = Boolean(data?.connection.available);
  const checkedAt = formatClock(data?.connection.checkedAt ?? null, timeZone);
  const connectionAttr = !data
    ? 'loading'
    : restricted
      ? 'restricted'
      : !configured
        ? 'unconfigured'
        : live
          ? 'ok'
          : 'down';

  const sortedDevices = data ? sortDevices(data.devices) : [];
  const attentionDeviceCount = sortedDevices.filter(deviceAttentionNeeded).length;
  const visibleDevices = filterDevices(sortedDevices, filter);

  async function handleRefresh() {
    try {
      const next = await refresh.mutateAsync();
      navigator.vibrate?.(10);
      if (next.connection.available) {
        pushToast('已刷新设备状态', undefined, 'success');
      }
    } catch {
      // MutationCache.onError 已统一弹出错误提示，避免重复 toast
    }
  }

  return (
    <Page
      title="外部访问"
      subtitle={
        data ? (
          <span data-external-access-connection={connectionAttr} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-[7px] rounded-full ${
                restricted
                  ? 'bg-warm'
                  : live
                    ? 'bg-accent'
                    : configured
                      ? 'bg-danger'
                      : 'bg-ink-soft'
              }`}
            />
            {restricted
              ? '未开放服务器默认配置'
              : !configured
                ? '尚未配置 Tailscale 控制面'
                : live
                  ? `${data.summary.onlineDevices} / ${data.summary.totalDevices} 台在线 · ${checkedAt ?? ''} 同步`
                  : '连不上 Tailscale 控制面'}
          </span>
        ) : (
          '通过 Tailscale 在家外安全访问小管家'
        )
      }
      actions={
        <div className="flex items-center gap-2">
          {configured && !restricted ? (
            <Button
              variant="outline"
              className="min-h-11 px-3.5"
              disabled={refresh.isPending || overview.isFetching}
              onClick={() => void handleRefresh()}
            >
              {refresh.isPending ? '刷新中…' : '刷新'}
            </Button>
          ) : null}
          <SoftLink
            to="/house/external-access/settings"
            className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3.5 text-sm transition-colors duration-150 hover:bg-muted"
          >
            设置
          </SoftLink>
        </div>
      }
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <QueryFrame query={overview} skeleton={<Panel className="p-3"><ListSkeleton rows={4} /></Panel>}>
          {data && restricted ? (
            <Panel className="p-3">
              <EmptyState
                emoji="🔒"
                title="此家庭未开放服务器默认外部访问"
                hint={
                  <span className="flex flex-col items-center gap-2">
                    <span>{data.accessMessage ?? '多家庭实例下，服务器默认 tailnet 仅对主家庭开放。'}</span>
                    <SoftLink to="/house/external-access/settings" className="text-accent hover:underline">
                      前往设置配置本家庭独立的 Tailscale 连接 →
                    </SoftLink>
                  </span>
                }
              />
            </Panel>
          ) : data && !configured ? (
            <Panel className="p-4">
              <EmptyState
                emoji="🌐"
                title="还没接入 Tailscale 控制面"
                hint={
                  <span className="flex max-w-md flex-col items-center gap-2.5 leading-relaxed">
                    <span>
                      先在宿主机开启 <code className="rounded bg-muted px-1 py-0.5 text-[12px]">tailscale serve</code>，
                      再填写只读 OAuth 客户端（<code className="rounded bg-muted px-1 py-0.5 text-[12px]">devices:core:read</code>），
                      就能在这里查看节点状态、设备列表与密钥到期提醒。
                    </span>
                    <SoftLink
                      to="/house/external-access/settings"
                      className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-transform duration-150 hover:brightness-110 active:scale-[.985]"
                    >
                      去配置外部访问
                    </SoftLink>
                  </span>
                }
              />
            </Panel>
          ) : data ? (
            <>
              {!live ? (
                <div
                  role="status"
                  className="flex items-start gap-3 rounded-card bg-danger/10 px-3.5 py-3 text-sm text-danger"
                >
                  <span className="min-w-0 flex-1">
                    连不上 Tailscale 控制面{data.connection.message ? `（${data.connection.message}）` : ''}。家里其他功能不受影响。
                  </span>
                  <Button
                    variant="outline"
                    className="min-h-9 shrink-0 px-3"
                    disabled={refresh.isPending}
                    onClick={() => void handleRefresh()}
                  >
                    {refresh.isPending ? '正在连…' : '重试'}
                  </Button>
                </div>
              ) : null}

              <AlertsBanner alerts={data.alerts} onSelectDevice={setPickedId} />
              <SummaryStrip summary={data.summary} attentionCount={attentionDeviceCount} />

              <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start">
                <div className="flex flex-col gap-4 lg:w-[340px] lg:shrink-0">
                  <ServerNodeCard
                    node={data.node}
                    expectedHostname={data.nodeHostname}
                    onInspect={setPickedId}
                  />
                  {data.publicUrl ? (
                    <PublicAccessCard
                      publicUrl={data.publicUrl}
                      corsOriginMatched={data.corsOriginMatched}
                    />
                  ) : null}
                </div>

                <Panel
                  title={`Tailnet 设备（${visibleDevices.length}）`}
                  right={
                    <Segmented<DeviceFilter>
                      label="筛选设备"
                      value={filter}
                      options={FILTERS}
                      onChange={setFilter}
                    />
                  }
                >
                  {visibleDevices.length ? (
                    <div>
                      {visibleDevices.map((device) => (
                        <DeviceRow
                          key={device.id}
                          device={device}
                          onSelect={() => setPickedId(device.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      emoji="📱"
                      title={filter === 'all' ? 'tailnet 里还没有设备' : '这个筛选下没有设备'}
                      hint={filter === 'all' ? '稍后点击右上角刷新重试' : '切换到「全部」查看所有设备'}
                    />
                  )}
                </Panel>
              </div>
            </>
          ) : null}
        </QueryFrame>
      </div>

      {openedId ? (
        <ExternalAccessDeviceSheet
          deviceId={openedId}
          summary={openedSummary}
          timeZone={timeZone}
          onClose={closeSheet}
        />
      ) : null}
    </Page>
  );
}
