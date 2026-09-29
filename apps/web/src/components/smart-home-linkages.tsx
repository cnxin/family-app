import { useState } from 'react';
import type { SmartHomeEntityRef, SmartHomeRules, SmartHomeWebhookSecret, SmartHomeWebhookSettings } from '@family/contracts';
import {
  useRotateSmartHomeWebhook,
  useSmartHomeStates,
  useSmartHomeWebhookEvents,
  useSmartHomeWebhookSettings,
  useUpdateSmartHomeRules,
} from '../lib/queries';
import { homeAssistantAutomations, homeAssistantRestCommand } from '../lib/smart-home-ha-config';
import { pushToast } from '../lib/toast';
import { Field, ResultLine, ToggleRow } from './media-settings-parts';
import { SmartHomeLinksPanel } from './smart-home-links';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { Button, EmptyState, Input, Panel, selectClass } from './ui';

// E3：HA → 小管家。三条联动写死在服务端，这里只能开关、选触发实体；HA 那边的配置由这里生成。

const time = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

type EntityOption = { ref: SmartHomeEntityRef; label: string };
const refKey = (ref: SmartHomeEntityRef | null) => (ref ? `${ref.deviceId} ${ref.entityId}` : '');

/** 触发实体 = 白名单设备 + 它的主实体或主面板项（R1 起按设备引用）。 */
function EntitySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: SmartHomeEntityRef | null;
  options: EntityOption[];
  onChange: (value: SmartHomeEntityRef | null) => void;
}) {
  return (
    <Field label={label}>
      <select
        aria-label={label}
        className={`${selectClass} min-h-11 w-full`}
        value={refKey(value)}
        onChange={(event) => onChange(options.find((option) => refKey(option.ref) === event.target.value)?.ref ?? null)}
      >
        <option value="">不设（这一项不生成自动化）</option>
        {options.map((option) => (
          <option key={refKey(option.ref)} value={refKey(option.ref)}>
            {option.label}（{option.ref.entityId}）
          </option>
        ))}
      </select>
    </Field>
  );
}

