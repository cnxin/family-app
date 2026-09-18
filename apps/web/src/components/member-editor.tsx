import { useState } from 'react';
import type { CreatedHouseholdInvitation, ManagedMember, MemberRole } from '@family/contracts';
import { useCreateInvitation, useUpdateManagedMember } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Checkbox, Dialog, Input } from './ui';

export function memberRoleLabel(role: MemberRole) {
  if (role === 'owner') return '家庭管理员';
  if (role === 'admin') return '协管成员';
  return '家庭成员';
}

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-3 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-border text-ink-soft hover:bg-muted');

/** 编辑成员：名字、头像、角色、是否经常掌勺。改自己的角色是不允许的（会把自己锁出去）。 */
export function MemberEditor({
  member,
  meId,
  myRole,
  onClose,
}: {
  member: ManagedMember;
  meId: string | undefined;
  myRole: MemberRole | undefined;
  onClose: () => void;
}) {
  const update = useUpdateManagedMember();
  const [name, setName] = useState(member.name);
  const [avatarEmoji, setAvatarEmoji] = useState(member.avatarEmoji);
  const [role, setRole] = useState<MemberRole>(member.role);
  const [prefersCooking, setPrefersCooking] = useState(member.prefersCooking);
  const [message, setMessage] = useState<string | null>(null);

  const isSelf = member.id === meId;
  // 只有家庭管理员能把别人设成家庭管理员
  const roleOptions: MemberRole[] = myRole === 'owner' ? ['owner', 'admin', 'member'] : ['admin', 'member'];
  const valid = Boolean(name.trim() && avatarEmoji.trim());

  function submit() {
    if (!valid) return setMessage('名字和头像都要填');
    setMessage(null);
    update.mutate(
      {
        id: member.id,
        body: {
          name: name.trim(),
          avatarEmoji: avatarEmoji.trim(),
          prefersCooking,
          ...(isSelf ? {} : { role }),
        },
      },
      {
        onSuccess: (saved) => {
          pushToast(
            !isSelf && saved.role !== member.role
              ? `${saved.name} 现在是${memberRoleLabel(saved.role)}（对方需要重新登录）`
              : '成员资料已更新',
          );
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={`编辑「${member.name}」`}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={!valid || update.isPending} onClick={submit}>
            {update.isPending ? '保存中…' : '保存成员资料'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[84px_1fr] gap-3">
          <label className="block">
            <span className={label}>头像</span>
            <Input
              value={avatarEmoji}
              maxLength={4}
              aria-label="头像"
              className="text-center text-xl"
              onChange={(event) => setAvatarEmoji(event.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>成员名称</span>
            <Input
              autoFocus
              value={name}
              maxLength={64}
              aria-label="成员名称"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
          </label>
        </div>

        <div>
          <span className={label}>家庭角色</span>
          {isSelf ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-[13px] text-ink-soft">
              {memberRoleLabel(role)}（不能改自己的角色）
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {roleOptions.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={role === value}
                  className={chip(role === value)}
                  onClick={() => setRole(value)}
                >
                  {memberRoleLabel(value)}
                </button>
              ))}
            </div>
          )}
          {!isSelf && role !== member.role ? (
            <p className="mt-1 text-[12px] text-warm">改了角色会把对方已登录的设备踢下线，需要重新登录。</p>
          ) : null}
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
          <Checkbox
            label="经常掌勺"
            checked={prefersCooking}
            onChange={() => setPrefersCooking((value) => !value)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">经常掌勺</span>
            <span className="mt-0.5 block text-[12px] text-ink-soft">
              点菜和厨房页会优先把这个人当主厨候选
            </span>
          </span>
        </div>
      </div>
    </Dialog>
  );
}

/** 邀请新成员：生成一次性邀请码，对方用它建账号进家庭。 */
export function InviteForm({ onClose }: { onClose: () => void }) {
  const create = useCreateInvitation();
  const [name, setName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('🙂');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [hours, setHours] = useState('48');
  const [created, setCreated] = useState<CreatedHouseholdInvitation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function submit() {
    const expiresInHours = Number(hours);
    if (!name.trim()) return setMessage('先填要邀请谁');
    if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) {
      return setMessage('有效期要是 1 到 168 小时之间的整数');
    }
    setMessage(null);
    create.mutate(
      { memberName: name.trim(), avatarEmoji: avatarEmoji.trim() || '🙂', role, expiresInHours },
      {
        onSuccess: (invitation) => setCreated(invitation),
        onError: (error) => setMessage(error instanceof Error ? error.message : '没生成成功'),
      },
    );
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.invitationToken);
      setCopied(true);
      pushToast('邀请码已复制');
    } catch {
      setMessage('复制不了，手动选中下面那串字复制吧');
    }
  }

  return (
    <Dialog
      title={created ? '邀请码生成好了' : '邀请家庭成员'}
      onClose={onClose}
      footer={
        created ? (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={copy}>
              {copied ? '已复制' : '复制邀请码'}
            </Button>
            <Button className="flex-1" onClick={onClose}>
              知道了
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {message ? <p className="text-[13px] text-danger">{message}</p> : null}
            <Button className="w-full" disabled={create.isPending} onClick={submit}>
              {create.isPending ? '生成中…' : '生成邀请码'}
            </Button>
          </div>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            把下面这串字发给 {created.avatarEmoji} <b>{created.memberName}</b>，让 TA 在登录页选「用邀请码加入」。
            <b>只显示这一次</b>，关掉就看不到了（服务端只存哈希）。
          </p>
          <code className="select-all break-all rounded-lg bg-muted px-3 py-2.5 text-[13px] leading-relaxed">
            {created.invitationToken}
          </code>
          <p className="text-[12px] text-ink-soft">
            {memberRoleLabel(created.role)} · {new Date(created.expiresAt).toLocaleString('zh-CN')} 到期
          </p>
          {message ? <p className="text-[12px] text-danger">{message}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[84px_1fr] gap-3">
            <label className="block">
              <span className={label}>头像</span>
              <Input
                value={avatarEmoji}
                maxLength={4}
                aria-label="头像"
                className="text-center text-xl"
                onChange={(event) => setAvatarEmoji(event.target.value)}
              />
            </label>
            <label className="block">
              <span className={label}>邀请谁</span>
              <Input
                autoFocus
                value={name}
                maxLength={64}
                aria-label="邀请谁"
                placeholder="家庭成员的名字"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && submit()}
              />
            </label>
          </div>
          <div>
            <span className={label}>进来之后的角色</span>
            <div className="flex flex-wrap gap-1.5">
              {(['member', 'admin'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={role === value}
                  className={chip(role === value)}
                  onClick={() => setRole(value)}
                >
                  {memberRoleLabel(value)}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={label}>邀请码有效期（小时）</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={168}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </label>
        </div>
      )}
    </Dialog>
  );
}
