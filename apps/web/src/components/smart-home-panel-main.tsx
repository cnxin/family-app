import { useState, type ReactNode } from 'react';
import type { SmartHomeControl, SmartHomeDomain, SmartHomePanel, SmartHomePanelEntity } from '@family/contracts';
import { smartHomeStateLine } from '../lib/smart-home-copy';
import { useSmartHomeHistory } from '../lib/queries';
import { choiceLayout } from '../lib/smart-home-controls';
import { isPercentEntity, percentLabel } from '../lib/smart-home-device-copy';
import type { PendingCommands } from '../lib/use-pending-commands';
import { EntityRow } from './smart-home-entity-control';
import { ChoiceGroup } from './ui/choice';
import { Slider } from './ui/slider';
import { Stepper } from './ui/stepper';
import { Switch } from './ui/switch';

// 详情面板的主面板（smart-home-redesign §9.2）：按主实体的控件描述定制布局，积木都来自 R2a 的通用控件。
// 数据只来自 HA 通用属性和管理员挑的主面板项；某一块 HA 没给，这一块就不出现。

interface MainProps {
  panel: SmartHomePanel;
  commands: PendingCommands;
  timeZone: string;
}

type Of<K extends SmartHomeControl['kind']> = Extract<SmartHomeControl, { kind: K }>;

