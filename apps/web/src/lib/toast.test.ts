import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { dismissToast, pushToast, subscribeToasts, type Toast } from './toast';

// K 收尾：提示有语气（成功 / 信息 / 失败），默认信息；按钮挪到第四个参数。

describe('pushToast', () => {
  let current: Toast[] = [];
  const unsubscribe = subscribeToasts((next) => {
    current = next;
  });
  afterEach(() => {
    for (const toast of current) dismissToast(toast.id);
  });
  afterAll(() => unsubscribe());

  it('不给语气默认是信息；成功、失败按给的来，失败可以带 requestId', () => {
    pushToast('说明一下');
    pushToast('记下了', undefined, 'success');
    pushToast('没记上', 'req-1', 'error');
    expect(current.map((toast) => [toast.message, toast.tone, toast.requestId])).toEqual([
      ['说明一下', 'info', undefined],
      ['记下了', 'success', undefined],
      ['没记上', 'error', 'req-1'],
    ]);
  });

  it('按钮在第四个参数', () => {
    const run = () => undefined;
    pushToast('还有 2 笔', undefined, 'info', { label: '同时改', run });
    expect(current.at(-1)).toMatchObject({ tone: 'info', action: { label: '同时改', run } });
  });
});
