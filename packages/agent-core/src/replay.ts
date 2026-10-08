// 录制与回放：单测与 J4.2 的确定性黑盒都不打真模型。
// 录制存两种响应：
// - events：直接给 ModelEvent 序列（手写剧本，和服务商无关）；
// - sse：服务商原始的流式响应体（按行存），回放时喂给 OpenAICompatibleProvider 现场解析，
//   所以回放同时覆盖了 SSE 切分、tool_calls 拼装与各家差异表。
// 入库前用 scrubRecording 去掉 key 与家庭数据；录制本身从不存请求头。
import { ProviderError } from './errors';
import { OpenAICompatibleProvider, type OpenAICompatibleOptions } from './openai-compatible';
import type { ModelEvent, ModelProvider, ModelRequest } from './types';

export type RecordedResponse =
  | { readonly events: readonly ModelEvent[] }
  | {
      readonly status: number;
      /** 2xx：原始 SSE 响应体，一行一个元素（含空行）。 */
      readonly sse?: readonly string[];
      /** 非 2xx：服务商返回的原文。 */
      readonly body?: string;
    };

export interface RecordedExchange {
  /** 请求指纹（requestFingerprint），按指纹回放时用。 */
  readonly fingerprint?: string;
  /** 给人看：这一轮请求在干什么。 */
  readonly note?: string;
  readonly response: RecordedResponse;
}

export interface Recording {
  /** providerQuirks 的 key（deepseek / qwen / generic）。 */
  readonly provider: string;
  readonly model?: string;
  /** recorded = 真实服务商的响应（已脱敏）；simulated = 按公开文档手写的模拟。 */
  readonly source: 'recorded' | 'simulated';
  readonly recordedAt?: string;
  readonly note?: string;
  readonly exchanges: readonly RecordedExchange[];
}

export interface ReplayOptions {
  /** index（默认）：第 n 次请求回放第 n 条；fingerprint：按请求指纹找。 */
  readonly match?: 'index' | 'fingerprint';
  /** SSE 回放时每次吐多少字节（默认整段一次吐完）；测分片用。 */
  readonly chunkSize?: number;
  /** 每吐一片前等多久（毫秒）；测超时 / 取消用。 */
  readonly latencyMs?: number;
}

export class ReplayProvider implements ModelProvider {
  /** 收到的每次请求（原样）。 */
  readonly requests: ModelRequest[] = [];
  /** SSE 回放时实际「发上线」的请求体（与真打服务商时一模一样，不含 key）。 */
  readonly wireBodies: Record<string, unknown>[] = [];
  private next = 0;

  constructor(
    private readonly recording: Recording,
    private readonly options: ReplayOptions = {},
  ) {}

  async *chat(request: ModelRequest): AsyncGenerator<ModelEvent> {
    if (request.signal?.aborted) throw new ProviderError('aborted', '请求已取消');
    this.requests.push(request);
    const exchange = this.pick(request);
    const response = exchange.response;
    if ('events' in response) {
      for (const event of response.events) {
        await delay(this.options.latencyMs, request.signal);
        yield event;
      }
      return;
    }
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://replay.invalid/v1',
      apiKey: 'replay',
      model: this.recording.model ?? 'replay',
      quirks: this.recording.provider as OpenAICompatibleOptions['quirks'],
      fetch: async (_url, init) => {
        this.wireBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return replayResponse(response, this.options, init?.signal ?? undefined);
      },
    });
    yield* provider.chat(request);
  }

  private pick(request: ModelRequest): RecordedExchange {
    const exchanges = this.recording.exchanges;
    if (this.options.match === 'fingerprint') {
      const fingerprint = requestFingerprint(request);
      const found = exchanges.find((exchange) => exchange.fingerprint === fingerprint);
      if (!found) throw new ProviderError('replay_mismatch', `录制里没有指纹 ${fingerprint} 的请求`);
      return found;
    }
    const index = this.next;
    this.next += 1;
    const found = exchanges[index];
    if (!found) throw new ProviderError('replay_mismatch', `录制只有 ${exchanges.length} 轮，第 ${index + 1} 次请求没有可回放的响应`);
    return found;
  }
}

