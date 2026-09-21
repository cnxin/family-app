import { useEffect, useState } from 'react';
import type { Toast } from '../lib/toast';
import { dismissToast, subscribeToasts } from '../lib/toast';

/** 失败提示停在屏幕下方，带 requestId——报问题时把它给我，我能直接定位那条请求。 */
export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-50 lg:bottom-0 flex flex-col items-center gap-2 px-4 pb-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className={`pointer-events-auto flex w-full max-w-[520px] items-start gap-3 rounded-xl border bg-surface px-4 py-3 shadow-lg ${toast.action ? 'border-border' : 'border-danger/30'}`}
        >
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${toast.action ? 'bg-accent' : 'bg-danger'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{toast.message}</p>
            {toast.requestId ? (
              <p className="mt-0.5 font-mono text-[11px] text-ink-soft">{toast.requestId}</p>
            ) : null}
          </div>
          {toast.action ? (
            <button type="button" className="min-h-11 shrink-0 rounded-md px-2 text-sm text-accent hover:bg-muted"
              onClick={() => { toast.action!.run(); dismissToast(toast.id); }}>
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="min-h-11 shrink-0 rounded-md px-2 py-1 text-[13px] text-ink-soft hover:bg-muted"
          >
            知道了
          </button>
        </div>
      ))}
    </div>
  );
}
