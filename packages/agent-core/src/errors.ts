// provider 层的错误。调用方（runLoop）按 code 归类成 AgentEvent 的 error，不重试。

export type ProviderErrorCode =
  /** 服务商返回非 2xx；status 与 body（服务商原文，截断）一并带出。 */
  | 'http'
  /** 网络层失败（DNS、连接被拒、TLS……）。 */
  | 'network'
  /** 调用方 abort 了 signal（含超时）。 */
  | 'aborted'
  /** 流式响应格式不对，或服务商在流里报错。 */
  | 'bad_stream'
  /** 该服务商不支持图片输入，但请求带了 images。 */
  | 'images_unsupported'
  /** 回放时找不到对应的录制。 */
  | 'replay_mismatch';

const BODY_LIMIT = 2_000;

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly body?: string;
  readonly cause?: unknown;

  constructor(
    code: ProviderErrorCode,
    message: string,
    details: { status?: number; body?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    if (details.status !== undefined) this.status = details.status;
    if (details.cause !== undefined) this.cause = details.cause;
    if (details.body !== undefined) {
      this.body =
        details.body.length > BODY_LIMIT ? `${details.body.slice(0, BODY_LIMIT)}…` : details.body;
    }
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof ProviderError) return error.code === 'aborted';
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    ((error as { name: unknown }).name === 'AbortError' ||
      (error as { name: unknown }).name === 'TimeoutError')
  );
}