function RulesCard({ settings }: { settings: SmartHomeWebhookSettings }) {
  const states = useSmartHomeStates();
  const save = useUpdateSmartHomeRules();
  const [rules, setRules] = useState<SmartHomeRules>(settings.rules);
  const devices = states.data?.devices ?? [];
  const pick = (domains: string[]): EntityOption[] =>
    devices.flatMap((device) => [
      ...(domains.includes(device.primaryDomain)
        ? [{ ref: { deviceId: device.id, entityId: device.primaryEntityId }, label: device.displayName }]
        : []),
      ...device.featured
        .filter((entity) => domains.includes(entity.domain))
        .map((entity) => ({ ref: { deviceId: device.id, entityId: entity.entityId }, label: `${device.displayName} · ${entity.name}` })),
    ]);
  const dirty = JSON.stringify(rules) !== JSON.stringify(settings.rules);
  const patch = <K extends keyof SmartHomeRules>(key: K, next: Partial<SmartHomeRules[K]>) =>
    setRules((current) => ({ ...current, [key]: { ...current[key], ...next } }));

  return (
    <Panel title="三条联动" grow={false}>
      <div className="flex flex-col gap-4 px-3.5 py-3">
        <p className="text-[12px] leading-relaxed text-ink-soft">
          触发实体从「家里人能看到的设备」里选（设备本身，或它的主面板项）；先在「连接与设备」把洗衣机 / 烘干机、扫地机、净水器加进来。
        </p>

        <section data-smart-home-rule="laundry" className="flex flex-col gap-2">
          <ToggleRow
            label="洗完 / 烘完：通知全家，建一件「晾衣服」"
            checked={rules.laundry.enabled}
            onChange={() => patch('laundry', { enabled: !rules.laundry.enabled })}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <EntitySelect
              label="洗衣机完成看哪个"
              value={rules.laundry.washer}
              options={pick(['binary_sensor', 'sensor', 'select'])}
              onChange={(value) => patch('laundry', { washer: value })}
            />
            <EntitySelect
              label="烘干机完成看哪个"
              value={rules.laundry.dryer}
              options={pick(['binary_sensor', 'sensor', 'select'])}
              onChange={(value) => patch('laundry', { dryer: value })}
            />
          </div>
          <Field label="完成时显示的状态（文字状态才要填；运行中 → 停止、剩余时间归零不用填）">
            <Input
              aria-label="完成时显示的状态"
              placeholder="比如：完成"
              maxLength={40}
              value={rules.laundry.doneValue ?? ''}
              onChange={(event) => patch('laundry', { doneValue: event.target.value.trim() || null })}
            />
          </Field>
        </section>

        <section data-smart-home-rule="vacuum" className="flex flex-col gap-2">
          <ToggleRow
            label="扫完：把今天的「扫地」家务打勾"
            checked={rules.vacuum.enabled}
            onChange={() => patch('vacuum', { enabled: !rules.vacuum.enabled })}
          />
          <EntitySelect
            label="扫地机"
            value={rules.vacuum.trigger}
            options={pick(['vacuum'])}
            onChange={(value) => patch('vacuum', { trigger: value })}
          />
        </section>

        <section data-smart-home-rule="filter" className="flex flex-col gap-2">
          <ToggleRow
            label="滤芯低：提醒换滤芯，加进购物清单"
            checked={rules.filter.enabled}
            onChange={() => patch('filter', { enabled: !rules.filter.enabled })}
          />
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
            <EntitySelect
              label="滤芯寿命"
              value={rules.filter.trigger}
              options={pick(['sensor'])}
              onChange={(value) => patch('filter', { trigger: value })}
            />
            <Field label="低于多少算低（%）">
              <Input
                aria-label="滤芯低于多少算低"
                type="number"
                min={1}
                max={99}
                value={rules.filter.threshold}
                onChange={(event) =>
                  patch('filter', { threshold: Math.min(99, Math.max(1, Math.round(Number(event.target.value) || 1))) })
                }
              />
            </Field>
          </div>
        </section>

        {dirty ? (
          <div className="flex gap-2">
            <Button
              className="min-h-11"
              disabled={save.isPending}
              onClick={() => save.mutate(rules, { onSuccess: () => pushToast('联动设置已保存；改了触发实体要重新生成 HA 配置') })}
            >
              保存联动设置
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={() => setRules(settings.rules)}>
              还原
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-medium">{label}</span>
        <Button
          variant="outline"
          className="min-h-9 shrink-0 whitespace-nowrap px-3"
          aria-label={`复制${label}`}
          onClick={() =>
            void navigator.clipboard
              ?.writeText(text)
              .then(() => pushToast('已复制'))
              .catch(() => pushToast('没复制成功，手动全选复制吧'))
          }
        >
          复制
        </Button>
      </div>
      <textarea
        readOnly
        aria-label={label}
        value={text}
        rows={Math.min(14, text.split('\n').length)}
        wrap="off"
        className="w-full overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[12px] leading-relaxed text-ink"
      />
    </div>
  );
}

function WebhookCard({ settings }: { settings: SmartHomeWebhookSettings }) {
  const rotate = useRotateSmartHomeWebhook();
  const states = useSmartHomeStates();
  const [issued, setIssued] = useState<SmartHomeWebhookSecret | null>(null);
  const [origin, setOrigin] = useState(window.location.origin);
  const isNumeric = (state: { state: string } | null) =>
    state != null && state.state.trim() !== '' && Number.isFinite(Number(state.state));
  const entities = (states.data?.devices ?? []).flatMap((device) => [
    { entityId: device.primaryEntityId, numeric: isNumeric(device.primary) },
    ...device.featured.map((entity) => ({ entityId: entity.entityId, numeric: isNumeric(entity.state) })),
  ]);

  return (
    <Panel title="Home Assistant 回调" grow={false}>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <p className="text-[13px]">
          {settings.configured
            ? `密钥 ${settings.secretHint} · ${settings.rotatedAt ? `${time.format(new Date(settings.rotatedAt))} 生成` : ''}`
            : '还没生成密钥，HA 的事件进不来'}
        </p>
        {settings.previousValidUntil ? (
          <p className="text-[12px] text-warm">
            旧密钥还能用到 {time.format(new Date(settings.previousValidUntil))}，在那之前把新配置粘到 HA 里
          </p>
        ) : null}
        <Field label="HA 访问小管家用的地址">
          <Input
            aria-label="HA 访问小管家用的地址"
            autoComplete="off"
            value={origin}
            onChange={(event) => setOrigin(event.target.value.trim())}
          />
        </Field>
        <div>
          <Button
            className="min-h-11"
            disabled={rotate.isPending}
            onClick={() =>
              rotate.mutate(undefined, {
                onSuccess: (result) => {
                  navigator.vibrate?.(10);
                  setIssued(result);
                },
              })
            }
          >
            {settings.configured ? '换一把新密钥并生成 HA 配置' : '生成密钥和 HA 配置'}
          </Button>
        </div>
        {issued ? (
          <div data-smart-home-ha-config className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <ResultLine message="密钥只显示这一次，离开页面就看不到了。按顺序贴进 HA：" ok />
            <CopyBlock
              label="① 加到 configuration.yaml（改完重启 HA）"
              text={homeAssistantRestCommand({ origin, path: issued.path, secret: issued.secret })}
            />
            <CopyBlock
              label="② 加到 automations.yaml（或 设置 → 自动化 → 新建 → 用 YAML 编辑，逐条粘贴）"
              text={homeAssistantAutomations({ rules: issued.rules, entities }) || '# 三条联动都没选触发实体：先在「三条联动」里选好、保存，再换一把密钥重新生成'}
            />
          </div>
        ) : settings.configured ? (
          <p className="text-[12px] text-ink-soft">HA 配置里带着密钥，只在生成的那一次显示；要重新拿就换一把新密钥（旧的宽限 24 小时）。</p>
        ) : null}
      </div>
    </Panel>
  );
}

function EventsCard() {
  const events = useSmartHomeWebhookEvents();
  const tone = { processed: 'text-accent', ignored: 'text-ink-soft', failed: 'text-danger' } as const;
  const label = { processed: '已处理', ignored: '只记不做', failed: '失败' } as const;
  return (
    <Panel title="最近收到的事件" grow={false}>
      <QueryFrame query={events} skeleton={<div className="p-3"><ListSkeleton rows={2} /></div>}>
        {events.data?.length ? (
          <ul data-smart-home-webhook-events>
            {events.data.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{entry.event}</span>
                  <span className="block truncate text-[12px] text-ink-soft">{entry.result ?? '—'}</span>
                </span>
                <span className="shrink-0 text-right text-[12px]">
                  <span className={`block ${tone[entry.status]}`}>{label[entry.status]}</span>
                  <span className="block text-ink-soft">{time.format(new Date(entry.receivedAt))}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState emoji="📭" title="还没收到过" hint="HA 的自动化触发一次，这里就会有一条" />
        )}
      </QueryFrame>
    </Panel>
  );
}

export function SmartHomeLinkagesSection() {
  const settings = useSmartHomeWebhookSettings();
  return (
    <QueryFrame query={settings} skeleton={<Panel className="p-3"><ListSkeleton rows={3} /></Panel>}>
      {settings.data ? (
        <>
          <div className="flex min-h-0 flex-col gap-4 lg:w-[460px] lg:shrink-0">
            <WebhookCard settings={settings.data} />
            <EventsCard />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <RulesCard key={JSON.stringify(settings.data.rules)} settings={settings.data} />
            <SmartHomeLinksPanel />
          </div>
        </>
      ) : null}
    </QueryFrame>
  );
}
