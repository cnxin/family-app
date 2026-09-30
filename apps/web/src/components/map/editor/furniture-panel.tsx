import { DetentSheet } from '../../ui/detent-sheet';
import { FURNITURE, type FurnitureSpec } from '../furniture-catalog';
import { FurnitureIcon } from '../furniture-icons';

// 家具库面板（地图编辑器 v2 §1.2、§3）：电脑上是左侧浮动面板（不遮中间），手机上是底部半开 sheet（非模态，地图照样能点）。
// 放：点一个落到选中的房间中央；换：只列同一类（收纳换收纳、装饰换装饰）。底部「自定义柜子」= 以前的画柜子。

export type FurniturePanelMode = { type: 'add' } | { type: 'replace'; group: FurnitureSpec['group']; current: string | null; name: string };

export function FurniturePanel({
  desktop,
  mode,
  roomName,
  onPick,
  onCustom,
  onClose,
}: {
  desktop: boolean;
  mode: FurniturePanelMode;
  /** 放到哪间（提示用）；null = 还没选房间 */
  roomName: string | null;
  onPick: (spec: FurnitureSpec) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const replacing = mode.type === 'replace';
  const title = replacing ? `把「${mode.name}」换成…` : '家具库';
  const groups = (
    [
      { key: 'storage', label: '收纳', hint: '能放东西，入库时选得到' },
      { key: 'decor', label: '装饰', hint: '只画在图上，不放东西' },
    ] as const
  ).filter((group) => !replacing || group.key === mode.group);

  const body = (
    <div className="flex flex-col gap-3">
      {!replacing ? (
        <p className="text-[12.5px] leading-snug text-ink-soft">
          {roomName ? `点一个放到「${roomName}」，放下再拖、拉、转` : '先在图上点一个房间，再点家具放进去'}
        </p>
      ) : null}
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h3 className="mb-1.5 flex items-baseline gap-2 text-[13px] font-semibold">
            {group.label}
            <span className="text-[11.5px] font-normal text-ink-soft">{group.hint}</span>
          </h3>
          <div className={'grid gap-1 ' + (desktop ? 'grid-cols-3' : 'grid-cols-4')}>
            {FURNITURE.filter((one) => one.group === group.key).map((spec) => {
              const current = replacing && mode.current === spec.key;
              return (
                <button
                  key={spec.key}
                  type="button"
                  data-furniture-pick={spec.key}
                  disabled={current}
                  onClick={() => onPick(spec)}
                  className={
                    'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-[12px] transition-[background-color,transform] duration-150 active:scale-[0.96] disabled:opacity-40 ' +
                    (group.key === 'decor' ? 'text-ink-soft hover:bg-muted' : 'text-ink hover:bg-muted')
                  }
                >
                  <FurnitureIcon kind={spec.key} className="size-7" />
                  {spec.label}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {!replacing ? (
        <button
          type="button"
          onClick={onCustom}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-ink"
        >
          <span aria-hidden="true">▤</span>
          {desktop ? '自定义柜子：在房间里拖一个矩形' : '自定义柜子'}
        </button>
      ) : null}
    </div>
  );

  if (!desktop) {
    return (
      <DetentSheet title={title} modal={false} mediumShown={0.46} onClose={onClose} header={<h2 className="truncate text-[17px] font-semibold">{title}</h2>}>
        {body}
      </DetentSheet>
    );
  }
  return (
    <aside
      aria-label={title}
      className="absolute left-4 top-[68px] z-20 flex max-h-[calc(100%-96px)] w-[252px] flex-col overflow-hidden rounded-2xl border border-border bg-surface/92 shadow-lg backdrop-blur-xl motion-safe:animate-[float-in_160ms_cubic-bezier(0,0,0.2,1)]"
    >
      <header className="flex items-center justify-between gap-2 px-3.5 pb-1 pt-3">
        <h2 className="truncate text-[15px] font-semibold">{title}</h2>
        <button type="button" aria-label="关闭家具库" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-ink-soft hover:bg-muted">
          ✕
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto px-3 pb-3">{body}</div>
    </aside>
  );
}
