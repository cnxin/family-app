// OpenAI 兼容 chat/completions 的 ModelProvider：POST {baseUrl}/chat/completions，stream=true，
// 自己解析 SSE、按 index 拼 tool_calls 分片、归一 finish_reason。
// 各家「兼容」实现的已知差异集中在 providerQuirks，不在解析代码里散落 if。
import { ProviderError, isAbortError } from './errors';
import type {
  FinishReason,
  ModelEvent,
  ModelImage,
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelToolCall,
  ModelToolChoice,
} from './types';

export interface ProviderQuirks {
  readonly label: string;
  /** 预填的 baseUrl 与推荐模型（J4.3 设置页的下拉用）。 */
  readonly defaultBaseUrl?: string;
  readonly recommendedModel?: string;
  /** 是否接受 user 消息里的 image_url 块；不接受时带图直接报 images_unsupported，不发请求。 */
  readonly images: boolean;
  /** 是否支持 tool_choice: 'required'；不支持时降级成 'auto'。 */
  readonly toolChoiceRequired: boolean;
  /** 是否发 stream_options.include_usage（流式时要 token 用量）。 */
  readonly streamUsage: boolean;
  /** max_tokens 的上限；请求超过时按上限发。 */
  readonly maxTokensCap?: number;
  /** 原样并进请求体的额外字段。 */
  readonly extraBody?: Readonly<Record<string, unknown>>;
  /** 已知差异的文字说明（给人看，解析代码已经兼容）。 */
  readonly notes: readonly string[];
}

/**
 * 已知差异表。DeepSeek 与通义千问两条据两家公开文档整理，
 * J4.0 的回放用例目前是手写的模拟录制，拿到 King 的测试 key 后用真实录制核对并更新。
 */
export const providerQuirks = {
  generic: {
    label: 'OpenAI 兼容（自定义）',
    images: true,
    toolChoiceRequired: true,
    streamUsage: true,
    notes: ['按 OpenAI chat/completions 的流式格式处理；服务商不认 stream_options 时会返回 400，届时在这里加一条。'],
  },
  deepseek: {
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    recommendedModel: 'deepseek-chat',
    images: false,
    toolChoiceRequired: true,
    streamUsage: true,
    maxTokensCap: 8_192,
    notes: [
      '只收文本：消息里带 image_url 块会被拒，所以带图直接报 images_unsupported，不发请求。',
      '流式 tool_calls 每片都带 index；首片带 id、name，后续片只有 arguments 增量。',
      'finish_reason 多一个 insufficient_system_resource（服务端资源不足中断），归为 other。',
      'deepseek-reasoner 的思考过程在 delta.reasoning_content，不当正文输出，也不回传。',
      'deepseek-chat 单次输出上限 8K token，max_tokens 超过按 8192 发。',
    ],
  },
  qwen: {
    label: '通义千问（百炼）',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    recommendedModel: 'qwen-plus',
    images: true,
    toolChoiceRequired: false,
    streamUsage: true,
    notes: [
      '流式 tool_calls 的后续分片 id 是空字符串、function.name 可能为 null：只在非空时采用，不覆盖首片的值。',
      '开 include_usage 时 usage 在最后单独一片，choices 是空数组。',
      'tool_choice 只认 auto / none / 指定函数，不认 required，降级成 auto。',
      '图片只有 qwen-vl 系列认，纯文本模型带图会返回 400（原文随 ProviderError 带出）。',
      'Qwen3 开源模型默认开思考，思考内容在 delta.reasoning_content，不当正文输出。',
    ],
  },
} as const satisfies Record<string, ProviderQuirks>;

export type ProviderQuirksKey = keyof typeof providerQuirks;

export function quirksFor(key: string | undefined): ProviderQuirks {
  return key && key in providerQuirks
    ? providerQuirks[key as ProviderQuirksKey]
    : providerQuirks.generic;
}

export interface OpenAICompatibleOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /** providerQuirks 的 key 或一张自定义差异表；缺省按 generic。 */
  readonly quirks?: ProviderQuirksKey | ProviderQuirks;
  /** 替换全局 fetch（回放、录制用）。 */
  readonly fetch?: typeof fetch;
}

