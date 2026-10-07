// 极小的全局提示：QueryClient 在 React 之外创建，拿不到 hook，
// 所以用模块级订阅把「写操作失败了」这件事送到界面上。
/** 提示的语气：成功（做成了）、信息（中性的说明）、失败（没做成 / 出错）。只决定颜色点和读屏的打断程度。 */
export type ToastTone = 'success' | 'info' | 'error';

export interface Toast {
  id: number;
  message: string;
  requestId?: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let listeners: Listener[] = [];
let seq = 0;

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function subscribeToasts(listener: Listener) {
  listeners.push(listener);
  listener(toasts);
  return () => {
    listeners = listeners.filter((one) => one !== listener);
  };
}

export function pushToast(message: string, requestId?: string, tone: ToastTone = 'info', action?: Toast['action']) {
  const toast = { id: (seq += 1), message, requestId, tone, action };
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => dismissToast(toast.id), action ? 10000 : 6000);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((one) => one.id !== id);
  emit();
}
