// 复制文字。navigator.clipboard 只在安全上下文里有（局域网 IP 打开时是 undefined），
// 退一步用 document.execCommand('copy')（老办法，不安全上下文也行）；都不行返回 false，
// 调用方把那段文字选中、提示「手动复制」。源码里不要直接写 navigator.clipboard.writeText（静态检查会拦）。

export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒之类，接着试老办法
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // 放在屏幕外，不让页面跳；iOS 需要可选中才能复制
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  const previous = document.activeElement as HTMLElement | null;
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  previous?.focus?.();
  return copied;
}

/** 复制不成时把页面上那段文字整段选中，方便长按 / ⌘C 手动复制 */
export function selectText(element: Element | null) {
  if (!element) return;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.focus();
    element.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
