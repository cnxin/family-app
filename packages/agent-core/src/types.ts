// 模型层的公共类型：与具体服务商无关。
// 消息、工具定义与事件都按 OpenAI 兼容 chat/completions 的语义建模，
// OpenAICompatibleProvider 负责把它们编码成线上格式、把流式响应解析回事件。

/** 一张图片：要么是可访问的 URL，要么是 base64 数据（编码成 data: URL 发出）。 */
export type ModelImage =
  | { readonly url: string; readonly mime?: string }
  | { readonly base64: string; readonly mime: string };

/** 模型发起的一次工具调用。arguments 是模型原样给出的 JSON 字符串，由调用方解析校验。 */
export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export type ModelMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string; readonly images?: readonly ModelImage[] }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly toolCalls?: readonly ModelToolCall[];
    }
  | { readonly role: 'tool'; readonly toolCallId: string; readonly content: string };

/** JSON Schema 对象（由 zod 生成）。 */
export type JsonSchema = Record<string, unknown>;

/** 交给模型的工具定义：只有名字、描述与参数 JSON Schema，不含任何家庭数据。 */
export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}

export type ModelToolChoice = 'auto' | 'none' | 'required' | { readonly name: string };

export interface ModelRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly toolChoice?: ModelToolChoice;
  readonly maxTokens?: number;
  /** 取消与超时都走它：abort 后 provider 立刻停止读取并抛 ProviderError（code=aborted）。 */
  readonly signal?: AbortSignal;
}

/**
 * 一次请求的结束原因（各家原始值归一后的结果）：
 * stop 正常结束；tool_calls 要求调用工具；length 输出被 max_tokens 截断；
 * content_filter 被服务商的内容审核拦下；other 其余（原始值见 rawFinishReason）。
 */
export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'other';

export type ModelEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  /** 完整的一次工具调用：流式分片在 provider 内部拼好后才发出。 */
  | { readonly type: 'tool_call'; readonly call: ModelToolCall }
  | { readonly type: 'usage'; readonly inputTokens: number; readonly outputTokens: number }
  | {
      readonly type: 'done';
      readonly finishReason: FinishReason;
      readonly rawFinishReason: string | null;
    };

/** 模型接口：一次请求 → 一串事件，最后一个总是 done（出错则抛 ProviderError）。 */
export interface ModelProvider {
  chat(request: ModelRequest): AsyncIterable<ModelEvent>;
}
