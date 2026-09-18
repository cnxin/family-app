import { useState } from 'react';
import type { MediaPlaybackUserDirectory } from '@family/contracts';
import {
  MEDIA_CONNECTOR_STATE_LABELS,
  useMapPlaybackUser,
  useMediaPlaybackUsers,
  useMembers,
  useUnmapPlaybackUser,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { ListSkeleton } from './skeleton';
import { ResultLine } from './media-settings-parts';
import { Button, EmptyState, Panel, selectClass } from './ui';

type ExternalUser = MediaPlaybackUserDirectory['users'][number];

const STATE_TONE: Record<string, string> = {
  online: 'bg-accent-soft text-accent',
  offline: 'bg-danger/10 text-danger',
  disabled: 'bg-muted text-ink-soft',
};

/** 这个账号还能不能改映射：服务离线、账号已失效、账号被停用，都只剩「取消关联」。 */
function lockReason(directory: MediaPlaybackUserDirectory, user: ExternalUser) {
  if (directory.state !== 'online') return '暂不可验证';
  if (user.isStale) return '已失效';
  if (user.isDisabled) return '已停用';
  return null;
}

export function MediaPlaybackUsersPanel() {
  const directories = useMediaPlaybackUsers();
  const members = useMembers();
  const map = useMapPlaybackUser();
  const unmap = useUnmapPlaybackUser();
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const busy = map.isPending || unmap.isPending;

  async function choose(directory: MediaPlaybackUserDirectory, user: ExternalUser, value: string) {
    setResult(null);
    try {
      if (!value) {
        if (!user.mapping) return;
        await unmap.mutateAsync(user.mapping.id);
        setResult({ message: `已取消 ${user.name} 的成员关联`, ok: true });
        pushToast(`已取消 ${user.name} 的成员关联`);
        return;
      }
      const member = members.data?.find((one) => one.id === value);
      await map.mutateAsync({
        provider: directory.provider,
        externalUserId: user.externalUserId,
        memberId: value,
      });
      setResult({ message: `已把 ${user.name} 关联到 ${member?.name ?? '家庭成员'}`, ok: true });
      pushToast(`已把 ${user.name} 关联到 ${member?.name ?? '家庭成员'}`);
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : '关联失败', ok: false });
    }
  }

  if (directories.isPending || members.isPending) {
    return (
      <Panel className="p-3">
        <ListSkeleton rows={3} />
      </Panel>
    );
  }
  if (directories.isError || !directories.data?.length) {
    return (
      <Panel className="p-3">
        <EmptyState emoji="👥" title="媒体用户读不出来" hint="先把 Plex / Emby 连上再回来" />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {result ? <ResultLine message={result.message} ok={result.ok} /> : <span />}
        <Button
          variant="outline"
          className="h-9"
          disabled={directories.isFetching}
          onClick={() => void directories.refetch()}
        >
          刷新媒体用户
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {directories.data.map((directory) => (
          <Panel key={directory.connectorKey} grow={false}>
            <div className="flex items-start gap-3 border-b border-border px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{directory.name}</p>
                <p className="truncate text-[12px] text-ink-soft">{directory.message}</p>
              </div>
              <span
                className={
                  'shrink-0 rounded-full px-2 py-0.5 text-[11px] ' +
                  (STATE_TONE[directory.state] ?? 'bg-warm-soft text-warm')
                }
              >
                {MEDIA_CONNECTOR_STATE_LABELS[directory.state] ?? directory.state}
              </span>
            </div>

            {directory.users.length === 0 ? (
              // 卡头已经把「怎么回事」说了，这里不再重复一遍同一句话
              <p className="px-3.5 py-6 text-center text-[13px] text-ink-soft">
                还没有可以映射的账号
              </p>
            ) : (
              directory.users.map((user, index) => {
                const locked = lockReason(directory, user);
                return (
                  <article
                    key={`${user.serverId ?? 'unknown'}:${user.externalUserId}`}
                    aria-label={`${directory.name} 用户 ${user.name}`}
                    className={
                      'flex flex-wrap items-center gap-2 px-3.5 py-2.5 ' +
                      (index ? 'border-t border-border' : '')
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">{user.name}</p>
                      <p className="truncate text-[12px] text-ink-soft">
                        {user.mapping
                          ? `${user.mapping.member.avatarEmoji} ${user.mapping.member.name}`
                          : '未关联'}
                      </p>
                    </div>
                    {locked ? (
                      <span className="shrink-0 rounded-full bg-warm-soft px-2 py-0.5 text-[11px] text-warm">
                        {locked}
                      </span>
                    ) : null}
                    {locked ? (
                      user.mapping ? (
                        <Button
                          variant="outline"
                          className="h-8 px-2.5 text-[12px]"
                          aria-label={`取消 ${user.name} 的成员关联`}
                          disabled={busy}
                          onClick={() => void choose(directory, user, '')}
                        >
                          取消关联
                        </Button>
                      ) : null
                    ) : (
                      <select
                        className={selectClass}
                        aria-label={`${user.name} 对应的家庭成员`}
                        disabled={busy}
                        value={user.mapping?.member.id ?? ''}
                        onChange={(event) => void choose(directory, user, event.target.value)}
                      >
                        <option value="">未关联</option>
                        {(members.data ?? []).map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.avatarEmoji} {member.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </article>
                );
              })
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
