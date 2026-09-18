import { useState } from 'react';
import type { GuestMealRequest, GuestMealRequestStatus, MealType } from '@family/contracts';
import {
  MEAL_LABELS,
  useClaimGuestMealOption,
  useGuestMealOptions,
  useGuestMealRequests,
  useSubmitGuestMealRequest,
} from '../lib/queries';
import { Button, Card, Input } from './ui';

const STATUS_LABELS: Record<GuestMealRequestStatus, string> = {
  pending: '等家里人确认',
  accepted: '已接受',
  rejected: '这次不安排',
};

const STATUS_TEXT: Record<GuestMealRequestStatus, string> = {
  pending: 'text-ink-soft',
  accepted: 'text-accent',
  rejected: 'text-warm',
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${value}T00:00:00`));
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        'h-9 rounded-lg border px-3 text-[13px] transition-colors duration-150 ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
        (active
          ? 'border-accent bg-accent-soft font-medium text-accent'
          : 'border-border text-ink-soft hover:text-ink')
      }
    >
      {children}
    </button>
  );
}

/** 家里已经排好的菜单：访客点一下就是「我要这道」，后端幂等，重复点拿回同一条。 */
export function GuestMealMenu({ token }: { token: string }) {
  const options = useGuestMealOptions(token);
  const claim = useClaimGuestMealOption(token);
  if (options.isLoading) return null;
  const menus = options.data ?? [];

  return (
    <Card className="mt-4 p-4">
      <h2 className="text-[15px] font-semibold">本次来访菜单</h2>
      <p className="mt-1 text-[13px] text-ink-soft">
        {menus.length ? '选好想吃的菜，家里人会看到你的选择。' : '家里还没排可选的菜，过会儿再打开这个链接看看。'}
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {menus.map((menu) => (
          <div key={menu.id} className="flex flex-col gap-1.5">
            <p className="text-[13px] text-ink-soft">
              {dateLabel(menu.mealDate)} · {MEAL_LABELS[menu.mealType]}
            </p>
            {menu.items.map((item) => (
              <article
                key={item.id}
                aria-label={item.dishName}
                className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.dishName}</p>
                  <p className="text-[12px] text-ink-soft">{item.dishCategory}</p>
                </div>
                {item.request ? (
                  <span className={`text-[12px] ${STATUS_TEXT[item.request.status]}`}>
                    {STATUS_LABELS[item.request.status]}
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    className="h-8 px-3 text-[13px]"
                    disabled={claim.isPending}
                    onClick={() => claim.mutate(item.id)}
                  >
                    我要这道
                  </Button>
                )}
              </article>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * 菜单外自由点菜的输入框。表单状态用 key 重挂载来重置（换一餐、或者提交后拿到新的请求），
 * 而不是在 effect 里 setState——后者会多渲染一轮，还容易把人正在打的字冲掉。
 */
function FreeFormFields({
  current,
  pending,
  onSubmit,
}: {
  current?: GuestMealRequest;
  pending: boolean;
  onSubmit: (dishName: string, note: string | null) => void;
}) {
  const [dishName, setDishName] = useState(current?.dishName ?? '');
  const [note, setNote] = useState(current?.note ?? '');

  return (
    <div className="mt-3 flex flex-col gap-2">
      <label className="block">
        <span className="sr-only">想吃什么</span>
        <Input
          value={dishName}
          maxLength={120}
          placeholder="想吃什么菜？"
          onChange={(event) => setDishName(event.target.value)}
        />
      </label>
      <label className="block">
        <span className="sr-only">备注</span>
        <textarea
          value={note}
          rows={2}
          maxLength={300}
          placeholder="口味、忌口或者别的（选填）"
          onChange={(event) => setNote(event.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
      </label>
      <Button
        disabled={!dishName.trim() || pending}
        onClick={() => onSubmit(dishName.trim(), note.trim() || null)}
      >
        {current ? '更新这一餐的请求' : '提交点菜请求'}
      </Button>
    </div>
  );
}

/** 菜单外的自由点菜：同一天同一餐只有一条，再提交就是覆盖（后端语义）。 */
export function GuestMealRequestForm({ token, dates }: { token: string; dates: string[] }) {
  const requests = useGuestMealRequests(token);
  const submit = useSubmitGuestMealRequest(token);
  const [mealDate, setMealDate] = useState(dates[0] ?? '');
  const [mealType, setMealType] = useState<MealType>('dinner');

  // 后端一个「日期 + 餐次」只存一条请求：菜单里点的那道和这里自由填的是同一条，
  // 再提交就是覆盖。所以这里不能按 menuItemId 过滤，否则会以为没提过、再提一次把它顶掉。
  const current = requests.data?.find(
    (request) => request.mealDate === mealDate && request.mealType === mealType,
  );

  if (!dates.length) return null;
  const editable = !current || current.status === 'pending';
  const others = (requests.data ?? []).filter((request) => request.id !== current?.id);

  return (
    <Card className="mt-4 p-4">
      <h2 className="text-[15px] font-semibold">菜单外的请求</h2>
      <p className="mt-1 text-[13px] text-ink-soft">菜单上没有、又特别想吃的，写在这里。</p>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="哪一天">
        {dates.map((value) => (
          <Chip key={value} active={value === mealDate} onClick={() => setMealDate(value)}>
            {dateLabel(value)}
          </Chip>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="哪一餐">
        {(Object.keys(MEAL_LABELS) as MealType[]).map((value) => (
          <Chip key={value} active={value === mealType} onClick={() => setMealType(value)}>
            {MEAL_LABELS[value]}
          </Chip>
        ))}
      </div>

      {editable ? (
        <FreeFormFields
          key={`${mealDate}·${mealType}·${current?.id ?? 'new'}`}
          current={current}
          pending={submit.isPending}
          onSubmit={(dishName, note) => submit.mutate({ mealDate, mealType, dishName, note })}
        />
      ) : (
        <div
          className={`mt-3 rounded-lg px-3 py-2.5 ${current.status === 'accepted' ? 'bg-accent-soft' : 'bg-warm-soft'}`}
        >
          <p className={`text-sm font-medium ${STATUS_TEXT[current.status]}`}>
            {STATUS_LABELS[current.status]}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {current.dishName}
            {current.reviewNote ? ` · ${current.reviewNote}` : ''}
          </p>
        </div>
      )}

      {others.length ? (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
          {others.map((request: GuestMealRequest) => (
            <li key={request.id} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-ink-soft">
                {dateLabel(request.mealDate)} · {MEAL_LABELS[request.mealType]} · {request.dishName}
              </span>
              <span className={STATUS_TEXT[request.status]}>{STATUS_LABELS[request.status]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
