import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  AgentSettings,
  BackupDashboard,
  MediaConnectorSettings,
  Member,
  NotificationChannel,
  SmartHomeConnectorSettings,
} from '@family/contracts';
import { useAuth } from '../lib/auth';
import { modulesKey } from '../lib/queries/modules';
import { shelfSegments } from '../lib/nav';
import { timeZoneLabel } from '../lib/timezones';
import { useUpdateHouseholdTimezone } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { TimezoneDialog } from '../components/timezone-dialog';
import { SoftLink } from '../components/soft-link';
import { Page, Panel } from '../components/ui';

function useCached<T>(queryKey: readonly unknown[]) {
  return useQuery<T>({
    queryKey,
    queryFn: () => Promise.reject(new Error('只读缓存')),
    enabled: false,
  }).data;
}

function Row({ to, title, hint, status }: { to: string; title: string; hint: string; status: string | null }) {
  return (
    <SoftLink to={to} className="flex min-h-11 items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0 hover:bg-muted">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-[12px] text-ink-soft">{hint}</span>
      </span>
      {status ? <span className="shrink-0 text-[12px] text-ink-soft">{status}</span> : null}
    </SoftLink>
  );
}

export function SettingsPage() {
  const { session } = useAuth();
  const update = useUpdateHouseholdTimezone();
  const [picking, setPicking] = useState(false);
  const role = session?.member.role;
  const timezone = session?.householdTimezone ?? 'Asia/Shanghai';
  const members = useCached<Member[]>(['members']);
  const backups = useCached<BackupDashboard>(['backup-dashboard']);
  const connectors = useCached<MediaConnectorSettings[]>(['media-connector-settings']);
  const channels = useCached<NotificationChannel[]>(['notification-channels']);
  const agent = useCached<AgentSettings>(['agent-settings']);
  const smartHome = useCached<SmartHomeConnectorSettings>(['smart-home-connector-settings']);
  const modules = useCached<{ modules: { key: string; override: 'on' | 'off' | null; hasData: boolean }[] }>(modulesKey);

  if (role === 'member') return <Navigate to="/me/profile" replace />;

  const succeeded = backups?.runs.find((run) => run.status === 'succeeded' && run.finishedAt);
  const available = modules
    ? shelfSegments(session?.member).filter((segment) => {
        const entry = modules.modules.find((one) => one.key === segment.key);
        const visible = entry ? entry.override === 'on' || (entry.override !== 'off' && entry.hasData) : false;
        return !visible;
      }).length
    : null;

  return (
    <Page title="家庭设置" subtitle="成员、备份和家里怎么过日子">
      <Panel grow={false}>
        <button
          type="button"
          className="flex min-h-11 w-full flex-col gap-1 border-b border-border px-3.5 py-3 text-left hover:bg-muted"
          onClick={() => setPicking(true)}
        >
          <span className="flex w-full items-center gap-3">
            <span className="text-sm font-medium">家庭时区</span>
            <span className="ml-auto shrink-0 text-[13px] text-accent">{timeZoneLabel(timezone)}</span>
          </span>
          <span className="text-[12px] leading-relaxed text-ink-soft">
            改变时区不会移动已记录的日期，只影响「今天」的判断。
          </span>
        </button>
        <Row to="/house/members" title="成员" hint="谁在这个家里，谁能管事" status={members ? `${members.length} 位成员` : null} />
        <Row
          to="/house/backups"
          title="备份"
          hint="家里的数据什么时候拷过一份"
          status={
            succeeded?.finishedAt
              ? `${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(succeeded.finishedAt))} 成功`
              : null
          }
        />
        <Row to="/life/media/settings" title="观影连接" hint="Plex、Emby 这些片库怎么接进来" status={connectors ? `${connectors.length} 个连接` : null} />
        <Row
          to="/house/smart-home/settings"
          title="智能家居"
          hint="连上 Home Assistant，挑几样家里人常看的设备"
          status={smartHome ? (smartHome.configured ? '已连接' : '未连接') : null}
        />
        <Row to="/schedule/notifications?view=channels" title="外部通知渠道" hint="提醒发到手机上的哪一条渠道" status={channels ? `${channels.length} 个渠道` : null} />
        <Row to="/me/assistant?settings=1" title="小管家设置" hint="谁来回答，以及外部账号怎么配对" status={agent ? (agent.enabled ? '已启用' : '未启用') : null} />
        <Row to="/home" title="功能开关" hint="家里页底部那些还没摆出来的功能" status={available == null ? null : `${available} 项可以开启`} />
      </Panel>
      {picking ? (
        <TimezoneDialog
          current={timezone}
          pending={update.isPending}
          onClose={() => setPicking(false)}
          onPick={(zone) => {
            if (zone === timezone) {
              setPicking(false);
              return;
            }
            update.mutate(zone, {
              onSuccess: () => {
                pushToast('家庭时区已更新', undefined, 'success');
                setPicking(false);
              },
              onError: (error) => pushToast(error instanceof Error ? error.message : '没改成', undefined, 'error'),
            });
          }}
        />
      ) : null}
    </Page>
  );
}