export class OpenAICompatibleProvider implements ModelProvider {
  private readonly quirks: ProviderQuirks;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.quirks =
      typeof options.quirks === 'object' ? options.quirks : quirksFor(options.quirks);
  }

  /** 实际发出的请求体（不含 key）；回放与录制也靠它比对。 */
  buildBody(request: ModelRequest): Record<string, unknown> {
    const quirks = this.quirks;
    if (!quirks.images && request.messages.some((m) => m.role === 'user' && m.images?.length)) {
      throw new ProviderError('images_unsupported', `${quirks.label} 不支持图片输入`);
    }
    const body: Record<string, unknown> = {
      model: this.options.model,
      messages: request.messages.map(encodeMessage),
      stream: true,
    };
    if (quirks.streamUsage) body.stream_options = { include_usage: true };
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
      if (request.toolChoice) body.tool_choice = encodeToolChoice(request.toolChoice, quirks);
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens =
        quirks.maxTokensCap !== undefined
          ? Math.min(request.maxTokens, quirks.maxTokensCap)
          : request.maxTokens;
    }
    return quirks.extraBody ? { ...body, ...quirks.extraBody } : body;
  }

  async *chat(request: ModelRequest): AsyncGenerator<ModelEvent> {
    const { signal } = request;
    const body = this.buildBody(request);
    if (signal?.aborted) throw aborted(signal);
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const doFetch = this.options.fetch ?? fetch;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${this.options.apiKey}`,
          ...this.options.extraHeaders,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw aborted(signal, error);
      throw new ProviderError('network', `连不上模型服务：${messageOf(error)}`, { cause: error });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError('http', `模型服务返回 ${response.status}`, {
        status: response.status,
        body: this.hideKey(text),
      });
    }
    if (!response.body) throw new ProviderError('bad_stream', '模型服务没有返回响应体');

    const assembler = new ChunkAssembler();
    try {
      for await (const data of readSse(response.body)) {
        if (signal?.aborted) throw aborted(signal);
        if (data === '[DONE]') break;
        for (const chunk of parseChunks(data)) yield* assembler.push(chunk, this.hideKey.bind(this));
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (signal?.aborted || isAbortError(error)) throw aborted(signal, error);
      throw new ProviderError('bad_stream', `读取模型流失败：${messageOf(error)}`, { cause: error });
    }
    yield* assembler.finish();
  }

  private hideKey(text: string): string {
    const key = this.options.apiKey;
    return key ? text.split(key).join('***') : text;
  }
}

function encodeMessage(message: ModelMessage): Record<string, unknown> {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };
    case 'user':
      if (!message.images?.length) return { role: 'user', content: message.content };
      return {
        role: 'user',
        content: [
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...message.images.map((image) => ({ type: 'image_url', image_url: { url: imageUrl(image) } })),
        ],
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content ?? '',
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
}

function imageUrl(image: ModelImage): string {
  return 'base64' in image ? `data:${image.mime};base64,${image.base64}` : image.url;
}

function encodeToolChoice(choice: ModelToolChoice, quirks: ProviderQuirks): unknown {
  if (typeof choice === 'object') return { type: 'function', function: { name: choice.name } };
  if (choice === 'required' && !quirks.toolChoiceRequired) return 'auto';
  return choice;
}

/** 按 SSE 规范切事件，返回每个事件的 data（多行 data 用 \n 连接）；注释行与其它字段忽略。 */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const takeLine = function* (line: string): Generator<string> {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '') {
      if (data.length) yield data.join('\n');
      data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        yield* takeLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer) yield* takeLine(buffer);
    if (data.length) yield data.join('\n');
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** 一个 data 通常是一个 JSON；个别实现不空行分隔、多行 data 连在一起时逐行再试一次。 */
function parseChunks(data: string): unknown[] {
  try {
    return [JSON.parse(data)];
  } catch (error) {
    const lines = data.split('\n').filter(Boolean);
    if (lines.length > 1) {
      try {
        return lines.map((line) => JSON.parse(line) as unknown);
      } catch {
        // 落到下面统一报错
      }
    }
    throw new ProviderError('bad_stream', `模型流里有一段不是 JSON：${data.slice(0, 200)}`, {
      cause: error,
    });
  }
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** 把一片片 chunk 拼成 ModelEvent：正文增量直接发；tool_calls 按 index 拼完整后在流结束时一次发出。 */
class ChunkAssembler {
  private readonly calls = new Map<number, PendingToolCall>();
  private lastIndex: number | undefined;
  private rawFinish: string | undefined;
  private usage: { inputTokens: number; outputTokens: number } | undefined;

  *push(chunk: unknown, hideKey: (text: string) => string): Generator<ModelEvent> {
    if (!isRecord(chunk)) return;
    if (isRecord(chunk.error)) {
      const message = typeof chunk.error.message === 'string' ? chunk.error.message : '未知错误';
      throw new ProviderError('bad_stream', `模型服务在流里报错：${message}`, {
        body: hideKey(JSON.stringify(chunk.error)),
      });
    }
    if (isRecord(chunk.usage)) {
      this.usage = {
        inputTokens: numberOr0(chunk.usage.prompt_tokens),
        outputTokens: numberOr0(chunk.usage.completion_tokens),
      };
    }
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (!isRecord(choice)) return;
    const delta = isRecord(choice.delta) ? choice.delta : {};
    if (typeof delta.content === 'string' && delta.content) {
      yield { type: 'text_delta', text: delta.content };
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) if (isRecord(part)) this.mergeToolCall(part);
    }
    if (isRecord(delta.function_call)) this.mergeToolCall({ index: 0, function: delta.function_call });
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      this.rawFinish = choice.finish_reason;
    }
  }

  *finish(): Generator<ModelEvent> {
    if (this.rawFinish === undefined) {
      throw new ProviderError('bad_stream', '模型流在给出 finish_reason 之前就断了');
    }
    const indexes = [...this.calls.keys()].sort((a, b) => a - b);
    for (const index of indexes) {
      const pending = this.calls.get(index)!;
      if (!pending.name) throw new ProviderError('bad_stream', `第 ${index} 个工具调用没有名字`);
      const call: ModelToolCall = {
        id: pending.id || `call_${index}`,
        name: pending.name,
        arguments: pending.arguments,
      };
      yield { type: 'tool_call', call };
    }
    if (this.usage) yield { type: 'usage', ...this.usage };
    yield {
      type: 'done',
      finishReason: mapFinishReason(this.rawFinish, indexes.length > 0),
      rawFinishReason: this.rawFinish,
    };
  }

  private mergeToolCall(part: Record<string, unknown>): void {
    const id = typeof part.id === 'string' ? part.id : '';
    let index: number;
    if (typeof part.index === 'number') index = part.index;
    else if (id && ![...this.calls.values()].some((call) => call.id === id)) index = this.calls.size;
    else index = this.lastIndex ?? 0;
    this.lastIndex = index;
    let pending = this.calls.get(index);
    if (!pending) {
      pending = { id: '', name: '', arguments: '' };
      this.calls.set(index, pending);
    }
    if (id && !pending.id) pending.id = id;
    const fn = isRecord(part.function) ? part.function : {};
    if (typeof fn.name === 'string' && fn.name && !pending.name) pending.name = fn.name;
    if (typeof fn.arguments === 'string') pending.arguments += fn.arguments;
  }
}

function mapFinishReason(raw: string, hasToolCalls: boolean): FinishReason {
  switch (raw) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'stop':
      // 个别实现带了工具调用却报 stop
      return hasToolCalls ? 'tool_calls' : 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
    case 'sensitive':
      return 'content_filter';
    default:
      return 'other';
  }
}

function aborted(signal: AbortSignal | undefined, cause?: unknown): ProviderError {
  return new ProviderError('aborted', '请求已取消', { cause: cause ?? signal?.reason });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message}（${cause.message}）` : error.message;
  }
  return String(error);
}
