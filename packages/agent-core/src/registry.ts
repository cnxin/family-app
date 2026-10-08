// 工具注册表：每个工具 = 名字 + 描述 + zod 参数 + execute(ctx, args)。
// 读工具（read）返回数据；提案工具（propose）只能返回 ctx.receipt(proposalId) 开出的回执——
// 类型上 execute 的返回值必须是 ProposalReceipt（普通对象过不了编译），
// 运行时再认一遍回执（不是 ctx 开出的就报 invalid_proposal），交给模型的只有 { proposalId }。
import { z } from 'zod';
import type { JsonSchema, ModelToolDefinition } from './types';

export type ToolKind = 'read' | 'propose';

/** 工具参数一律是对象。 */
export type ToolSchema = z.ZodObject;

declare const receiptBrand: unique symbol;

/** 提案回执：只能由 ProposeToolContext.receipt() 开出。 */
export interface ProposalReceipt {
  readonly proposalId: string;
  readonly [receiptBrand]: true;
}

const receipts = new WeakSet<object>();

interface ToolContextBase {
  readonly toolName: string;
  /** 循环取消或超时时 abort；长耗时的工具应当把它传下去。 */
  readonly signal?: AbortSignal;
}

/** 读工具的 ctx：调用方的应用上下文（普通对象）+ 本次调用信息。 */
export type ReadToolContext<C extends object = object> = C &
  ToolContextBase & { readonly toolKind: 'read' };

/** 提案工具的 ctx：多一个开回执的方法，execute 必须以它的返回值结束。 */
export type ProposeToolContext<C extends object = object> = C &
  ToolContextBase & {
    readonly toolKind: 'propose';
    receipt(proposalId: string): ProposalReceipt;
  };

interface ToolDefinitionBase<S extends ToolSchema> {
  /** 交给模型的名字，须符合 ^[a-zA-Z0-9_-]{1,64}$。 */
  readonly name: string;
  /** 交给模型的描述：只写用途与规则，不得含任何家庭数据。 */
  readonly description: string;
  readonly schema: S;
  /** 旧名：按旧名调用也能找到这个工具（黑盒脚本与渠道配置依赖旧名）。 */
  readonly aliases?: readonly string[];
}

export interface ReadToolDefinition<C extends object, S extends ToolSchema>
  extends ToolDefinitionBase<S> {
  readonly kind: 'read';
  execute(ctx: ReadToolContext<C>, args: z.output<S>): unknown;
}

export interface ProposeToolDefinition<C extends object, S extends ToolSchema>
  extends ToolDefinitionBase<S> {
  readonly kind: 'propose';
  execute(ctx: ProposeToolContext<C>, args: z.output<S>): ProposalReceipt | Promise<ProposalReceipt>;
}

export type ToolDefinition<C extends object, S extends ToolSchema = ToolSchema> =
  | ReadToolDefinition<C, S>
  | ProposeToolDefinition<C, S>;

export interface RegisteredTool<C extends object = object> {
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly schema: ToolSchema;
  readonly aliases: readonly string[];
  /** 参数的 JSON Schema（见 toJsonSchema）。 */
  readonly parameters: JsonSchema;
  readonly definition: ToolDefinition<C>;
}

export type ToolErrorCode =
  | 'unknown_tool'
  | 'tool_not_allowed'
  | 'invalid_arguments'
  | 'tool_failed'
  | 'invalid_proposal';

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
}

export type ToolOutcome =
  | { readonly ok: true; readonly kind: 'read'; readonly result: unknown }
  | { readonly ok: true; readonly kind: 'propose'; readonly result: { readonly proposalId: string } }
  | { readonly ok: false; readonly error: ToolError };

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const MESSAGE_LIMIT = 500;

export class ToolRegistry<C extends object = object> {
  private readonly tools: RegisteredTool<C>[] = [];
  private readonly byName = new Map<string, RegisteredTool<C>>();

  register<S extends ToolSchema>(definition: ToolDefinition<C, S>): this {
    const aliases = [...(definition.aliases ?? [])];
    for (const name of [definition.name, ...aliases]) {
      if (!TOOL_NAME.test(name)) throw new Error(`工具名不合法：${name}`);
      if (this.byName.has(name)) throw new Error(`工具名重复：${name}`);
    }
    if (new Set(aliases).size !== aliases.length || aliases.includes(definition.name)) {
      throw new Error(`工具名重复：${definition.name} 的别名有重复`);
    }
    const tool: RegisteredTool<C> = {
      name: definition.name,
      description: definition.description,
      kind: definition.kind,
      schema: definition.schema,
      aliases,
      parameters: toJsonSchema(definition.schema),
      definition: definition as unknown as ToolDefinition<C>,
    };
    this.tools.push(tool);
    for (const name of [definition.name, ...aliases]) this.byName.set(name, tool);
    return this;
  }

