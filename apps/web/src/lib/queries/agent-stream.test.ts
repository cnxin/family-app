import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventsConnected,
  listenAgentRuns,
  listenEventsConnected,
  subscribeEvents,
  type EventsTransport,
  type EventsTransportOptions,
} from '@family/api-client';
import type { AgentRunStreamEvent } from '@family/contracts';
import { reduceAgentRunStream, type AgentRunStream } from './agent';

// J4.4 小管家流式：/events 的 agent.run 帧分给旁听者、连接状态给断线兜底轮询用、对话页把帧拼成回答。

function fakeTransport() {
  const attempts: { options: EventsTransportOptions; fail(): void }[] = [];
  const transport: EventsTransport = (options) =>
    new Promise<void>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      attempts.push({ options, fail: () => reject(new Error('network')) });
    });
  return { attempts, transport };
}

const hello = JSON.stringify({ serverTime: '2026-10-10T00:00:00.000Z', connectionId: 'c1' });
const RUN = '00000000-0000-4000-8000-000000000001';
const CONVERSATION = '00000000-0000-4000-8000-000000000002';

function frame(seq: number, payload: Record<string, unknown>) {
  return { runId: RUN, conversationId: CONVERSATION, seq, ...payload } as AgentRunStreamEvent;
}

describe('agent.run 帧与连接状态', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('agent.run 帧交给 onAgentRun 和旁听者；取消登记后不再收到', async () => {
    const { attempts, transport } = fakeTransport();
    const onAgentRun = vi.fn();
    const heard: AgentRunStreamEvent[] = [];
    const stop = listenAgentRuns((event) => heard.push(event));
    const sub = subscribeEvents({
      url: '/api/events',
      transport,
      credentials: { getAccessToken: () => 'a1', refreshAccessToken: async () => null },
      handlers: { onChanged: () => undefined, onAgentRun },
    });
    await vi.advanceTimersByTimeAsync(0);
    attempts[0].options.onFrame('hello', hello);
    const delta = frame(1, { type: 'text_delta', text: '好的' });
    attempts[0].options.onFrame('agent.run', JSON.stringify(delta));
    expect(onAgentRun).toHaveBeenCalledWith(delta);
    expect(heard).toEqual([delta]);

    stop();
    attempts[0].options.onFrame('agent.run', JSON.stringify(frame(2, { type: 'done', status: 'completed', errorCode: null })));
    expect(heard).toHaveLength(1);
    expect(onAgentRun).toHaveBeenCalledTimes(2);
    sub.close();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('收到 hello 算连着，断了算没连着；状态变化通知登记者', async () => {
    const { attempts, transport } = fakeTransport();
    const changes: boolean[] = [];
    const stop = listenEventsConnected((connected) => changes.push(connected));
    const sub = subscribeEvents({
      url: '/api/events',
      transport,
      credentials: { getAccessToken: () => 'a1', refreshAccessToken: async () => null },
      handlers: { onChanged: () => undefined },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(eventsConnected()).toBe(false);
    attempts[0].options.onFrame('hello', hello);
    expect(eventsConnected()).toBe(true);
    attempts[0].fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(eventsConnected()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    attempts[1].options.onFrame('hello', hello);
    expect(eventsConnected()).toBe(true);
    sub.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(eventsConnected()).toBe(false);
    expect(changes).toEqual([true, false, true, false]);
    stop();
  });
});

describe('reduceAgentRunStream', () => {
  it('按顺序拼字、记工具进度，done 收尾', () => {
    const events = [
      frame(1, { type: 'tool_call', toolCallId: 't1', toolName: 'get_finance_summary' }),
      frame(2, { type: 'tool_result', toolCallId: 't1', toolName: 'get_finance_summary', ok: true, errorCode: null }),
      frame(3, { type: 'proposal', toolCallId: 't2', toolName: 'propose_finance_transaction', proposalId: RUN }),
      frame(4, { type: 'text_delta', text: '已经起草' }),
      frame(5, { type: 'text_delta', text: '了一笔' }),
      frame(6, { type: 'usage', inputTokens: 10, outputTokens: 5 }),
      frame(7, { type: 'done', status: 'completed', errorCode: null }),
    ];
    let stream: AgentRunStream | undefined;
    const texts: string[] = [];
    for (const event of events) {
      stream = reduceAgentRunStream(stream, event);
      texts.push(stream.text);
    }
    expect(texts).toEqual(['', '', '', '已经起草', '已经起草了一笔', '已经起草了一笔', '已经起草了一笔']);
    expect(stream).toEqual({
      conversationId: CONVERSATION,
      text: '已经起草了一笔',
      tools: [{ toolCallId: 't1', toolName: 'get_finance_summary', ok: true }],
      done: true,
    });
  });
});
