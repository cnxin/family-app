import { useState } from 'react';
import type { HouseholdInvitation, ManagedMember } from '@family/contracts';
import {
  useHouseholdInvitations,
  useManagedMembers,
  useRevokeInvitation,
  useUpdateManagedMemberStatus,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { pushToast } from '../lib/toast';
import { InviteForm, MemberEditor, memberRoleLabel } from '../components/member-editor';
import { ListSkeleton } from '../components/skeleton';
import { Button, Dialog, EmptyState, Page, Panel, Segmented } from '../components/ui';

type Filter = 'active' | 'all';
type Ask =
  | { kind: 'status'; member: ManagedMember }
  | { kind: 'revoke'; invitation: HouseholdInvitation };

const NO_MEMBERS: ManagedMember[] = [];

function expiryLabel(value: string) {
  const hours = Math.round((new Date(value).getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return '已过期';
  if (hours < 24) return `${hours} 小时后到期`;
  return `${Math.round(hours / 24)} 天后到期`;
}

export function MembersPage() {
  const { session } = useAuth();
  const meId = session?.member.id;
  const myRole = session?.member.role;

  const members = useManagedMembers();
  const invitations = useHouseholdInvitations();
  const setStatus = useUpdateManagedMemberStatus();
  const revoke = useRevokeInvitation();

  const [filter, setFilter] = useState<Filter>('active');
  const [editing, setEditing] = useState<ManagedMember | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);

  const rows = members.data ?? NO_MEMBERS;
  const visible = filter === 'all' ? rows : rows.filter((one) => !one.disabledAt);
  const activeCount = rows.filter((one) => !one.disabledAt).length;
  const pendingInvites = (invitations.data ?? []).filter((one) => !one.acceptedAt && !one.revokedAt);

  // 只有家庭管理员能动另一个家庭管理员
  const canManage = (target: ManagedMember) => !(target.role === 'owner' && myRole !== 'owner');

  function confirm() {
    if (!ask) return;
    if (ask.kind === 'status') {
      const enabled = Boolean(ask.member.disabledAt);
      setStatus.mutate(
        { id: ask.member.id, enabled },
        {
          onSuccess: () => {
            setAsk(null);
            pushToast(enabled ? `${ask.member.name} 可以重新登录了` : `${ask.member.name} 的家庭访问已停用`);
          },
        },
      );
    } else {
      revoke.mutate(ask.invitation.id, {
        onSuccess: () => {
          setAsk(null);
          pushToast(`给「${ask.invitation.memberName}」的邀请已撤销`);
        },
      });
    }
  }

  return (
    <Page
      title="家庭成员"
      subtitle={`${activeCount} 位在家成员的档案和权限`}
      actions={
        <Button className="h-9 px-3 text-[13px]" onClick={() => setInviteOpen(true)}>
          + 邀请成员
        </Button>
      }
      toolbar={
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active' as const, label: `在家成员 ${activeCount}` },
            { value: 'all' as const, label: '全部成员' },
          ]}
        />
      }
    >
      <Panel className="p-3">
        {members.isPending ? (
          <ListSkeleton rows={3} />
        ) : members.isError ? (
          <EmptyState emoji="👤" title="成员读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : visible.length === 0 ? (
          <EmptyState emoji="👤" title="没有这样的成员" hint="点右上角邀请一位家人进来" />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-card border border-border">
              {visible.map((one, index) => {
                const isSelf = one.id === meId;
                return (
                  <div
                    key={one.id}
                    aria-label={one.name}
                    className={
                      'flex flex-wrap items-center gap-3 px-3.5 py-3 ' +
                      (index ? 'border-t border-border' : '')
                    }
                  >
                    <span className="text-2xl">{one.avatarEmoji}</span>
                    <div className="min-w-[160px] flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[15px] font-semibold">{one.name}</span>
                        {isSelf ? <span className="text-[12px] text-accent">我</span> : null}
                        <span
                          className={
                            'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                            (one.disabledAt ? 'bg-muted text-ink-soft' : 'bg-accent-soft text-accent')
                          }
                        >
                          {one.disabledAt ? '已停用' : '可登录'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] text-ink-soft">
                        {memberRoleLabel(one.role)}
                        {one.prefersCooking ? ' · 经常掌勺' : ''}
                        {' · '}
                        {one.account ? `账号 ${one.account.loginName}` : '还没关联登录账号'}
                        {one.account?.disabledAt ? ' · 账号已停用' : ''}
                      </p>
                    </div>
                    {canManage(one) ? (
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          className="h-9 px-2 text-[13px]"
                          aria-label={`编辑${one.name}`}
                          onClick={() => setEditing(one)}
                        >
                          编辑
                        </Button>
                        {isSelf ? null : (
                          <Button
                            variant="ghost"
                            className={'h-9 px-2 text-[13px] ' + (one.disabledAt ? 'text-accent' : 'text-danger')}
                            aria-label={`${one.disabledAt ? '恢复' : '停用'}${one.name}`}
                            onClick={() => setAsk({ kind: 'status', member: one })}
                          >
                            {one.disabledAt ? '恢复访问' : '停用访问'}
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* 谁能做什么，写在页面上比让人猜要好——这一页本来就是解释权限的地方 */}
            <dl className="rounded-card bg-muted/50 px-3.5 py-3 text-[12px] leading-relaxed text-ink-soft">
              <div className="flex gap-2">
                <dt className="w-[70px] shrink-0 font-medium text-ink">家庭管理员</dt>
                <dd>全部功能：成员、财务、备份，也能指定新的家庭管理员</dd>
              </div>
              <div className="mt-1.5 flex gap-2">
                <dt className="w-[70px] shrink-0 font-medium text-ink">协管成员</dt>
                <dd>能管成员、奖励、资产这些日常事务，但不能动财务和备份</dd>
              </div>
              <div className="mt-1.5 flex gap-2">
                <dt className="w-[70px] shrink-0 font-medium text-ink">家庭成员</dt>
                <dd>点菜、做饭、任务、投票、兑换积分——家里人平时用的都能用</dd>
              </div>
            </dl>
          </div>
        )}
      </Panel>

      <aside className="flex shrink-0 flex-col lg:w-[320px]">
        <Panel title="待接受的邀请" grow={false}>
          {pendingInvites.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[13px] text-ink-soft">
              没有待接受的邀请。邀请码只在生成时显示一次。
            </p>
          ) : (
            pendingInvites.map((one, index) => (
              <div
                key={one.id}
                className={'flex items-center gap-2.5 px-3.5 py-3 ' + (index ? 'border-t border-border' : '')}
              >
                <span className="text-xl">{one.avatarEmoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px]">{one.memberName}</p>
                  <p className="mt-0.5 text-[12px] text-ink-soft">
                    {memberRoleLabel(one.role)} · {expiryLabel(one.expiresAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="h-8 shrink-0 px-2 text-[13px] text-ink-soft"
                  aria-label={`撤销${one.memberName}的邀请`}
                  onClick={() => setAsk({ kind: 'revoke', invitation: one })}
                >
                  撤销
                </Button>
              </div>
            ))
          )}
        </Panel>
      </aside>

      {editing ? (
        <MemberEditor
          key={editing.id}
          member={editing}
          meId={meId}
          myRole={myRole}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {inviteOpen ? <InviteForm onClose={() => setInviteOpen(false)} /> : null}

      {ask ? (
        <Dialog
          title={
            ask.kind === 'revoke'
              ? '撤销这个邀请？'
              : ask.member.disabledAt
                ? `恢复「${ask.member.name}」的访问？`
                : `停用「${ask.member.name}」的访问？`
          }
          onClose={() => setAsk(null)}
          maxWidth={400}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAsk(null)}>
                再想想
              </Button>
              <Button
                className={
                  'flex-1 ' +
                  (ask.kind === 'status' && !ask.member.disabledAt ? 'bg-danger hover:brightness-110' : '')
                }
                disabled={setStatus.isPending || revoke.isPending}
                onClick={confirm}
              >
                {ask.kind === 'revoke' ? '撤销邀请' : ask.member.disabledAt ? '恢复访问' : '停用访问'}
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-ink-soft">
            {ask.kind === 'revoke'
              ? `「${ask.invitation.memberName}」手上的邀请码会立刻失效，可以再生成一个新的。`
              : ask.member.disabledAt
                ? '恢复后对方可以用原来的账号重新登录，历史记录都还在。'
                : '停用后对方立刻被踢下线、不能再登录，但 TA 点过的菜、记过的账都保留。'}
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
