import { useState } from 'react';
import type {
  MemberProfile,
  MenuEvent,
  MenuItem,
  MenuItemStatus,
} from '@family/contracts';
import { useMenuMutations, useRecipe } from '../lib/queries';
import { Button, Input } from './ui';

// 文案照旧客户端 kitchen.tsx 的 STATUS_META，不另起一套说法
const STATUS_LABEL: Record<MenuItemStatus, string> = {
  pending: '待认领',
  accepted: '已认领',
  cooking: '做菜中',
  done: '已上桌',
  rejected: '已划掉',
};

/**
 * 动作表照搬旧客户端的 actionsFor：动作既改状态也改认领人，
 * 而且随「这道菜是不是我接的」变化——「我来做」和「换我来做」是两回事。
 */
export interface ItemAction {
  key: string;
  label: string;
  status?: MenuItemStatus;
  claim?: boolean;
  danger?: boolean;
}

export function actionsFor(item: MenuItem, memberId: string, locked: boolean): ItemAction[] {
  if (locked) return [];
  if (item.status === 'pending') {
    return [
      { key: 'claim', label: '我来做', status: 'accepted', claim: true },
      { key: 'reject', label: '划掉', danger: true },
    ];
  }
  if (item.status === 'accepted') {
    return [
      item.assignedToId === memberId
        ? { key: 'cook', label: '开做', status: 'cooking' }
        : { key: 'reclaim', label: '换我来做', claim: true },
      { key: 'reject', label: '划掉', danger: true },
    ];
  }
  if (item.status === 'cooking') {
    return [
      { key: 'done', label: '上桌', status: 'done' },
      { key: 'reject', label: '划掉', danger: true },
    ];
  }
  if (item.status === 'rejected') return [{ key: 'restore', label: '恢复', status: 'pending' }];
  return [];
}

const EVENT_LABEL: Record<MenuEvent['type'], string> = {
  item_ordered: '点了',
  item_status_changed: '把状态改成',
  item_assigned: '把菜分给',
  item_note_changed: '改了备注',
  meal_chef_assigned: '指定主厨',
  menu_completed: '结束了这一餐',
};

export function StatusChip({ status }: { status: MenuItemStatus }) {
  const tone =
    status === 'done'
      ? 'bg-accent-soft text-accent'
      : status === 'cooking'
        ? 'bg-warm-soft text-warm'
        : 'bg-muted text-ink-soft';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const selectClass =
  'h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink ' +
  'transition-colors duration-150 hover:border-ink-soft/40 focus:border-accent focus:outline-none ' +
  'focus:ring-2 focus:ring-accent/25 disabled:opacity-50';

/** 展开后的一道菜：备注、认领、做法与步骤。 */
export function ItemDetail({
  item,
  locked,
  members,
  update,
}: {
  item: MenuItem;
  locked: boolean;
  members: MemberProfile[];
  update: ReturnType<typeof useMenuMutations>['updateItem'];
}) {
  const recipe = useRecipe(item.dishId);
  const [note, setNote] = useState(item.note ?? '');
  const dirty = note.trim() !== (item.note ?? '');

  const variants = (recipe.data?.recipeVariants ?? []).filter((one) => !one.isArchived);
  const current =
    variants.find((one) => one.id === item.recipeVariantId) ??
    variants.find((one) => one.isDefault) ??
    null;

  return (
    <div className="flex flex-col gap-4 border-t border-border bg-muted/40 px-4 py-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-soft">备注</span>
          <Input
            value={note}
            disabled={locked}
            placeholder="少放辣、多加醋…"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <Button
          className="h-10 shrink-0 px-4"
          disabled={!dirty || locked || update.isPending}
          onClick={() => update.mutate({ id: item.id, body: { note: note.trim() } })}
        >
          存备注
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-soft">谁来做这道</span>
          <select
            className={selectClass}
            disabled={locked || update.isPending}
            value={item.assignedToId ?? ''}
            onChange={(event) =>
              update.mutate({
                id: item.id,
                body: { assignedToId: event.target.value || null },
              })
            }
          >
            <option value="">还没认领</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[160px] flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-soft">按哪个做法</span>
          <select
            className={selectClass}
            disabled={locked || update.isPending || variants.length === 0}
            value={current?.id ?? ''}
            onChange={(event) =>
              update.mutate({ id: item.id, body: { recipeVariantId: event.target.value } })
            }
          >
            {variants.length === 0 ? <option value="">这道菜还没有做法</option> : null}
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name}
                {variant.isDefault ? '（家庭默认）' : ''}
                {variant.author ? ` · ${variant.author.name}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {recipe.isPending ? (
        <p className="text-[13px] text-ink-soft">读取菜谱…</p>
      ) : current ? (
        <div className="flex flex-col gap-3">
          {current.ingredients.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-ink-soft">食材</p>
              <p className="text-[13.5px] leading-relaxed">
                {current.ingredients
                  .map((one) => `${one.ingredient.name} ${one.quantity}${one.unit}`)
                  .join(' · ')}
              </p>
            </div>
          ) : null}
          {current.steps.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-ink-soft">
                做法{current.estMinutes ? ` · 约 ${current.estMinutes} 分钟` : ''}
              </p>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed">
                {current.steps
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((step) => (
                    <li key={step.id}>{step.text}</li>
                  ))}
              </ol>
            </div>
          ) : (
            <p className="text-[13px] text-ink-soft">这个做法还没写步骤</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function EventLine({ event }: { event: MenuEvent }) {
  const time = new Date(event.createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const target = event.menuItem?.dish.name;
  const detail =
    event.type === 'item_status_changed'
      ? STATUS_LABEL[(event.toValue ?? 'pending') as MenuItemStatus]
      : event.type === 'item_assigned'
        ? (event.recipient?.name ?? '没人')
        : event.type === 'meal_chef_assigned'
          ? (event.toValue ?? '')
          : '';
  return (
    <div className="flex items-baseline gap-2 px-4 py-2 text-[13px]">
      <span className="shrink-0 font-mono text-[11px] text-ink-soft">{time}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{event.actor.name}</span> {EVENT_LABEL[event.type]}
        {target ? ` ${target}` : ''}
        {detail ? ` ${detail}` : ''}
        {event.reason ? `（${event.reason}）` : ''}
      </span>
    </div>
  );
}


/** 一餐一块：主厨、菜品、结束与扣库、操作历史。三餐并列，不用切换。 */
