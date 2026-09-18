import { useState } from 'react';
import {
  useAgentProfile,
  useAgentRoutines,
  useAgentSettings,
  useConfigureNightlyDelivery,
  useUpdateAgentProfile,
  useUpdateCookingPreference,
  useUpdatePassword,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { pushToast } from '../lib/toast';
import { memberRoleLabel } from '../components/member-editor';
import { SoftLink } from '../components/soft-link';
import { Button, Checkbox, Dialog, Input, Page, Panel } from '../components/ui';

/** 一行「开关 + 说明」，这一页几乎全是这个形状。 */
function ToggleRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">{hint}</p>
      </div>
      <span className="pt-0.5">
        <Checkbox label={title} checked={checked} disabled={disabled} onChange={onChange} />
      </span>
    </div>
  );
}

export function ProfilePage() {
  const { session, signOut } = useAuth();
  const member = session?.member;
  const account = session?.account;
  const manager = member?.role !== 'member';

  const updatePreference = useUpdateCookingPreference();
  const agentProfile = useAgentProfile();
  const updateAgentProfile = useUpdateAgentProfile();
  const agentSettings = useAgentSettings(manager);
  const agentRoutines = useAgentRoutines(manager);
  const configureNightly = useConfigureNightlyDelivery();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  // 「经常掌勺」是会话里的值，改完让 auth 里的 session 也跟上（刷新即可，这里先乐观显示）
  const [cooking, setCooking] = useState(member?.prefersCooking ?? false);

  const nightly = agentRoutines.data?.find((one) => one.kind === 'nightly_digest');
  const nightlyOn = Boolean(agentSettings.data?.routineNotificationsEnabled && nightly?.enabled);

  return (
    <Page
      title="我的"
      subtitle={`${member?.name ?? ''} · ${member ? memberRoleLabel(member.role) : ''}`}
      actions={
        <Button variant="outline" className="h-9 px-3 text-[13px]" onClick={() => setLogoutOpen(true)}>
          退出登录
        </Button>
      }
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Panel title="我的档案" grow={false}>
          <div className="flex items-center gap-3 px-3.5 py-3.5">
            <span className="text-3xl">{member?.avatarEmoji}</span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">{member?.name}</p>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                {member ? memberRoleLabel(member.role) : ''} · 账号 {account?.loginName ?? '未加载'}
              </p>
            </div>
            {manager ? (
              <SoftLink
                to="/house/members"
                className="ml-auto shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] text-accent transition-colors duration-150 hover:bg-muted"
              >
                改名字 / 头像 →
              </SoftLink>
            ) : null}
          </div>
          <ToggleRow
            title="经常掌勺"
            hint="标记了之后，点菜和厨房页会优先把你当主厨候选"
            checked={cooking}
            disabled={updatePreference.isPending}
            onChange={() => {
              const next = !cooking;
              setCooking(next);
              updatePreference.mutate(next, {
                onSuccess: () => pushToast(next ? '已标记经常掌勺' : '已取消经常掌勺'),
                onError: () => setCooking(!next),
              });
            }}
          />
        </Panel>

        <Panel title="小管家" grow={false}>
          <ToggleRow
            title="启用记忆"
            hint={
              agentProfile.isError
                ? '状态暂时读不出来'
                : agentProfile.data?.memoryEnabled === false
                  ? '小管家不会记录或使用你的个人偏好'
                  : '让小管家记住确认过的个人偏好'
            }
            checked={agentProfile.data?.memoryEnabled ?? true}
            disabled={!agentProfile.data || updateAgentProfile.isPending}
            onChange={() => {
              const current = agentProfile.data;
              if (!current) return;
              updateAgentProfile.mutate(
                { memoryEnabled: !current.memoryEnabled, expectedVersion: current.version },
                {
                  onSuccess: (saved) =>
                    pushToast(saved.memoryEnabled ? '小管家会记住你的偏好了' : '已关掉小管家的记忆'),
                  onError: (error) =>
                    pushToast(
                      // 乐观锁失败：别处刚改过，刷新再来，别静默失败
                      error instanceof Error && /版本|version/.test(error.message)
                        ? '刚才别处改过这个设置，刷新一下再试'
                        : '没改成功，再试一次',
                    ),
                },
              );
            }}
          />
          {manager ? (
            <ToggleRow
              title="主动提醒"
              hint={
                agentSettings.isError || agentRoutines.isError
                  ? '提醒状态暂时读不出来'
                  : nightly
                    ? `每天 ${String(nightly.scheduleHour).padStart(2, '0')}:${String(nightly.scheduleMinute).padStart(2, '0')} 汇总临期订阅、药品和家里的待办`
                    : '正在读夜间汇总计划'
              }
              checked={nightlyOn}
              disabled={!nightly || !agentSettings.data || configureNightly.isPending}
              onChange={() => {
                if (!nightly || !agentSettings.data) return;
                configureNightly.mutate(
                  {
                    enabled: !nightlyOn,
                    expectedSettingsVersion: agentSettings.data.version,
                    expectedRoutineVersion: nightly.version,
                  },
                  {
                    onSuccess: () => pushToast(nightlyOn ? '已关掉夜间汇总推送' : '夜间汇总会推给你'),
                  },
                );
              }}
            />
          ) : null}
          <div className="px-3.5 py-3">
            <SoftLink
              to="/me/assistant"
              className="text-[13px] text-accent transition-colors duration-150 hover:underline"
            >
              去问问小管家 →
            </SoftLink>
          </div>
        </Panel>
      </div>

      <aside className="flex shrink-0 flex-col gap-4 lg:w-[320px]">
        <Panel title="账号安全" grow={false}>
          <div className="px-3.5 py-3">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              {account?.requiresPasswordSetup
                ? '这个账号还没设过密码，建议现在设一个。'
                : '换密码之后，别的设备上的登录都会失效，这台不受影响。'}
            </p>
            <Button className="mt-2.5 h-9 px-3 text-[13px]" onClick={() => setPasswordOpen(true)}>
              {account?.requiresPasswordSetup ? '设置密码' : '修改密码'}
            </Button>
          </div>
        </Panel>

        <Panel title="消息推送" grow={false}>
          <div className="px-3.5 py-3">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              想让提醒发到手机上（ntfy / Telegram 这类），在消息页配置外部渠道。
            </p>
            <SoftLink
              to="/schedule/notifications"
              className="mt-2 inline-block text-[13px] text-accent transition-colors duration-150 hover:underline"
            >
              去消息页设置渠道 →
            </SoftLink>
          </div>
        </Panel>
      </aside>

      {passwordOpen ? <PasswordForm onClose={() => setPasswordOpen(false)} /> : null}

      {logoutOpen ? (
        <Dialog
          title="退出登录？"
          onClose={() => setLogoutOpen(false)}
          maxWidth={380}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setLogoutOpen(false)}>
                再想想
              </Button>
              <Button className="flex-1" onClick={signOut}>
                退出登录
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-soft">下次进来要重新输账号密码。家里的数据都留着，不会丢。</p>
        </Dialog>
      ) : null}
    </Page>
  );
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const update = useUpdatePassword();
  const { session } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const needsCurrent = !session?.account.requiresPasswordSetup;
  const label = 'mb-1 block text-[12px] text-ink-soft';

  function submit() {
    if (next.length < 8) return setMessage('新密码至少 8 位');
    if (next !== confirm) return setMessage('两次输入的新密码不一样');
    setMessage(null);
    update.mutate(
      { currentPassword: needsCurrent ? current || undefined : undefined, newPassword: next },
      {
        onSuccess: () => {
          pushToast('密码已更新，其他设备需要重新登录');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没改成功'),
      },
    );
  }

  return (
    <Dialog
      title={needsCurrent ? '修改密码' : '设置密码'}
      onClose={onClose}
      maxWidth={420}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={update.isPending} onClick={submit}>
            {update.isPending ? '提交中…' : '更新密码'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {needsCurrent ? (
          <label className="block">
            <span className={label}>当前密码</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              aria-label="当前密码"
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
        ) : null}
        <label className="block">
          <span className={label}>新密码</span>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            aria-label="新密码"
            placeholder="至少 8 位"
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>再输一次</span>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            aria-label="再输一次"
            onChange={(event) => setConfirm(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
          />
        </label>
      </div>
    </Dialog>
  );
}
