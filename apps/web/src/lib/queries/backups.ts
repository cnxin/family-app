import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BackupDashboard,
  BackupPolicy,
  BackupRun,
  BackupRunKind,
  BackupRunStatus,
  UpdateBackupPolicyBody,
} from '@family/contracts';
import { api } from '../api';
import { invalidateAttention } from './attention';

export const BACKUP_KIND_LABELS: Record<BackupRunKind, string> = {
  backup: '完整备份',
  restore_drill: '恢复演练',
  capacity_check: '容量检查',
};

export const BACKUP_STATUS_LABELS: Record<BackupRunStatus, string> = {
  queued: '排队中',
  running: '正在跑',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

/** bigint 列在 pg 驱动里是字符串，响应原样回传，这里自己转。 */
export function backupBytes(value: string | null) {
  if (!value) return '0 B';
  const bytes = Number(value);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${index === 0 ? size : size.toFixed(1)} ${units[index]}`;
}

export function backupTime(value: string | null) {
  if (!value) return '还没有记录';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

/**
 * 看板每 10 秒刷一次：任务是后台 worker 领走的，界面只能靠轮询看进度。
 * `enabled` 由调用方按角色给——普通成员连请求都不该发（后端会 403）。
 */
export function useBackupDashboard(enabled: boolean) {
  return useQuery({
    queryKey: ['backup-dashboard'],
    queryFn: () => api<BackupDashboard>('/system/backups'),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });
}

function useBackupMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void invalidateAttention(client);
      void client.invalidateQueries({ queryKey: ['backup-dashboard'] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** 幂等键只允许 `[A-Za-z0-9_.:-]{8,180}`，别往里塞中文或空格。 */
export function backupKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function useQueueBackupRun() {
  return useBackupMutation<
    { kind: 'backup' | 'capacity_check'; idempotencyKey: string },
    BackupRun
  >(({ kind, idempotencyKey }) =>
    api<BackupRun>(kind === 'backup' ? '/system/backups/runs' : '/system/backups/capacity-checks', {
      method: 'POST',
      body: { idempotencyKey },
    }),
  );
}

/**
 * 恢复演练：拿某次成功且校验过的备份，在一个临时库里还原一遍再删掉，
 * **不碰正在用的库**。源备份必须是成功、保留中、校验通过的，否则后端 404。
 */
export function useQueueRestoreDrill() {
  return useBackupMutation<{ sourceRunId: string; idempotencyKey: string }, BackupRun>(
    ({ sourceRunId, idempotencyKey }) =>
      api<BackupRun>(`/system/backups/runs/${sourceRunId}/restore-drills`, {
        method: 'POST',
        body: { idempotencyKey },
      }),
  );
}

/** 只能取消还没被 worker 领走的任务；已经在跑的取消不了。 */
export function useCancelBackupRun() {
  return useBackupMutation<{ id: string }, BackupRun>(({ id }) =>
    api<BackupRun>(`/system/backups/runs/${id}/cancel`, { method: 'PATCH' }),
  );
}

export function useUpdateBackupPolicy() {
  return useBackupMutation<UpdateBackupPolicyBody, BackupPolicy>((body) =>
    api<BackupPolicy>('/system/backups/policy', { method: 'PUT', body }),
  );
}
