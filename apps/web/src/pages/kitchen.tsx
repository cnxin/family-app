import { useState } from 'react';
import type { MemberProfile, Menu, MenuItem } from '@family/contracts';
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
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { useAuth } from '../lib/auth';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Page,
  Panel,
} from '../components/ui';
import { ListSkeleton } from '../components/skeleton';
import type { ItemAction } from '../components/kitchen-item';
import { actionsFor, StatusChip, ItemDetail, EventLine } from '../components/kitchen-item';

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
    <Page
      title="菜单安排"
      subtitle="分配主厨、认领菜品并查看进度"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-9 px-3 text-[13px]"
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
          <Link
            to="/eat/order"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-accent transition-colors duration-150 hover:bg-muted"
          >
            ← 回去点菜
          </Link>
        </div>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      }
    >
      <Panel className="p-3">
      {menus.isPending ? (
        <ListSkeleton rows={4} />
      ) : !anyItems ? (
        <EmptyState emoji="🍳" title="这天还没有安排" hint="等家人去「点菜」页下单吧" />
      ) : (
        // 宽屏一餐一行会把右边空出来，排两列
        <div className="grid gap-x-5 xl:grid-cols-2 xl:items-start">
        {(menus.data ?? []).map((menu) => (
          <MealSection
            key={menu.id}
            menu={menu}
            members={members.data ?? []}
            memberId={memberId}
            date={date}
            onReject={(item) => setRejecting({ item, reason: '' })}
          />
        ))}
        </div>
      )}
      </Panel>

      {rejecting ? (
        <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 border-t border-border bg-bg/95 backdrop-blur-xl lg:bottom-0">
          <div className="mx-auto w-full max-w-[1160px] px-4 lg:mx-0 lg:px-8 py-3">
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
    </Page>
  );
}
