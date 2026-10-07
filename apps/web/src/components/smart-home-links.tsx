import { useState } from 'react';
import { smartHomeActionsFor, type SmartHomeAction, type SmartHomeLink, type SmartHomeLinkTrigger } from '@family/contracts';
import {
  useCreateSmartHomeLink,
  useDeleteSmartHomeLink,
  useSmartHomeLinks,
  useSmartHomeStates,
  useUpdateSmartHomeLink,
} from '../lib/queries';
import { SMART_HOME_ACTION_LABELS } from '../lib/smart-home-copy';
import { pushToast } from '../lib/toast';
import { Field } from './media-settings-parts';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { Button, Checkbox, EmptyState, Input, Panel, Segmented, selectClass } from './ui';

// E4：小管家 → HA。家务打勾、日程开始前 N 分钟，让一台开放了控制的设备做一个动作。
// 失败不影响家务和日程本身，只在家庭动态里记一句；同一次发生只跑一次。

const TRIGGERS: { value: SmartHomeLinkTrigger; label: string }[] = [
  { value: 'task_done', label: '家务打勾' },
  { value: 'calendar_before', label: '日程开始前' },
];

const time = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function describe(link: SmartHomeLink, deviceName: string) {
  const when =
    link.trigger === 'task_done'
      ? `标题含「${link.keyword}」的家务打勾后`
      : `标题含「${link.keyword}」的日程开始前 ${link.offsetMinutes} 分钟`;
  return `${when} → ${deviceName}：${SMART_HOME_ACTION_LABELS[link.action]}`;
}

function LinkRow({ link, deviceName }: { link: SmartHomeLink; deviceName: string }) {
  const update = useUpdateSmartHomeLink();
  const remove = useDeleteSmartHomeLink();
  const busy = update.isPending || remove.isPending;
  const run = link.lastRun;
  return (
    <li data-smart-home-link={link.name} className="flex items-start gap-3 border-b border-border px-3.5 py-3 last:border-b-0">
      <Checkbox
        checked={link.enabled}
        disabled={busy}
        label={`启用联动${link.name}`}
        onChange={() => update.mutate({ id: link.id, body: { enabled: !link.enabled } })}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{link.name}</span>
        <span className="block text-[12px] text-ink-soft">{describe(link, deviceName)}</span>
        {run ? (
          <span className={`block text-[12px] ${run.status === 'failed' ? 'text-danger' : 'text-ink-soft'}`}>
            {time.format(new Date(run.at))} {run.status === 'failed' ? '没执行成功' : run.status === 'succeeded' ? '执行了' : '执行中'}
            {run.message ? ` · ${run.message}` : ''}
          </span>
        ) : (
          <span className="block text-[12px] text-ink-soft">还没跑过</span>
        )}
      </span>
      <Button
        variant="ghost"
        className="min-h-11 shrink-0 px-2"
        aria-label={`删掉联动${link.name}`}
        disabled={busy}
        onClick={() => remove.mutate(link.id, { onSuccess: () => pushToast(`已删掉「${link.name}」`, undefined, 'success') })}
      >
        删掉
      </Button>
    </li>
  );
}

function NewLinkForm({ devices }: { devices: { id: string; displayName: string; primaryDomain: string }[] }) {
  const create = useCreateSmartHomeLink();
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<SmartHomeLinkTrigger>('task_done');
  const [keyword, setKeyword] = useState('');
  const [offset, setOffset] = useState(10);
  const [target, setTarget] = useState(devices[0]?.id ?? '');
  const domain = devices.find((device) => device.id === target)?.primaryDomain ?? '';
  const actions = smartHomeActionsFor(domain);
  const [action, setAction] = useState<SmartHomeAction | ''>('');
  const chosen = action && actions.includes(action) ? action : actions[0] ?? '';

  if (!devices.length) {
    return (
      <p className="px-3.5 py-3 text-[12px] text-ink-soft">
        先在「连接与设备」里给想联动的设备勾上「允许在小管家里控制」，这里才能选它。
      </p>
    );
  }

  return (
    <form
      data-smart-home-link-form
      className="flex flex-col gap-3 border-t border-border px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!chosen) return;
        create.mutate(
          {
            name: name.trim(),
            trigger,
            keyword: keyword.trim(),
            ...(trigger === 'calendar_before' ? { offsetMinutes: offset } : {}),
            targetDeviceId: target,
            action: chosen,
          },
          {
            onSuccess: () => {
              navigator.vibrate?.(10);
              pushToast(`联动「${name.trim()}」建好了`, undefined, 'success');
              setName('');
              setKeyword('');
            },
          },
        );
      }}
    >
      <p className="text-[13px] font-medium">新建一条</p>
      <Segmented<SmartHomeLinkTrigger> value={trigger} options={TRIGGERS} onChange={setTrigger} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="名字">
          <Input aria-label="联动名字" maxLength={40} placeholder="比如：打扫就扫地" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={trigger === 'task_done' ? '家务标题里有这个词' : '日程标题里有这个词'}>
          <Input
            aria-label="标题关键词"
            maxLength={40}
            placeholder={trigger === 'task_done' ? '比如：打扫' : '比如：电影'}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </Field>
      </div>
      {trigger === 'calendar_before' ? (
        <Field label="提前几分钟">
          <Input
            aria-label="提前几分钟"
            type="number"
            min={0}
            max={720}
            value={offset}
            onChange={(event) => setOffset(Math.min(720, Math.max(0, Math.round(Number(event.target.value) || 0))))}
          />
        </Field>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="让哪台设备">
          <select
            aria-label="联动目标设备"
            className={`${selectClass} min-h-11 w-full`}
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setAction('');
            }}
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="做什么">
          <select
            aria-label="联动动作"
            className={`${selectClass} min-h-11 w-full`}
            value={chosen}
            onChange={(event) => setAction(event.target.value as SmartHomeAction)}
          >
            {actions.map((one) => (
              <option key={one} value={one}>
                {SMART_HOME_ACTION_LABELS[one]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div>
        <Button type="submit" className="min-h-11" disabled={create.isPending || !name.trim() || !keyword.trim() || !chosen}>
          建这条联动
        </Button>
      </div>
    </form>
  );
}

export function SmartHomeLinksPanel() {
  const links = useSmartHomeLinks();
  const states = useSmartHomeStates();
  const all = states.data?.devices ?? [];
  const names = new Map(all.map((device) => [device.id, device.displayName]));
  const controllable = all
    .filter((device) => device.controllable && smartHomeActionsFor(device.primaryDomain).length > 0)
    .map(({ id, displayName, primaryDomain }) => ({ id, displayName, primaryDomain }));

  return (
    <Panel title="小管家 → Home Assistant" grow={false}>
      <p className="px-3.5 pt-3 text-[12px] leading-relaxed text-ink-soft">
        家务打勾、日程快开始时让设备动一下。HA 连不上时家务和日程照常，只在家庭动态里记一句；同一次只跑一次。
      </p>
      <QueryFrame query={links} skeleton={<div className="p-3"><ListSkeleton rows={2} /></div>}>
        {links.data?.length ? (
          <ul className="mt-2">
            {links.data.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                deviceName={(link.targetDeviceId && names.get(link.targetDeviceId)) || `${link.targetEntityId}（设备已不在白名单）`}
              />
            ))}
          </ul>
        ) : (
          <EmptyState emoji="🔗" title="还没有联动" hint="比如「打扫」打勾后让扫地机开扫，电影夜开始前关窗帘" />
        )}
      </QueryFrame>
      <NewLinkForm key={controllable.map((device) => device.id).join(',')} devices={controllable} />
    </Panel>
  );
}
