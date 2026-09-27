import { useState } from 'react';
import type { TravelChecklistCategory, TravelChecklistItem, TravelPlan } from '@family/contracts';
import {
  TRAVEL_CATEGORY_EMOJI,
  TRAVEL_CATEGORY_LABELS,
  shiftDays,
  todayISO,
  travelKey,
  useMembers,
  useSaveTravelItem,
  useSaveTravelPlan,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');
const textarea =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

export function PlanForm({
  editing,
  onSaved,
  onClose,
}: {
  editing: TravelPlan | null;
  onSaved: (plan: TravelPlan) => void;
  onClose: () => void;
}) {
  const save = useSaveTravelPlan();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [destination, setDestination] = useState(editing?.destination ?? '');
  const [startDate, setStartDate] = useState(editing?.startDate ?? shiftDays(todayISO(), 7));
  const [endDate, setEndDate] = useState(editing?.endDate ?? shiftDays(todayISO(), 8));
  const [note, setNote] = useState(editing?.note ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [idempotencyKey] = useState(() =>
    travelKey(editing ? `travel:plan:update:${editing.id}` : 'travel:plan:create'),
  );

  function submit() {
    if (!title.trim()) return setMessage('先给这趟起个名字');
    if (endDate < startDate) return setMessage('返程不能早于出发');
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        expectedVersion: editing?.version,
        idempotencyKey,
        body: {
          title: title.trim(),
          destination: destination.trim() || null,
          startDate,
          endDate,
          note: note.trim() || null,
        },
      },
      {
        onSuccess: (plan) => {
          pushToast(editing ? '行程已更新' : `「${plan.title}」安排上了`);
          onSaved(plan);
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.title}」` : '安排一趟出行'}
      maxWidth={520}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : editing ? '保存修改' : '创建行程'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>行程名称</span>
          <Input
            autoFocus
            value={title}
            maxLength={120}
            aria-label="行程名称"
            placeholder="周末短途、探亲或者家庭旅行"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>去哪儿（选填）</span>
          <Input
            value={destination}
            maxLength={120}
            aria-label="目的地"
            placeholder="城市或者区域就行"
            onChange={(event) => setDestination(event.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>出发</span>
            <Input
              type="date"
              value={startDate}
              aria-label="出发日期"
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>返程</span>
            <Input
              type="date"
              value={endDate}
              aria-label="返程日期"
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className={label}>备注（选填）</span>
          <textarea
            value={note}
            rows={3}
            maxLength={1000}
            aria-label="行程备注"
            placeholder="集合方式、家里的约定"
            className={textarea}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}

export function ItemForm({
  plan,
  editing,
  onClose,
}: {
  plan: TravelPlan;
  editing: TravelChecklistItem | null;
  onClose: () => void;
}) {
  const members = useMembers();
  const save = useSaveTravelItem();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [category, setCategory] = useState<TravelChecklistCategory>(editing?.category ?? 'supplies');
  const [quantity, setQuantity] = useState(editing?.quantity ?? 1);
  const [assignedMemberId, setAssignedMemberId] = useState(editing?.assignedMember?.id ?? null);
  const [note, setNote] = useState(editing?.note ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [idempotencyKey] = useState(() =>
    travelKey(editing ? `travel:item:update:${editing.id}` : `travel:item:create:${plan.id}`),
  );

  function submit() {
    if (!title.trim()) return setMessage('先写要带什么');
    setMessage(null);
    save.mutate(
      {
        planId: plan.id,
        itemId: editing?.id,
        expectedVersion: editing?.version,
        idempotencyKey,
        // 新项排在最后：用现有项里最大的 sortOrder + 1，别用 items.length——
        // 移除过项之后 length 会和已有的号撞上，排序就乱了
        sortOrder: editing
          ? undefined
          : plan.items.reduce((max, one) => Math.max(max, one.sortOrder), -1) + 1,
        body: {
          title: title.trim(),
          category,
          quantity,
          note: note.trim() || null,
          assignedMemberId,
        },
      },
      {
        onSuccess: () => {
          pushToast(editing ? '清单项已更新' : '加进清单了');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.title}」` : '加一项'}
      maxWidth={520}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : editing ? '保存修改' : '加进清单'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>要带什么 / 出发前要做什么</span>
          <Input
            autoFocus
            value={title}
            maxLength={120}
            aria-label="清单项名称"
            placeholder="比如：充电器"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div>
          <span className={label}>分类</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(TRAVEL_CATEGORY_LABELS) as TravelChecklistCategory[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                className={chip(category === value)}
                onClick={() => setCategory(value)}
              >
                {TRAVEL_CATEGORY_EMOJI[value]} {TRAVEL_CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={label}>数量</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9 w-9 px-0"
              aria-label="减少数量"
              disabled={quantity <= 1}
              onClick={() => setQuantity(quantity - 1)}
            >
              −
            </Button>
            <span className="min-w-[32px] text-center text-[14px] tabular-nums">{quantity}</span>
            <Button
              variant="outline"
              className="h-9 w-9 px-0"
              aria-label="增加数量"
              disabled={quantity >= 99}
              onClick={() => setQuantity(quantity + 1)}
            >
              ＋
            </Button>
          </div>
        </div>

        <div>
          <span className={label}>谁负责</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={assignedMemberId === null}
              className={chip(assignedMemberId === null)}
              onClick={() => setAssignedMemberId(null)}
            >
              先不指定
            </button>
            {(members.data ?? []).map((one) => (
              <button
                key={one.id}
                type="button"
                aria-pressed={assignedMemberId === one.id}
                className={chip(assignedMemberId === one.id)}
                onClick={() => setAssignedMemberId(one.id)}
              >
                {one.avatarEmoji} {one.name}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={label}>备注（选填）</span>
          <Input
            value={note}
            maxLength={500}
            aria-label="清单项备注"
            placeholder="尺寸、在哪儿拿、家里的约定"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}