/**
 * 录制：照常打服务商（OpenAICompatibleProvider），同时把原始响应体按行存下来。
 * 录制时响应先整段读完再交给解析（录制是开发工具，不在乎流式体验）。
 */
export class RecordingProvider implements ModelProvider {
  private readonly exchanges: RecordedExchange[] = [];

  constructor(
    private readonly options: OpenAICompatibleOptions & { readonly provider: string },
  ) {}

  chat(request: ModelRequest): AsyncIterable<ModelEvent> {
    const fingerprint = requestFingerprint(request);
    const doFetch = this.options.fetch ?? fetch;
    const provider = new OpenAICompatibleProvider({
      ...this.options,
      quirks: this.options.quirks ?? (this.options.provider as OpenAICompatibleOptions['quirks']),
      fetch: async (url, init) => {
        const response = await doFetch(url, init);
        const text = await response.text();
        this.exchanges.push({
          fingerprint,
          response: response.ok
            ? { status: response.status, sse: text.split('\n') }
            : { status: response.status, body: text },
        });
        return new Response(text, { status: response.status, headers: response.headers });
      },
    });
    return provider.chat(request);
  }

  /** 导出录制；apiKey 自动打码，其余敏感串（真名、手机号、账户名……）在 replace 里给。 */
  toRecording(meta: { note?: string; replace?: readonly (readonly [string | RegExp, string])[] } = {}): Recording {
    return scrubRecording(
      {
        provider: this.options.provider,
        model: this.options.model,
        source: 'recorded',
        recordedAt: new Date().toISOString(),
        ...(meta.note ? { note: meta.note } : {}),
        exchanges: this.exchanges,
      },
      [[this.options.apiKey, '***'], ...(meta.replace ?? [])],
    );
  }
}

/** 把录制里所有字符串过一遍替换（key、家庭数据）；返回新对象。 */
export function scrubRecording(
  recording: Recording,
  replace: readonly (readonly [string | RegExp, string])[],
): Recording {
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return replace.reduce<string>(
        (text, [pattern, replacement]) =>
          typeof pattern === 'string'
            ? pattern
              ? text.split(pattern).join(replacement)
              : text
            : text.replace(pattern, replacement),
        value,
      );
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    }
    return value;
  };
  return scrub(recording) as Recording;
}

/**
 * 请求指纹：消息（角色、正文、图片、工具调用的名字与参数、tool 结果）+ 工具名单，FNV-1a 64 位。
 * 不含工具调用 id（各家每次随机），不含 signal / maxTokens。
 */
export function requestFingerprint(request: ModelRequest): string {
  const canonical = JSON.stringify({
    messages: request.messages.map((message) => {
      switch (message.role) {
        case 'user':
          return ['user', message.content, (message.images ?? []).map((image) => ('url' in image ? image.url : image.base64.length))];
        case 'assistant':
          return ['assistant', message.content ?? '', (message.toolCalls ?? []).map((call) => [call.name, call.arguments])];
        case 'tool':
          return ['tool', message.content];
        default:
          return [message.role, message.content];
      }
    }),
    tools: (request.tools ?? []).map((tool) => tool.name),
  });
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

function replayResponse(
  response: Extract<RecordedResponse, { status: number }>,
  options: ReplayOptions,
  signal: AbortSignal | undefined,
): Response {
  if (response.status < 200 || response.status >= 300) {
    return new Response(response.body ?? '', { status: response.status });
  }
  const bytes = new TextEncoder().encode((response.sse ?? []).join('\n'));
  const size = options.chunkSize && options.chunkSize > 0 ? options.chunkSize : bytes.length || 1;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await delay(options.latencyMs, signal);
      } catch (error) {
        controller.error(error);
        return;
      }
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
  return new Response(stream, {
    status: response.status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function delay(ms: number | undefined, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(new ProviderError('aborted', '请求已取消'));
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError('aborted', '请求已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
