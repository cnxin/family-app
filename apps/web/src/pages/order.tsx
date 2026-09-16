import { useState } from 'react';
import { OrderSimplePage } from './order-simple';
import { OrderFullPage } from './order-full';

const KEY = 'family-app.order-variant';

/** 精简版 / 完整版就地切换：同一份数据、同一个后端，只是功能多少不同，方便直接对比。 */
export function OrderPage() {
  const [full, setFull] = useState(() => {
    try {
      return localStorage.getItem(KEY) === 'full';
    } catch {
      return false;
    }
  });

  function choose(next: boolean) {
    setFull(next);
    try {
      localStorage.setItem(KEY, next ? 'full' : 'simple');
    } catch {
      /* 隐私模式下记不住，不影响当前会话 */
    }
  }

  return (
    <div>
      <div className="mx-auto flex w-full max-w-[680px] items-center gap-2 px-4 pt-4">
        <span className="text-[12px] text-ink-soft">版本</span>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {[
            { value: false, label: '精简' },
            { value: true, label: '完整' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => choose(option.value)}
              aria-pressed={full === option.value}
              className={
                'rounded-md px-3 py-1 text-[13px] transition-colors duration-150 ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' +
                (full === option.value
                  ? 'bg-surface font-semibold text-ink shadow-sm'
                  : 'text-ink-soft hover:text-ink')
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-ink-soft">
          {full ? '备注 · 认领 · 菜谱 · 历史' : '只有点菜与进度'}
        </span>
      </div>
      {full ? <OrderFullPage /> : <OrderSimplePage />}
    </div>
  );
}
