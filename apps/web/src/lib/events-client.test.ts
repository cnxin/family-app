import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventsUnauthorizedError,
  subscribeEvents,
  type EventsStatus,
  type EventsTransport,
  type EventsTransportOptions,
} from '@family/api-client';

// subscribeEvents 的重连 / 续期 / 退避逻辑，用假传输层驱动；真实 /events 见 e2e/live-events.spec.ts。

interface Attempt {
  options: EventsTransportOptions;
  end(): void;
  fail(error?: Error): void;
}

function fakeTransport() {
  const attempts: Attempt[] = [];
  const transport: EventsTransport = (options) =>
    new Promise<void>((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      attempts.push({ options, end: resolve, fail: (error = new Error('network')) => reject(error) });
    });
  return { attempts, transport };
}

const hello = JSON.stringify({ serverTime: '2026-09-28T00:00:00.000Z', connectionId: 'c1' });

describe('subscribeEvents', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('带令牌连上，hello 算 open，changed 交给调用方', async () => {
    const { attempts, transport } = fakeTransport();
    const statuses: EventsStatus[] = [];
    const onChanged = vi.fn();
    const sub = subscribeEvents({
      url: '/api/events',
      transport,
      credentials: { getAccessToken: () => 'a1', refreshAccessToken: async () => null },
      handlers: { onChanged, onStatus: (status) => statuses.push(status) },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts[0].options.token).toBe('a1');
    attempts[0].options.onFrame('hello', hello);
    attempts[0].options.onFrame('heartbeat', '');
    attempts[0].options.onFrame('changed', JSON.stringify({ domains: ['shopping'], at: 'x' }));
    expect(sub.status).toBe('open');
    expect(onChanged).toHaveBeenCalledWith({ domains: ['shopping'], at: 'x' });
    sub.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toEqual(['open', 'closed']);
  });

  it('断了按 1s、2s、4s 退避重连；收到 hello 退避清零；reconnectNow 不等退避', async () => {
    const { attempts, transport } = fakeTransport();
    const sub = subscribeEvents({
      url: '/api/events',
      transport,
      credentials: { getAccessToken: () => 'a1', refreshAccessToken: async () => null },
      handlers: { onChanged: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(0);
    attempts[0].fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(attempts).toHaveLength(1);
    expect(sub.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toHaveLength(2);
    attempts[1].fail();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(attempts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toHaveLength(3);

    attempts[2].options.onFrame('hello', hello);
    attempts[2].end();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toHaveLength(4);

    attempts[3].fail();
    await vi.advanceTimersByTimeAsync(0);
    sub.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toHaveLength(5);
    sub.close();
  });

  it('45 秒一帧都没有当作断线', async () => {
    const { attempts, transport } = fakeTransport();
    const sub = subscribeEvents({
      url: '/api/events',
      transport,
      credentials: { getAccessToken: () => 'a1', refreshAccessToken: async () => null },
      handlers: { onChanged: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(0);
    attempts[0].options.onFrame('hello', hello);
    await vi.advanceTimersByTimeAsync(44_999);
    expect(attempts[0].options.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts[0].options.signal.aborted).toBe(true);
    expect(sub.status).toBe('reconnecting');
    sub.close();
  });

  it('401 先续期再用新令牌连；续期失败就停下，不再重试', async () => {
    const { attempts, transport } = fakeTransport();
    let token = 'expired';
    const refresh = vi.fn(async () => {
      token = 'fresh';
      return token;
    });
    const sub = subscribeEvents({
      url: '/api/events',
      transport,
      credentials: { getAccessToken: () => token, refreshAccessToken: refresh },
      handlers: { onChanged: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(0);
    attempts[0].fail(new EventsUnauthorizedError());
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(attempts[1].options.token).toBe('fresh');

    refresh.mockResolvedValueOnce(null as unknown as string);
    attempts[1].fail(new EventsUnauthorizedError());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sub.status).toBe('closed');
    expect(attempts).toHaveLength(2);
  });

  it('还没有令牌（刚打开页面）时先续期', async () => {
    const { attempts, transport } = fakeTransport();
    let token: string | null = null;
    const sub = subscribeEvents({
      url: '/api/events',
      transport,
      credentials: {
        getAccessToken: () => token,
        refreshAccessToken: async () => {
          token = 'restored';
          return token;
        },
      },
      handlers: { onChanged: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts[0].options.token).toBe('restored');
    sub.close();
  });
});
