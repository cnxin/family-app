// 假的 OpenAI 兼容模型服务（J4.3 测试用，照 fake-ha.mjs 的做法：黑盒 / e2e 自己起，端口交给系统分配）。
// POST <url>/chat/completions，只回流式（SSE）：
// - key 不对 → 401，正文回显收到的 key（看小管家有没有把它打码）；
// - max_tokens = 1（「测一下」）→ 一个字，finish_reason = length；
// - 「记一笔 38 买菜」→ 按工具结果走：先调 get_finance_summary，再用返回里的第一个账户、名字带「买菜」的分类
//   （没有就第一个支出分类）调 propose_finance_transaction，最后作答；
// - 其余：把成员最后一句话原样回一遍（「收到：…」）。
// 作答的正文按 chunkMs 分段慢慢吐（J4.4 看对话页的字是不是一段段长出来的）；chunkMs = 0 时一次回完。
// - 消息里带图片（image_url 块，K2 截图记账）→ 按 vision.mode：json 回 vision.reply（固定 JSON），
//   garbage 回一句不是 JSON 的话；黑盒 / e2e 改返回对象上的 vision 切换。
// 每次请求的 JSON 都记在 requests 里（看发出去的内容有没有脱敏）。
import { createServer } from 'node:http';

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function sse(response, chunks) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.end('data: [DONE]\n\n');
}

const choice = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });
const usage = (prompt, completion) => ({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion } });

function textReply(response, text, chunkMs = 0) {
  if (!chunkMs) {
    sse(response, [choice({ role: 'assistant', content: text }), choice({}, 'stop'), usage(100, text.length)]);
    return;
  }
  // 每段 4 个字，段与段之间隔 chunkMs
  const pieces = text.match(/[\s\S]{1,4}/g) ?? [];
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const write = (chunk) => response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  write(choice({ role: 'assistant', content: '' }));
  let index = 0;
  const next = () => {
    if (response.destroyed) return;
    if (index < pieces.length) {
      write(choice({ content: pieces[index] }));
      index += 1;
      setTimeout(next, chunkMs);
      return;
    }
    write(choice({}, 'stop'));
    write(usage(100, text.length));
    response.end('data: [DONE]\n\n');
  };
  next();
}

function toolReply(response, name, args) {
  sse(response, [
    choice({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name, arguments: '' } }] }),
    choice({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }),
    choice({}, 'tool_calls'),
    usage(200, 20),
  ]);
}

/** 最后一条 user 消息带没带图片（OpenAI 兼容的 image_url 块）。 */
function hasImage(messages) {
  const last = [...messages].reverse().find((message) => message.role === 'user');
  return Array.isArray(last?.content) && last.content.some((part) => part?.type === 'image_url');
}

/** K2 截图识别的固定回答：美团外卖 36.5 元，花呗付的。 */
export const FAKE_SCREENSHOT_REPLY = {
  amount: 36.5,
  direction: 'expense',
  merchant: '美团外卖-望京店',
  occurredAt: '2026-10-09 12:30',
  payMethod: '花呗',
  note: '午饭',
};

/** 成员原话：最后一条 user 消息里最后一个围栏之后的部分。 */
function memberText(messages) {
  const last = [...messages].reverse().find((message) => message.role === 'user');
  const content = typeof last?.content === 'string' ? last.content : '';
  const fenceEnd = content.lastIndexOf('\n>>>\n\n');
  return fenceEnd >= 0 ? content.slice(fenceEnd + 6) : content;
}

function financeTurn(response, messages, chunkMs) {
  const lastTool = [...messages].reverse().find((message) => message.role === 'tool');
  const lastCall = [...messages].reverse().find((message) => message.role === 'assistant' && message.tool_calls?.length);
  const called = lastCall?.tool_calls?.[0]?.function?.name;
  if (!lastTool) return toolReply(response, 'get_finance_summary', {});
  if (called === 'get_finance_summary') {
    const summary = JSON.parse(lastTool.content);
    const account = (summary.accounts ?? []).find((one) => one.isActive !== false) ?? summary.accounts?.[0];
    const categories = summary.categories ?? [];
    const category = categories.find((one) => String(one.name).includes('买菜')) ?? categories.find((one) => one.kind === 'expense');
    return toolReply(response, 'propose_finance_transaction', {
      type: 'expense',
      amount: 38,
      accountId: account?.id,
      categoryId: category?.id ?? null,
      title: '买菜',
      occurredOn: today(),
    });
  }
  return textReply(response, '已经起草了一笔 38 元的买菜支出，你在下面确认后才会入账。', chunkMs);
}

export async function startFakeModel({ key = 'sk-fake-model-key-1234', port = 0, chunkMs = 0 } = {}) {
  const requests = [];
  const vision = { mode: 'json', reply: FAKE_SCREENSHOT_REPLY };
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404).end();
      return;
    }
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      const supplied = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (supplied !== key) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${supplied}`, type: 'invalid_request_error' } }));
        return;
      }
      const body = JSON.parse(raw);
      requests.push(body);
      if (body.max_tokens === 1) {
        sse(response, [choice({ role: 'assistant', content: '好' }), choice({}, 'length'), usage(5, 1)]);
        return;
      }
      if (hasImage(body.messages ?? [])) {
        return textReply(response, vision.mode === 'json' ? JSON.stringify(vision.reply) : '这张图看不太清楚，换一张试试？');
      }
      const text = memberText(body.messages ?? []);
      if (text.includes('记一笔 38 买菜')) return financeTurn(response, body.messages, chunkMs);
      return textReply(response, `收到：${text}`, chunkMs);
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  return {
    key,
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    vision,
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
