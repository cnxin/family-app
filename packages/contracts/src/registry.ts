import type { ZodType } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * 一个端点的契约。`path` 使用 Express 路由模板（如 `/tasks/:id`），
 * 与 `docs/api-inventory.md` 里的路径一致，也是 API 在测试模式下匹配响应校验的键。
 */
export interface EndpointContract<
  TParams extends ZodType = ZodType,
  TQuery extends ZodType = ZodType,
  TBody extends ZodType = ZodType,
  TResponse extends ZodType = ZodType,
> {
  method: HttpMethod;
  path: string;
  summary: string;
  params?: TParams;
  query?: TQuery;
  body?: TBody;
  response: TResponse;
}

export function defineEndpoint<
  TParams extends ZodType,
  TQuery extends ZodType,
  TBody extends ZodType,
  TResponse extends ZodType,
>(
  contract: EndpointContract<TParams, TQuery, TBody, TResponse>,
): EndpointContract<TParams, TQuery, TBody, TResponse> {
  return contract;
}

export function contractKey(method: string, path: string) {
  return `${method.toUpperCase()} ${path}`;
}

/** 把若干域的契约合并成 `METHOD /path` → 契约 的查找表。 */
export function buildContractIndex(
  groups: Record<string, Record<string, EndpointContract>>[],
) {
  const index = new Map<string, EndpointContract>();
  for (const group of groups) {
    for (const domain of Object.values(group)) {
      for (const contract of Object.values(domain)) {
        const key = contractKey(contract.method, contract.path);
        if (index.has(key)) {
          throw new Error(`契约重复定义：${key}`);
        }
        index.set(key, contract);
      }
    }
  }
  return index;
}
