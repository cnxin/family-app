import { useState } from 'react';
import type {
  NotificationChannel,
  NotificationChannelKind,
  NotificationDelivery,
  NotificationModule,
} from '@family/contracts';
import { NOTIFICATION_MODULES } from '@family/contracts';
import {
  useRetryNotificationDelivery,
  useTestNotificationChannel,
  useUpdateChannelPreference,
  useUpsertNotificationChannel,
} from '../lib/queries';
import { DELIVERY_STATUS_LABEL, MODULE_LABEL, fullTime } from '../lib/notification-meta';
import { pushToast } from '../lib/toast';
import { Button, Checkbox, Dialog, EmptyState, Input } from './ui';

const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-ink-soft hover:bg-muted');

/**
 * 一个外部渠道：上半是渠道本身（管理员改），下半是「我在这儿收哪些」（每个人自己改）。
 * 地址和凭据服务端只回提示串，所以编辑时留空表示不改。
 */
export function ChannelCard({
  channel,
  manager,
  onEdit,
  onDelete,
}: {
  channel: NotificationChannel;
  manager: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const update = useUpsertNotificationChannel();
  const test = useTestNotificationChannel();
  const savePreference = useUpdateChannelPreference();
  const preference = channel.preference;

  function setPreference(isEnabled: boolean, modules: NotificationModule[]) {
    savePreference.mutate({ id: channel.id, isEnabled, modules });
  }

  return (
    <article aria-label={channel.name} className="rounded-card border border-border bg-surface">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-[17px]">
          {channel.kind === 'ntfy' ? '📻' : '🪝'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[15px] font-semibold">{channel.name}</span>
            <span
              className={
                'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                (channel.isEnabled ? 'bg-accent-soft text-accent' : 'bg-muted text-ink-soft')
              }
            >
              {channel.isEnabled ? '已启用' : '已停用'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-ink-soft">
            {channel.kind === 'ntfy' ? 'ntfy' : 'Webhook'} · {channel.endpointHint}
            {channel.credentialHint ? ` · ${channel.credentialHint}` : ''}
          </p>
          {channel.lastTestedAt ? (
            <p className={'mt-0.5 text-[12px] ' + (channel.lastTestStatus === 'success' ? 'text-accent' : 'text-danger')}>
              {channel.lastTestStatus === 'success' ? '最近测试成功' : (channel.lastTestError ?? '最近测试失败')} ·{' '}
              {fullTime(channel.lastTestedAt)}
            </p>
          ) : null}
        </div>
      </div>

      {manager ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
          <Button
            variant="ghost"
            className="h-8 px-2 text-[13px]"
            disabled={test.isPending || !channel.isEnabled}
            aria-label={`测试${channel.name}`}
            onClick={() =>
              test.mutate(channel.id, {
                onSuccess: () => pushToast('测试消息发出去了，去那边看看收到没'),
                onError: (error) => pushToast(error instanceof Error ? error.message : '测试没成功'),
              })
            }
          >
            发测试消息
          </Button>
          <Button variant="ghost" className="h-8 px-2 text-[13px]" aria-label={`编辑${channel.name}`} onClick={onEdit}>
            编辑
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-2 text-[13px]"
            disabled={update.isPending}
            aria-label={`${channel.isEnabled ? '停用' : '启用'}${channel.name}`}
            onClick={() =>
              update.mutate({ id: channel.id, body: { isEnabled: !channel.isEnabled } })
            }
          >
            {channel.isEnabled ? '停用' : '启用'}
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-2 text-[13px] text-danger"
            aria-label={`删除${channel.name}`}
            onClick={onDelete}
          >
            删除
          </Button>
        </div>
      ) : null}

      <div className="border-t border-border px-3.5 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">通过这个渠道接收我的通知</p>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              {channel.isEnabled ? '只影响你自己，别人各管各的' : '渠道停用期间不会投递'}
            </p>
          </div>
          <Checkbox
            label={`通过${channel.name}接收我的通知`}
            checked={preference.isEnabled}
            disabled={savePreference.isPending}
            onChange={() => setPreference(!preference.isEnabled, preference.modules)}
          />
        </div>
        {preference.isEnabled ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {NOTIFICATION_MODULES.map((module) => {
              const on = preference.modules.includes(module);
              return (
                <button
                  key={module}
                  type="button"
                  aria-pressed={on}
                  disabled={savePreference.isPending}
                  className={chip(on)}
                  onClick={() => {
                    const modules = on
                      ? preference.modules.filter((one) => one !== module)
                      : [...preference.modules, module];
                    if (!modules.length) {
                      pushToast('至少留一类通知，不然等于关掉了');
                      return;
                    }
                    setPreference(true, modules);
                  }}
                >
                  {MODULE_LABEL[module]}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ChannelEditor({
  editing,
  onClose,
}: {
  editing: NotificationChannel | null;
  onClose: () => void;
}) {
  const save = useUpsertNotificationChannel();
  const [name, setName] = useState(editing?.name ?? '');
  const [kind, setKind] = useState<NotificationChannelKind>(editing?.kind ?? 'ntfy');
  const [endpoint, setEndpoint] = useState('');
  const [credential, setCredential] = useState('');
  const [clearCredential, setClearCredential] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const label = 'mb-1 block text-[12px] text-ink-soft';

  function submit() {
    if (!name.trim()) return setMessage('先给渠道起个名字');
    if (!editing && endpoint.trim().length < 8) return setMessage('接收地址填完整的 URL');
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        body: editing
          ? {
              name: name.trim(),
              kind,
              ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
              ...(credential.trim() ? { credential: credential.trim() } : {}),
              ...(clearCredential ? { clearCredential: true } : {}),
            }
          : {
              name: name.trim(),
              kind,
              endpoint: endpoint.trim(),
              ...(credential.trim() ? { credential: credential.trim() } : {}),
            },
      },
      {
        onSuccess: () => {
          pushToast(editing ? '渠道已更新' : '渠道已创建，记得发条测试消息');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.name}」` : '新增外部渠道'}
      onClose={onClose}
      maxWidth={460}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : editing ? '保存渠道' : '创建渠道'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>渠道名称</span>
          <Input
            autoFocus
            value={name}
            placeholder="例如：家里的 ntfy"
            aria-label="渠道名称"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div>
          <span className={label}>类型</span>
          <div className="flex gap-1.5">
            {(['ntfy', 'webhook'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                className={chip(kind === value)}
                onClick={() => setKind(value)}
              >
                {value === 'ntfy' ? 'ntfy' : 'Webhook'}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={label}>{editing ? '换接收地址（留空就不改）' : '接收地址'}</span>
          <Input
            value={endpoint}
            placeholder={kind === 'ntfy' ? 'https://ntfy.sh/我的家' : 'https://…'}
            aria-label={editing ? '换接收地址' : '接收地址'}
            onChange={(event) => setEndpoint(event.target.value)}
          />
          {editing ? (
            <span className="mt-1 block text-[12px] text-ink-soft">现在是 {editing.endpointHint}</span>
          ) : null}
        </label>
        <label className="block">
          <span className={label}>凭据 / 令牌（选填）</span>
          <Input
            type="password"
            value={credential}
            placeholder={editing?.credentialConfigured ? '留空就不改' : '需要鉴权时才填'}
            aria-label="凭据"
            onChange={(event) => setCredential(event.target.value)}
          />
        </label>
        {editing?.credentialConfigured ? (
          <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <Checkbox
              label="清掉已保存的凭据"
              checked={clearCredential}
              onChange={() => setClearCredential((value) => !value)}
            />
            <span className="text-[13px]">清掉已保存的凭据</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

export function DeliveryList({ deliveries }: { deliveries: NotificationDelivery[] }) {
  const retry = useRetryNotificationDelivery();
  if (!deliveries.length) {
    return <EmptyState emoji="📮" title="还没有外部投递记录" hint="配好渠道并开启接收之后，投递情况会记在这儿" />;
  }
  return (
    <div className="overflow-hidden rounded-card border border-border">
      {deliveries.map((one, index) => (
        <div
          key={one.id}
          className={'flex items-start gap-2.5 px-3.5 py-3 ' + (index ? 'border-t border-border' : '')}
        >
          <span
            className={
              'mt-0.5 size-2 shrink-0 rounded-full ' +
              (one.status === 'sent'
                ? 'bg-accent'
                : one.status === 'failed'
                  ? 'bg-danger'
                  : 'bg-warm')
            }
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px]">{one.notification.title}</p>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              {one.channelName} · {DELIVERY_STATUS_LABEL[one.status]} · 第 {one.attemptCount}/
              {one.maxAttempts} 次 · {fullTime(one.createdAt)}
            </p>
            {one.lastError ? (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-danger">{one.lastError}</p>
            ) : null}
          </div>
          {one.canRetry ? (
            <Button
              variant="ghost"
              className="h-8 shrink-0 px-2 text-[13px]"
              disabled={retry.isPending}
              aria-label={`重新投递${one.notification.title}`}
              onClick={() =>
                retry.mutate(one.id, { onSuccess: () => pushToast('已排进重试队列') })
              }
            >
              重投
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
