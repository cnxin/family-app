// 黑盒脚本共用：用 fetch 读 /events 的 SSE 流（和客户端一样走 Authorization 请求头）。
// openEventStream 返回 { status, frames, waitFor, close }；frames 是已收到的 { event, data, at }。

export async function openEventStream(base, token) {
  const controller = new AbortController();
  const response = await fetch(`${base}/events`, {
    headers: {
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: controller.signal,
  });
  const frames = [];
  const waiters = new Set();
  const stream = { status: response.status, frames, waitFor, close };
  if (response.status !== 200 || !response.body) {
    await response.text().catch(() => '');
    return stream;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const frame = { event: 'message', data: '', at: Date.now() };
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) frame.event = line.slice(6).trim();
            else if (line.startsWith('data:')) frame.data += line.slice(5).trim();
          }
          frames.push(frame);
          for (const waiter of [...waiters]) waiter.check();
        }
      }
    } catch {
      /* 主动 close 时 abort */
    }
    for (const waiter of [...waiters]) waiter.check(true);
  })();

  /** 等一条满足 predicate 的帧；超时返回 null。只看调用之后到达的帧时传 since。 */
  function waitFor(predicate, timeoutMs, since = 0) {
    return new Promise((resolve) => {
      const waiter = {
        check(ended = false) {
          const hit = frames.slice(since).find(predicate);
          if (hit || ended) {
            waiters.delete(waiter);
            clearTimeout(timer);
            resolve(hit ?? null);
          }
        },
      };
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        resolve(null);
      }, timeoutMs);
      waiters.add(waiter);
      waiter.check();
    });
  }

  function close() {
    controller.abort();
  }
  return stream;
}

export function changedDomains(frame) {
  if (!frame || frame.event !== 'changed') return [];
  try {
    return JSON.parse(frame.data).domains ?? [];
  } catch {
    return [];
  }
}
