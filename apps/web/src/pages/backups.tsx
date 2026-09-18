import { useState } from 'react';
import type { BackupRun } from '@family/contracts';
import {
  BACKUP_KIND_LABELS,
  BACKUP_STATUS_LABELS,
  backupBytes,
  backupKey,
  backupTime,
  useBackupDashboard,
  useCancelBackupRun,
  useQueueBackupRun,
  useQueueRestoreDrill,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { BackupPolicyPanel } from '../components/backup-policy-form';
import { ListSkeleton } from '../components/skeleton';
import { pushToast } from '../lib/toast';
import { Button, Dialog, EmptyState, Page, Panel } from '../components/ui';

type Ask =
  | { kind: 'backup' }
  | { kind: 'capacity' }
  | { kind: 'drill'; run: BackupRun }
  | { kind: 'cancel'; run: BackupRun };

const STATUS_STYLE: Record<string, string> = {
  succeeded: 'bg-accent-soft text-accent',
  failed: 'bg-danger/10 text-danger',
  running: 'bg-warm-soft text-warm',
  queued: 'bg-warm-soft text-warm',
  cancelled: 'bg-muted text-ink-soft',
};

const CAPACITY_LABEL: Record<string, string> = {
  unknown: '还没查过',
  ok: '正常',
  warning: '快满了',
  critical: '严重不足',
};

export function BackupsPage() {
  const { session } = useAuth();
  const canManage = session?.member.role !== 'member';

  const dashboard = useBackupDashboard(canManage);
  const queue = useQueueBackupRun();
  const drill = useQueueRestoreDrill();
  const cancel = useCancelBackupRun();
  const [ask, setAsk] = useState<Ask | null>(null);

  if (!canManage) {
    return (
      <Page title="系统备份" subtitle="家里这些数据的保护和恢复">
        <Panel className="p-3">
          <EmptyState emoji="🔐" title="这一页只有家庭管理员能看" hint="备份和恢复涉及全家的数据" />
        </Panel>
      </Page>
    );
  }

  if (dashboard.isPending) {
    return (
      <Page title="系统备份" subtitle="正在读备份状态">
        <Panel className="p-3">
          <ListSkeleton rows={4} />
        </Panel>
      </Page>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <Page title="系统备份" subtitle="家里这些数据的保护和恢复">
        <Panel className="p-3">
          <EmptyState emoji="💾" title="备份状态读不出来" hint="刷新一下，还不行就看看 API 服务" />
        </Panel>
      </Page>
    );
  }

  const { policy, workerOnline, activeRun, runs } = dashboard.data;
  const latestBackup = runs.find((run) => run.artifactAvailable) ?? null;
  const busy = queue.isPending || drill.isPending || cancel.isPending;
  const total = Number(policy.storageTotalBytes ?? 0);
  const used = Number(policy.storageUsedBytes ?? 0);
  const percent = total ? Math.min(100, Math.round((used / total) * 100)) : 0;

  function confirm() {
    if (!ask) return;
    const done = (text: string) => () => {
      setAsk(null);
      pushToast(text);
    };
    if (ask.kind === 'backup') {
      queue.mutate(
        { kind: 'backup', idempotencyKey: backupKey('backup') },
        { onSuccess: done('备份任务排上了，worker 领走就开始跑') },
      );
    } else if (ask.kind === 'capacity') {
      queue.mutate(
        { kind: 'capacity_check', idempotencyKey: backupKey('capacity_check') },
        { onSuccess: done('容量检查排上了') },
      );
    } else if (ask.kind === 'drill') {
      drill.mutate(
        { sourceRunId: ask.run.id, idempotencyKey: backupKey(`restore:${ask.run.id}`) },
        { onSuccess: done('恢复演练排上了，跑在临时库里，不动正在用的库') },
      );
    } else {
      cancel.mutate({ id: ask.run.id }, { onSuccess: done('排队的任务取消了') });
    }
  }

  return (
    <Page
      title="系统备份"
      subtitle="家里这些数据的保护和恢复"
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            className="h-9 px-3 text-[13px]"
            disabled={busy || Boolean(activeRun) || !workerOnline}
            onClick={() => setAsk({ kind: 'capacity' })}
          >
            查容量
          </Button>
          <Button
            className="h-9 px-3 text-[13px]"
            disabled={busy || Boolean(activeRun) || !workerOnline}
            onClick={() => setAsk({ kind: 'backup' })}
          >
            立即备份
          </Button>
        </div>
      }
    >
      <Panel title={`运行历史 ${runs.length}`}>
        {runs.length === 0 ? (
          <EmptyState emoji="💾" title="还没有跑过备份" hint="点右上角「立即备份」排一次" />
        ) : (
          runs.map((run, index) => (
            <div
              key={run.id}
              aria-label={`${BACKUP_KIND_LABELS[run.kind]} ${backupTime(run.finishedAt ?? run.createdAt)}`}
              className={'flex flex-wrap items-center gap-2 px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')}
            >
              <div className="min-w-[180px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px]">{BACKUP_KIND_LABELS[run.kind]}</span>
                  <span
                    className={
                      'rounded-full px-2 py-0.5 text-[11px] ' +
                      (STATUS_STYLE[run.status] ?? 'bg-muted text-ink-soft')
                    }
                  >
                    {BACKUP_STATUS_LABELS[run.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-soft">
                  {backupTime(run.finishedAt ?? run.createdAt)} ·{' '}
                  {run.trigger === 'manual' ? (run.requestedBy?.name ?? '管理员') : '自动计划'}
                  {run.kind === 'backup' && run.status === 'succeeded'
                    ? ` · ${backupBytes(run.totalBytes)} · ${run.retained ? '还留着' : '已按策略清掉'} · 校验${run.checksumVerified ? '通过' : '待确认'}`
                    : ''}
                  {run.kind === 'restore_drill' && run.restoredMigrationCount
                    ? ` · 验了 ${run.restoredMigrationCount} 条迁移`
                    : ''}
                </p>
                {run.errorMessage ? (
                  <p className="mt-0.5 text-[12px] text-danger">
                    {run.errorMessage}
                    {run.errorCode ? `（${run.errorCode}）` : ''}
                  </p>
                ) : null}
              </div>
              {run.status === 'queued' ? (
                <Button
                  variant="ghost"
                  className="h-8 shrink-0 px-2 text-[13px] text-danger"
                  disabled={busy}
                  onClick={() => setAsk({ kind: 'cancel', run })}
                >
                  取消
                </Button>
              ) : null}
              {run.artifactAvailable ? (
                <Button
                  variant="ghost"
                  className="h-8 shrink-0 px-2 text-[13px]"
                  aria-label={`拿这次备份做恢复演练`}
                  // worker 离线时排了也没人领，所以这里和顶部按钮一样要判 workerOnline
                  disabled={busy || Boolean(activeRun) || !workerOnline}
                  onClick={() => setAsk({ kind: 'drill', run })}
                >
                  恢复演练
                </Button>
              ) : null}
            </div>
          ))
        )}
      </Panel>

      <aside className="flex shrink-0 flex-col gap-4 lg:w-[320px]">
        <Panel title="现在的状态" grow={false}>
          <div className="flex flex-col gap-2.5 px-3.5 py-3 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">备份 worker</span>
              <span className={workerOnline ? 'text-accent' : 'text-danger'}>
                {workerOnline ? '在线' : '离线'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">存储</span>
              <span
                className={
                  policy.capacityStatus === 'critical'
                    ? 'text-danger'
                    : policy.capacityStatus === 'warning'
                      ? 'text-warm'
                      : ''
                }
              >
                {CAPACITY_LABEL[policy.capacityStatus]} · 用了 {percent}%
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">还能存</span>
              <span>{backupBytes(policy.storageAvailableBytes)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">最近一次备份</span>
              <span>
                {latestBackup ? backupBytes(latestBackup.totalBytes) : '还没有'}
                {latestBackup ? ` · ${backupTime(latestBackup.finishedAt)}` : ''}
              </span>
            </div>
          </div>
          {activeRun ? (
            <div className="border-t border-border px-3.5 py-2.5 text-[13px]">
              <p>
                {BACKUP_KIND_LABELS[activeRun.kind]} · {BACKUP_STATUS_LABELS[activeRun.status]}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                {activeRun.status === 'running'
                  ? `最近心跳 ${backupTime(activeRun.heartbeatAt)}`
                  : `排在 ${backupTime(activeRun.scheduledFor)}`}
              </p>
            </div>
          ) : null}
          {!workerOnline ? (
            <p className="border-t border-border px-3.5 py-2.5 text-[12px] text-ink-soft">
              worker 离线时排的任务没人领，所以先把它拉起来再操作。长任务跑到一半心跳也可能断，
              这时候显示离线是正常的。
            </p>
          ) : null}
        </Panel>

        {/* key 用 id 不用 updatedAt：看板每 10 秒轮询一次，按 updatedAt 重挂载
            会把人正在填的策略表单冲掉 */}
        <BackupPolicyPanel key={policy.id} policy={policy} />
      </aside>

      {ask ? (
        <Dialog
          title={
            ask.kind === 'backup'
              ? '现在备份一次？'
              : ask.kind === 'capacity'
                ? '查一下备份盘还剩多少？'
                : ask.kind === 'drill'
                  ? '拿这次备份做恢复演练？'
                  : '取消这个排队任务？'
          }
          onClose={() => setAsk(null)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAsk(null)}>
                再等等
              </Button>
              <Button className="flex-1" disabled={busy} onClick={confirm}>
                {ask.kind === 'cancel' ? '确认取消' : '排进队列'}
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            {ask.kind === 'backup'
              ? '会导出数据库、打包上传的文件，再生成清单和校验和；跑完自动按保留策略清理并查一次容量。'
              : ask.kind === 'capacity'
                ? 'worker 会刷新总容量、已用空间和告警状态，不动现有备份。'
                : ask.kind === 'drill'
                  ? `会用 ${backupTime(ask.run.finishedAt)} 那次备份，在一个临时库里还原一遍、验校验和与迁移，完事就把临时库删掉。正在用的库和上传的文件都不会动。`
                  : '只能取消还没被 worker 领走的任务，已经在跑的取消不了；历史记录会留着。'}
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