  /** 按名字或旧名取工具。 */
  get(name: string): RegisteredTool<C> | undefined {
    return this.byName.get(name);
  }

  /** 名字或旧名 → 正式名；不认识返回 undefined。 */
  resolve(name: string): string | undefined {
    return this.byName.get(name)?.name;
  }

  /** 按注册顺序。 */
  list(): readonly RegisteredTool<C>[] {
    return this.tools;
  }

  names(): string[] {
    return this.tools.map((tool) => tool.name);
  }

  /** 交给模型的工具定义；allowed 给了就只出允许的（名字或旧名都认），顺序仍按注册顺序。 */
  toModelTools(allowed?: Iterable<string>): ModelToolDefinition[] {
    const allow = allowed === undefined ? undefined : this.canonicalSet(allowed);
    return this.tools
      .filter((tool) => !allow || allow.has(tool.name))
      .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  }

  /** allowed 名单（名字或旧名）→ 正式名集合；不认识的名字忽略。 */
  canonicalSet(names: Iterable<string>): Set<string> {
    const set = new Set<string>();
    for (const name of names) {
      const resolved = this.resolve(name);
      if (resolved) set.add(resolved);
    }
    return set;
  }

  /**
   * 校验参数并执行，出错直接抛 ToolInvocationError / 工具自己的异常（适配层用：MCP 要把服务端异常原样交给 SDK）。
   * rawArgs 是模型给的 JSON 字符串（空串当 {}）或已解析的对象；读工具返回结果，提案工具返回 { proposalId }。
   */
  async invoke(
    name: string,
    context: C,
    rawArgs: unknown,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ kind: 'read'; result: unknown } | { kind: 'propose'; result: { proposalId: string } }> {
    const tool = this.get(name);
    if (!tool) throw new ToolInvocationError('unknown_tool', `没有叫 ${name} 的工具`);

    let args: unknown = rawArgs;
    if (typeof rawArgs === 'string') {
      try {
        args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      } catch {
        throw new ToolInvocationError('invalid_arguments', '参数不是合法的 JSON');
      }
    }
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) throw new ToolInvocationError('invalid_arguments', describeIssues(parsed.error));

    const base = { ...context, toolName: tool.name, signal: options.signal };
    const definition = tool.definition;
    if (definition.kind === 'read') {
      const result: unknown = await definition.execute(
        { ...base, toolKind: 'read' } as ReadToolContext<C>,
        parsed.data,
      );
      return { kind: 'read', result };
    }
    const receipt: unknown = await definition.execute(
      { ...base, toolKind: 'propose', receipt: issueReceipt } as ProposeToolContext<C>,
      parsed.data,
    );
    if (!isProposalReceipt(receipt)) {
      throw new ToolInvocationError('invalid_proposal', `${tool.name} 是提案工具，只能返回提案回执`);
    }
    return { kind: 'propose', result: { proposalId: receipt.proposalId } };
  }

  /**
   * 同 invoke，但不抛：参数不合法、工具抛错、提案没走回执，都返回 ok=false 的结果——循环把它原样交回模型。
   */
  async execute(
    name: string,
    context: C,
    rawArgs: unknown,
    options: { signal?: AbortSignal } = {},
  ): Promise<ToolOutcome> {
    try {
      return { ok: true, ...(await this.invoke(name, context, rawArgs, options)) };
    } catch (error) {
      if (error instanceof ToolInvocationError) return failure(error.code, error.message);
      return failure('tool_failed', error instanceof Error ? error.message : String(error));
    }
  }
}

/** invoke 自己判出的错误（工具执行时抛的异常原样向上抛，不包成它）。 */
export class ToolInvocationError extends Error {
  constructor(
    readonly code: Exclude<ToolErrorCode, 'tool_not_allowed' | 'tool_failed'>,
    message: string,
  ) {
    super(message);
    this.name = 'ToolInvocationError';
  }
}

export function isProposalReceipt(value: unknown): value is ProposalReceipt {
  return typeof value === 'object' && value !== null && receipts.has(value);
}

function issueReceipt(proposalId: string): ProposalReceipt {
  if (typeof proposalId !== 'string' || !proposalId) throw new Error('提案回执缺 proposalId');
  const receipt = Object.freeze({ proposalId }) as ProposalReceipt;
  receipts.add(receipt);
  return receipt;
}

/** zod → 交给模型的 JSON Schema：与 MCP SDK 的转换同口径（draft-7、输入侧），去掉 $schema。 */
export function toJsonSchema(schema: ToolSchema): JsonSchema {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as JsonSchema;
  return rest;
}

function describeIssues(error: z.ZodError): string {
  const text = error.issues
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '参数'}：${issue.message}`)
    .join('；');
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT)}…` : text;
}

function failure(code: ToolErrorCode, message: string): ToolOutcome {
  return {
    ok: false,
    error: { code, message: message.length > MESSAGE_LIMIT ? `${message.slice(0, MESSAGE_LIMIT)}…` : message },
  };
}
