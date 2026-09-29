import { SMART_HOME_DOMAINS, type SmartHomeDomain, type SmartHomePanelEntity } from '@family/contracts';
import { choiceLayout, formatWithUnit } from '../lib/smart-home-controls';
import { smartHomeStateLine } from '../lib/smart-home-copy';
import type { PendingCommands } from '../lib/use-pending-commands';
import { ChoiceGroup } from './ui/choice';
import { Slider } from './ui/slider';
import { Stepper } from './ui/stepper';
import { Switch } from './ui/switch';
import { Button } from './ui';

// 详情面板的通用控件（smart-home-redesign §9.4）：按服务端算好的控件描述渲染，不认设备类型、不认厂商。
// 扫地机 / 空调 / 窗帘的主面板在 R2b 里用这些积木拼；「更多设置」「主面板项」直接用 EntityRow。

const isDomain = (domain: string): domain is SmartHomeDomain => (SMART_HOME_DOMAINS as readonly string[]).includes(domain);

/** 只读的值：沿用卡片那套人话（「开着」「32 m²」「运行中」）。 */
export function EntityValue({ entity, timeZone }: { entity: SmartHomePanelEntity; timeZone?: string }) {
  const line = isDomain(entity.domain)
    ? smartHomeStateLine(entity.domain, entity.state, timeZone)
    : { text: entity.state?.state ?? '—', detail: null, tone: 'off' as const };
  return (
    <span data-smart-home-value className={`shrink-0 text-right text-sm tabular-nums ${line.tone === 'muted' ? 'text-ink-soft' : 'text-ink'}`}>
      {line.text}
      {line.detail ? <span className="block text-[12px] text-ink-soft">{line.detail}</span> : null}
    </span>
  );
}

/** 这个实体的控件；没有控件（只读、没权限、HA 断开、离线）时就是只读的值。 */
export function EntityControl({
  entity,
  commands,
  timeZone,
}: {
  entity: SmartHomePanelEntity;
  commands: PendingCommands;
  timeZone?: string;
}) {
  const { control, state, entityId, name } = entity;
  // 按钮、场景的状态本来就是「上次按的时间」，unknown 也能按；其余读不到状态就只读
  const unknown = state?.state === 'unknown' && control?.kind !== 'button' && control?.kind !== 'scene';
  if (!control || !state || state.state === 'unavailable' || unknown) {
    return <EntityValue entity={entity} timeZone={timeZone} />;
  }
  const pending = commands.isPending(entityId);
  switch (control.kind) {
    case 'toggle':
      return (
        <Switch
          label={name}
          checked={state.state === 'on'}
          pending={pending}
          onChange={(next) => commands.send(entityId, next ? 'turn_on' : 'turn_off')}
        />
      );
    case 'button':
    case 'scene': {
      const verb = control.kind === 'scene' ? '执行' : '按一下';
      return (
        <Button
          variant="outline"
          className="min-h-11 shrink-0 px-3.5"
          aria-label={`${name}：${verb}`}
          aria-busy={pending || undefined}
          disabled={pending}
          onClick={() => commands.send(entityId, control.kind === 'scene' ? 'activate' : 'press')}
        >
          {pending ? '…' : verb}
        </Button>
      );
    }
    case 'select':
      return (
        <ChoiceGroup
          label={name}
          options={control.options}
          current={state.state}
          pending={pending}
          pendingValue={commands.pendingValue(entityId)}
          layout={choiceLayout(control.options.length)}
          onChoose={(value) => commands.send(entityId, 'select_option', value)}
        />
      );
    case 'number': {
      const value = Number(state.state);
      if (!Number.isFinite(value)) return <EntityValue entity={entity} timeZone={timeZone} />;
      const props = {
        label: name,
        value,
        min: control.min,
        max: control.max,
        step: control.step,
        pending,
        format: (next: number) => formatWithUnit(next, control.unit, control.step),
        onCommit: (next: number) => commands.send(entityId, 'set_value', next),
      };
      return control.display === 'slider' ? <Slider {...props} /> : <Stepper {...props} />;
    }
    default:
      // 扫地机 / 空调 / 窗帘这类整块主面板由 R2b 的类型面板渲染；落到这里的按只读显示
      return <EntityValue entity={entity} timeZone={timeZone} />;
  }
}

/** 占整行宽度的控件（分段、滑块）放在名字下面；开关、按钮、下拉、只读值放在右边。 */
function isWide(entity: SmartHomePanelEntity) {
  const { control } = entity;
  if (!control || !entity.state || entity.state.state === 'unavailable') return false;
  if (control.kind === 'select') return choiceLayout(control.options.length) === 'segmented';
  if (control.kind === 'number') return true;
  return false;
}

/** 「更多设置」「设备信息」「主面板项」里的一行。 */
export function EntityRow({
  entity,
  commands,
  timeZone,
}: {
  entity: SmartHomePanelEntity;
  commands: PendingCommands;
  timeZone?: string;
}) {
  const wide = isWide(entity);
  return (
    <li
      data-smart-home-entity-row={entity.entityId}
      className={`flex min-h-[52px] gap-2 border-t border-border px-3.5 py-2 first:border-t-0 ${wide ? 'flex-col justify-center' : 'items-center'}`}
    >
      <span className="min-w-0 flex-1 truncate text-sm">{entity.name}</span>
      <EntityControl entity={entity} commands={commands} timeZone={timeZone} />
    </li>
  );
}