function Block({ title, aside, children }: { title?: string; aside?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      {title ? (
        <h3 className="flex items-baseline justify-between text-[13px] font-semibold text-ink-soft">
          {title}
          {aside ? <span className="text-[12px] font-normal">{aside}</span> : null}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

function ActionButtons({
  actions,
  pending,
  onPress,
}: {
  actions: { action: string; label: string; enabled: boolean; primary?: boolean }[];
  pending: boolean;
  onPress: (action: string) => void;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
      {actions.map((one) => (
        <button
          key={one.action}
          type="button"
          disabled={!one.enabled || pending}
          aria-busy={pending || undefined}
          className={
            'min-h-[52px] rounded-[14px] border text-[15px] transition-[transform,background-color] duration-150 active:scale-[.97] ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed ' +
            (one.primary && one.enabled
              ? 'border-accent bg-accent font-semibold text-on-accent disabled:opacity-60'
              : 'border-border bg-surface text-ink disabled:text-ink-soft/60')
          }
          onClick={() => onPress(one.action)}
        >
          {one.label}
        </button>
      ))}
    </div>
  );
}

function VacuumPanel({ panel, commands, control }: MainProps & { control: Of<'vacuum'> }) {
  const { entityId, state } = panel.primary;
  const pending = commands.isPending(entityId);
  const [rooms, setRooms] = useState<string[]>([]);
  const value = state?.state ?? '';
  const running = value === 'cleaning' || value === 'returning';
  const labels = { start: value === 'paused' ? '继续' : '开始', pause: '暂停', return_to_base: '回充' } as const;
  const enabled = {
    start: value !== 'cleaning',
    pause: running,
    return_to_base: value !== 'docked' && value !== 'returning',
  } as const;
  return (
    <>
      <ActionButtons
        pending={pending}
        actions={control.actions.map((action) => ({
          action,
          label: labels[action],
          enabled: enabled[action],
          primary: running ? action === 'pause' : action === 'start',
        }))}
        onPress={(action) => commands.send(entityId, action as 'start' | 'pause' | 'return_to_base')}
      />
      {control.areas ? (
        <Block title="分房间清扫" aside="选好再点下面的按钮">
          <div className="flex flex-wrap gap-2" role="group" aria-label="选要扫的房间">
            {control.areas.map((area) => {
              const on = rooms.includes(area.id);
              return (
                <button
                  key={area.id}
                  type="button"
                  aria-pressed={on}
                  className={
                    'min-h-11 rounded-xl border px-3.5 text-sm transition-[background-color,transform] duration-150 active:scale-[.97] ' +
                    (on ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-border bg-surface text-ink')
                  }
                  onClick={() => setRooms((current) => (on ? current.filter((id) => id !== area.id) : [...current, area.id]))}
                >
                  {on ? '✓ ' : ''}
                  {area.name}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!rooms.length || pending}
            className="min-h-[52px] rounded-[14px] border border-border bg-surface text-[15px] text-ink transition-transform duration-150 active:scale-[.97] disabled:text-ink-soft/60"
            onClick={() => {
              if (commands.send(entityId, 'clean_area', rooms)) setRooms([]);
            }}
          >
            {rooms.length ? `清扫选中的 ${rooms.length} 个房间` : '先选房间'}
          </button>
        </Block>
      ) : null}
      {control.fanSpeeds ? (
        <Block title="吸力">
          <ChoiceGroup
            label="吸力"
            options={control.fanSpeeds}
            current={state?.fanSpeed ?? null}
            pending={pending}
            pendingValue={commands.pendingValue(entityId)}
            layout={choiceLayout(control.fanSpeeds.length)}
            onChoose={(speed) => commands.send(entityId, 'set_fan_speed', speed)}
          />
        </Block>
      ) : null}
    </>
  );
}

function CoverPanel({ panel, commands, control }: MainProps & { control: Of<'cover'> }) {
  const { entityId, state } = panel.primary;
  const pending = commands.isPending(entityId);
  const labels = { open: '打开', stop: '停', close: '关上' } as const;
  return (
    <>
      <ActionButtons
        pending={pending}
        actions={control.actions.map((action) => ({ action, label: labels[action], enabled: true }))}
        onPress={(action) => commands.send(entityId, action as 'open' | 'stop' | 'close')}
      />
      {control.position ? (
        <Block title="位置" aside="0 = 全关，100 = 全开">
          <Slider
            label="窗帘位置"
            value={state?.position ?? 0}
            min={0}
            max={100}
            step={1}
            pending={pending}
            format={(value) => `${value}%`}
            onCommit={(value) => commands.send(entityId, 'set_position', value)}
          />
          <div className="flex justify-between text-[12px] text-ink-soft">
            <span>全关</span>
            <span>现在 {state?.position ?? 0}%</span>
            <span>全开</span>
          </div>
        </Block>
      ) : null}
    </>
  );
}

function ClimatePanel({ panel, commands, control }: MainProps & { control: Of<'climate'> }) {
  const { entityId, state, name } = panel.primary;
  const pending = commands.isPending(entityId);
  const on = Boolean(state && state.state !== 'off');
  const trim = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  return (
    <>
      <div className={`flex min-h-16 items-center justify-between rounded-[18px] px-4 ${on ? 'bg-accent-soft' : 'bg-muted'}`}>
        <span>
          <span className="block text-[17px] font-semibold">{on ? '开着' : '已关'}</span>
          <span className="block text-[12.5px] text-ink-soft">{on ? '点右边关掉' : '点右边打开'}</span>
        </span>
        <Switch
          size="big"
          label={`${name}电源`}
          checked={on}
          pending={pending}
          onChange={(next) => commands.send(entityId, next ? 'turn_on' : 'turn_off')}
        />
      </div>
      {control.hvacModes.length ? (
        <Block title="模式">
          <ChoiceGroup
            label="模式"
            options={control.hvacModes}
            current={on ? state?.state ?? null : null}
            pending={pending}
            pendingValue={commands.pendingValue(entityId)}
            layout={control.hvacModes.length <= 5 ? 'segmented' : 'dropdown'}
            onChoose={(mode) => commands.send(entityId, 'set_hvac_mode', mode)}
          />
        </Block>
      ) : null}
      <Block title="目标温度" aside={`每次 ${trim(control.step)}°`}>
        <Stepper
          label="目标温度"
          size="big"
          value={state?.targetTemperature ?? control.min}
          min={control.min}
          max={control.max}
          step={control.step}
          pending={pending}
          format={(value) => `${trim(value)}°`}
          onCommit={(value) => commands.send(entityId, 'set_temperature', value)}
        />
        <p className="text-center text-[12px] text-ink-soft">
          {trim(control.min)}° ~ {trim(control.max)}°
        </p>
      </Block>
      {control.fanModes ? (
        <Block title="风速">
          <ChoiceGroup
            label="风速"
            options={control.fanModes}
            current={state?.fanMode ?? null}
            pending={pending}
            pendingValue={commands.pendingValue(entityId)}
            layout={choiceLayout(control.fanModes.length)}
            onChoose={(mode) => commands.send(entityId, 'set_fan_mode', mode)}
          />
        </Block>
      ) : null}
      {control.swingModes ? (
        <Block title="摆风">
          <ChoiceGroup
            label="摆风"
            options={control.swingModes}
            current={state?.swingMode ?? null}
            pending={pending}
            pendingValue={commands.pendingValue(entityId)}
            layout={choiceLayout(control.swingModes.length)}
            onChoose={(mode) => commands.send(entityId, 'set_swing_mode', mode)}
          />
        </Block>
      ) : null}
      {state?.currentTemperature != null || state?.humidity != null ? (
        <div className="grid grid-cols-2 gap-2">
          {state?.currentTemperature != null ? <Chip value={`${trim(state.currentTemperature)}°`} label="室内温度" /> : null}
          {state?.humidity != null ? <Chip value={`${trim(state.humidity)}%`} label="湿度" /> : null}
        </div>
      ) : null}
    </>
  );
}

function Chip({ value, label, warn = false }: { value: string; label: string; warn?: boolean }) {
  return (
    <div className={`flex flex-col rounded-xl px-3 py-2 ${warn ? 'bg-warm-soft' : 'bg-muted'}`}>
      <b className={`text-[15px] tabular-nums ${warn ? 'text-warm' : ''}`}>{value}</b>
      <span className="text-[11.5px] text-ink-soft">{label}</span>
    </div>
  );
}

function Sparkline({ deviceId, entity }: { deviceId: string; entity: SmartHomePanelEntity }) {
  const history = useSmartHomeHistory(deviceId, entity.entityId);
  const points = history.data?.points ?? [];
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const path = values
    .map((value, index) => `${((index / (values.length - 1)) * 100).toFixed(2)},${(36 - ((value - low) / span) * 32).toFixed(2)}`)
    .join(' ');
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-12 w-full text-accent" aria-label="最近 24 小时">
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex justify-between text-[11.5px] text-ink-soft">
        <span>昨天这时</span>
        <span>
          最低 {low} · 最高 {high}
        </span>
        <span>现在</span>
      </figcaption>
    </figure>
  );
}

/** 主实体那一块。没有控件（只读、没权限、断开）时按类型给只读显示。 */
export function PrimaryPanel(props: MainProps) {
  const { panel, commands, timeZone } = props;
  const { primary } = panel;
  const control = primary.control;
  if (control?.kind === 'vacuum') return <VacuumPanel {...props} control={control} />;
  if (control?.kind === 'cover') return <CoverPanel {...props} control={control} />;
  if (control?.kind === 'climate') return <ClimatePanel {...props} control={control} />;
  if (control) {
    return (
      <ul className="rounded-[14px] border border-border">
        <EntityRow entity={{ ...primary, name: control.kind === 'scene' ? '执行这个场景' : '电源' }} commands={commands} timeZone={timeZone} />
      </ul>
    );
  }
  const numeric = primary.state && primary.state.state.trim() !== '' && Number.isFinite(Number(primary.state.state));
  if ((primary.domain === 'sensor' || primary.domain === 'number') && numeric) {
    return (
      // 数值本身头部已经写了，这里只放它最近 24 小时的走势
      <Block title={`${primary.name} · 最近 24 小时`} aside={smartHomeStateLine(primary.domain as SmartHomeDomain, primary.state, timeZone).text}>
        <Sparkline deviceId={panel.device.id} entity={primary} />
      </Block>
    );
  }
  return null;
}

/** 主面板项（§9.3）：百分比类画进度条（洗衣机的进度放最上面、净水器每支滤芯一条），其余按通用控件 / 只读一行。 */
export function FeaturedSection({ panel, commands, timeZone }: MainProps) {
  const items = panel.featured;
  if (!items.length) return null;
  const percents = items.filter((entity) => isPercentEntity(entity));
  const rest = items.filter((entity) => !percents.includes(entity));
  const bars = panel.device.icon === 'washer' || panel.device.icon === 'dryer' ? percents.slice(0, 1) : percents;
  const leftover = [...rest, ...percents.filter((entity) => !bars.includes(entity))];
  return (
    <>
      {bars.length ? (
        <div className="flex flex-col gap-3">
          {bars.map((entity) => {
            const value = Math.max(0, Math.min(100, Number(entity.state?.state)));
            const warn = value <= 10 && panel.device.icon === 'water_purifier';
            return (
              <div key={entity.entityId} data-smart-home-bar={entity.entityId} className="grid grid-cols-[minmax(0,5.5rem)_1fr_3.5rem] items-center gap-2.5 text-sm">
                <span className="truncate">{percentLabel(entity.name)}</span>
                <div
                  role="progressbar"
                  aria-label={percentLabel(entity.name)}
                  aria-valuenow={value}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className={`h-full rounded-full ${warn ? 'bg-warm' : 'bg-accent'}`} style={{ width: `${value}%` }} />
                </div>
                <span className={`text-right tabular-nums ${warn ? 'text-warm' : ''}`}>{value}%</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {leftover.length ? (
        <ul className="rounded-[14px] border border-border">
          {leftover.map((entity) => (
            <EntityRow key={entity.entityId} entity={entity} commands={commands} timeZone={timeZone} />
          ))}
        </ul>
      ) : null}
    </>
  );
}
