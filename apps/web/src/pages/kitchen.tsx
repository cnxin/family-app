import { useState } from 'react';
import type { MemberProfile, Menu, MenuEvent, MenuItem, MenuItemStatus } from '@family/contracts';
import { Link } from 'react-router-dom';
import {
  MEAL_LABELS,
  todayISO,
  useConfirmConsumption,
  useGenerateShoppingList,
  useMembers,
  useMenuEvents,
  useMenuInventoryPreview,
  useMenuMutations,
  useMenusOfDate,
  useRecipe,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { useAuth } from '../lib/auth';
import { Button, Card, Input } from '../components/ui';

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
interface ItemAction {
  key: string;
  label: string;
  status?: MenuItemStatus;
  claim?: boolean;
  danger?: boolean;
}

function actionsFor(item: MenuItem, memberId: string, locked: boolean): ItemAction[] {
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

function StatusChip({ status }: { status: MenuItemStatus }) {
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
function ItemDetail({
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

function EventLine({ event }: { event: MenuEvent }) {
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
function MealSection({
  menu,
  members,
  memberId,
  date,
  onReject,
}: {
  menu: Menu;
  members: MemberProfile[];
  memberId: string;
  date: string;
  onReject: (item: MenuItem) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const { updateItem, assignChef, complete } = useMenuMutations(date);
  const events = useMenuEvents(menu.id, showLog);
  const locked = menu.status === 'done';
  const preview = useMenuInventoryPreview(menu.id, locked);
  const confirm = useConfirmConsumption();

  const active = menu.items.filter((item) => item.status !== 'rejected');
  const remaining = active.filter((item) => item.status !== 'done').length;
  const canComplete = active.length > 0 && remaining === 0;

  function runAction(item: MenuItem, action: ItemAction) {
    if (action.key === 'reject') {
      onReject(item);
      return;
    }
    updateItem.mutate({
      id: item.id,
      body: {
        ...(action.status ? { status: action.status } : {}),
        ...(action.claim ? { assignedToId: memberId } : {}),
      },
    });
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[15px] font-semibold">{MEAL_LABELS[menu.mealType]}</h2>
        <span className="text-xs text-ink-soft">
          {locked
            ? menu.completedBy
              ? `${menu.completedBy.name} 已锁定`
              : '已锁定'
            : active.length === 0
              ? '还没人点菜'
              : remaining === 0
                ? '都上桌了'
                : `${active.length - remaining} / ${active.length} 已上桌`}
        </span>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
          <span className="text-[12px] font-medium text-ink-soft">本餐主厨</span>
          <span className="text-sm font-medium">
            {menu.chef ? `${menu.chef.avatarEmoji} ${menu.chef.name}` : '未指定'}
          </span>
          {!locked ? (
            <div className="ml-auto flex flex-wrap gap-1.5">
              {members.map((member) => {
                const active2 = menu.chefId === member.id;
                return (
                  <button
                    key={member.id}
                    type="button"
                    aria-pressed={active2}
                    disabled={assignChef.isPending}
                    onClick={() =>
                      assignChef.mutate({ menuId: menu.id, chefId: active2 ? null : member.id })
                    }
                    className={
                      'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] ' +
                      'transition-[background-color,border-color,transform] duration-150 active:scale-95 ' +
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 ' +
                      (active2
                        ? 'border-accent bg-accent-soft font-medium text-accent'
                        : 'border-border text-ink-soft hover:bg-muted')
                    }
                  >
                    <span>{member.avatarEmoji}</span>
                    {member.name}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {menu.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-soft">这一餐还没人点菜</p>
        ) : (
          menu.items.map((item, index) => {
            const open = expanded === item.id;
            const actions = actionsFor(item, memberId, locked);
            return (
              <div key={item.id} className={index ? 'border-t border-border' : ''}>
                <div className="flex min-h-[54px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : item.id)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-left text-[15px] hover:text-accent"
                  >
                    <span className={item.status === 'rejected' ? 'text-ink-soft line-through' : ''}>
                      {item.dish.name}
                    </span>
                    {item.note ? <span className="ml-2 text-[12px] text-warm">“{item.note}”</span> : null}
                    <span className="ml-2 text-[11px] text-ink-soft">{open ? '收起' : '详情'}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                      {item.requestedBy.name}点的
                      {item.assignedTo ? ` · ${item.assignedTo.name}做` : ''}
                      {item.statusReason ? ` · ${item.statusReason}` : ''}
                    </span>
                  </button>
                  <StatusChip status={item.status} />
                  {actions.map((action) => (
                    <Button
                      key={action.key}
                      variant={action.danger ? 'ghost' : 'outline'}
                      className={'h-8 shrink-0 px-2.5 text-[13px] ' + (action.danger ? 'text-ink-soft' : '')}
                      disabled={updateItem.isPending}
                      onClick={() => runAction(item, action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
                {open ? (
                  <ItemDetail item={item} locked={locked} members={members} update={updateItem} />
                ) : null}
              </div>
            );
          })
        )}

        {!locked && active.length > 0 ? (
          <div className="border-t border-border px-4 py-3">
            <Button
              variant="outline"
              className="h-9 w-full text-[13px]"
              disabled={!canComplete || complete.isPending}
              onClick={() => complete.mutate(menu.id)}
            >
              {complete.isPending ? '结束中…' : '结束并锁定'}
            </Button>
            <p className="mt-2 text-center text-[12px] text-ink-soft">
              {canComplete
                ? '结束后这餐的主厨、菜品和状态将变为只读'
                : `还有 ${remaining} 道没上桌，上桌或划掉之后才能结束`}
            </p>
          </div>
        ) : null}

        {locked && preview.data ? (
          <div className="border-t border-border px-4 py-3">
            {preview.data.confirmed ? (
              <p className="text-[13px] text-ink-soft">
                已确认扣库{preview.data.reversed ? '（后来撤销过）' : ''}
              </p>
            ) : preview.data.rows.length === 0 ? (
              <p className="text-[13px] text-ink-soft">本餐没有可匹配扣减的库存项</p>
            ) : (
              <>
                <p className="mb-2 text-[12px] font-medium text-ink-soft">这一餐会扣掉</p>
                <div className="flex flex-col gap-1 text-[13px]">
                  {preview.data.rows.map((row) => (
                    <div key={row.ingredientId} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {row.inventoryItemName ?? row.ingredientName}
                      </span>
                      <span className="shrink-0 font-mono text-[12px] text-ink-soft">
                        {row.status === 'ready'
                          ? `${row.quantityBefore} → ${row.quantityAfter} ${row.unit}`
                          : row.status === 'missing_inventory'
                            ? '未建库存，跳过'
                            : row.status === 'unit_mismatch'
                              ? `单位对不上（要 ${row.unit}）`
                              : `库存不够（要 ${row.quantity} ${row.unit}）`}
                      </span>
                    </div>
                  ))}
                </div>
                <Button
                  className="mt-3 h-9 w-full text-[13px]"
                  disabled={!preview.data.canConfirm || confirm.isPending}
                  onClick={() =>
                    confirm.mutate(menu.id, {
                      onSuccess: () => pushToast('已确认扣库，库存流水里能看到'),
                    })
                  }
                >
                  {confirm.isPending ? '扣库中…' : '确认扣库'}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </Card>

      <div className="mt-1.5">
        <Button
          variant="ghost"
          className="h-8 px-2 text-[13px]"
          aria-expanded={showLog}
          onClick={() => setShowLog((value) => !value)}
        >
          {showLog ? '收起操作历史' : '看操作历史'}
        </Button>
        {showLog ? (
          <Card className="mt-1 divide-y divide-border">
            {events.isPending ? (
              <p className="px-4 py-3 text-[13px] text-ink-soft">读取中…</p>
            ) : (events.data ?? []).length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-soft">暂无记录</p>
            ) : (
              (events.data ?? []).map((event) => <EventLine key={event.id} event={event} />)
            )}
          </Card>
        ) : null}
      </div>
    </section>
  );
}

export function KitchenPage() {
  const { session } = useAuth();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [rejecting, setRejecting] = useState<{ item: MenuItem; reason: string } | null>(null);

  const menus = useMenusOfDate(date);
  const members = useMembers();
  const generate = useGenerateShoppingList();
  const { updateItem } = useMenuMutations(date);

  const memberId = session?.member.id ?? '';
  const anyItems = (menus.data ?? []).some((menu) => menu.items.length > 0);
  // 已有人准备的菜，后端要求填原因；待认领的菜原因选填
  const reasonRequired =
    rejecting?.item.status === 'accepted' || rejecting?.item.status === 'cooking';

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-32 pt-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">菜单安排</h1>
          <p className="mt-1 text-sm text-ink-soft">分配主厨、认领菜品并查看进度</p>
        </div>
        <Link
          to="/order"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-accent transition-colors duration-150 hover:bg-muted"
        >
          ← 回去点菜
        </Link>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="date"
          aria-label="选择日期"
          value={date}
          onChange={(event) => event.target.value && setDate(event.target.value)}
          className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink hover:border-ink-soft/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        {date === today ? null : (
          <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => setDate(today)}>
            回今天
          </Button>
        )}
        <Button
          variant="outline"
          className="ml-auto h-9 px-3 text-[13px]"
          disabled={generate.isPending || !anyItems}
          onClick={() =>
            generate.mutate(date, {
              onSuccess: (list) =>
                pushToast(
                  list.length
                    ? `清单已生成：共 ${list.length} 项食材，去「购物清单」看`
                    : '接单的菜都不缺食材（常备调料不进清单）',
                ),
            })
          }
        >
          {generate.isPending ? '生成中…' : '生成购物清单'}
        </Button>
      </div>

      {menus.isPending ? (
        <p className="mt-8 px-1 text-sm text-ink-soft">读取中…</p>
      ) : !anyItems ? (
        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <span className="text-4xl">🍳</span>
          <p className="text-sm font-medium">这天还没有安排</p>
          <p className="text-[13px] text-ink-soft">等家人去「点菜」页下单吧</p>
        </div>
      ) : (
        (menus.data ?? []).map((menu) => (
          <MealSection
            key={menu.id}
            menu={menu}
            members={members.data ?? []}
            memberId={memberId}
            date={date}
            onReject={(item) => setRejecting({ item, reason: '' })}
          />
        ))
      )}

      {rejecting ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 backdrop-blur-xl">
          <div className="mx-auto w-full max-w-[760px] px-4 py-3">
            <p className="text-[13px] text-ink-soft">
              {reasonRequired
                ? '这道菜已经有人准备，请填写原因。'
                : '划掉后会移出有效菜单，之后仍可恢复。'}
            </p>
            <div className="mt-2 flex gap-2">
              <Input
                autoFocus
                value={rejecting.reason}
                placeholder={reasonRequired ? '划掉原因' : '原因（选填）'}
                onChange={(event) => setRejecting({ ...rejecting, reason: event.target.value })}
              />
              <Button
                className="shrink-0"
                disabled={(reasonRequired && !rejecting.reason.trim()) || updateItem.isPending}
                onClick={() =>
                  updateItem.mutate(
                    {
                      id: rejecting.item.id,
                      body: {
                        status: 'rejected',
                        ...(rejecting.reason.trim() ? { reason: rejecting.reason.trim() } : {}),
                      },
                    },
                    { onSuccess: () => setRejecting(null) },
                  )
                }
              >
                划掉
              </Button>
              <Button variant="ghost" className="shrink-0" onClick={() => setRejecting(null)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
