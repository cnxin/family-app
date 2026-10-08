// agent 工具名单由 manifest 推导（J4.1，docs/j4-agent-plan.md §3）：
//   - 每个插件查询（queries）生成一个读工具，工具名缺省 `get_<插件>_<动词>`（查询 id 里的 - 换成 _）；
//   - 每个写提案（actions[].propose，或没有动作的 manifest.proposals）生成一个提案工具，缺省 `propose_<actionType>`；
//   - 内核工具在 core-assistant.ts，按 kind 归进读 / 提案 / 记忆三份名单。
// 现有 30 个工具名全部保留：和规则不同的在 manifest 里写 toolName；以后改名把旧名放进 toolAliases。
// 字面量联合类型（AgentReadToolName 等）在类型层面按同一规则从 manifests.ts 的元组推出，apps/api 拿它做精确类型。
import { CORE_ASSISTANT_TOOLS, KERNEL_AGENT_TOOLS, type CoreAssistantToolKind, type KernelAgentTool } from './core-assistant';
import { PLUGIN_MANIFESTS } from './manifests';
import type { PluginManifest, PluginProposal, PluginQuery } from './types';

/** 插件的全部写提案：挂在动作上的，加上还没有动作的（manifest.proposals）。 */
export function proposalsOf(plugin: PluginManifest): readonly PluginProposal[] {
  return [
    ...(plugin.actions ?? []).flatMap((action) => (action.propose ? [action.propose] : [])),
    ...(plugin.proposals ?? []),
  ];
}

const snake = (value: string) => value.replace(/-/g, '_');

/** 读工具名的缺省规则：查询 id `<插件>.<动词>` → `get_<插件>_<动词>`。 */
export function defaultQueryToolName(queryId: string): string {
  const dot = queryId.indexOf('.');
  return `get_${snake(queryId.slice(0, dot))}_${snake(queryId.slice(dot + 1))}`;
}

/** 提案工具名的缺省规则：`propose_<actionType>`。 */
export function defaultProposalToolName(actionType: string): string {
  return `propose_${actionType}`;
}

export function queryToolName(query: PluginQuery): string {
  return query.toolName ?? defaultQueryToolName(query.id);
}

export function proposalToolName(proposal: PluginProposal): string {
  return proposal.toolName ?? defaultProposalToolName(proposal.actionType);
}

const manifests: readonly PluginManifest[] = PLUGIN_MANIFESTS;

export interface PluginReadTool {
  name: string;
  plugin: string;
  aliases: readonly string[];
  queryId: string;
}

export interface PluginProposalTool {
  name: string;
  plugin: string;
  aliases: readonly string[];
  actionType: string;
  label: string;
  /** 能否放进 propose_plan 的一组（manifest 的 grouped 缺省为能）。 */
  grouped: boolean;
}

/** 插件查询生成的读工具，按 manifests.ts 的插件顺序、各插件 queries 的顺序。 */
export function pluginReadTools(): readonly PluginReadTool[] {
  return manifests.flatMap((plugin) =>
    (plugin.queries ?? []).map((query) => ({
      name: queryToolName(query),
      plugin: plugin.key,
      aliases: query.toolAliases ?? [],
      queryId: query.id,
    })),
  );
}

/** 插件写提案生成的提案工具。 */
export function pluginProposalTools(): readonly PluginProposalTool[] {
  return manifests.flatMap((plugin) =>
    proposalsOf(plugin).map((proposal) => ({
      name: proposalToolName(proposal),
      plugin: plugin.key,
      aliases: proposal.toolAliases ?? [],
      actionType: proposal.actionType,
      label: proposal.label,
      grouped: proposal.grouped ?? true,
    })),
  );
}

// ---- 类型层面的同一套推导 --------------------------------------------------------------------------

type Snake<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Head}_${Snake<Tail>}` : S;
type Manifest = (typeof PLUGIN_MANIFESTS)[number];
type QueryOf<M> = M extends { readonly queries: readonly (infer Q)[] } ? Q : never;
type ProposalOf<M> =
  | (M extends { readonly actions: readonly (infer A)[] } ? (A extends { readonly propose: infer P } ? P : never) : never)
  | (M extends { readonly proposals: readonly (infer P)[] } ? P : never);
type QueryToolName<Q> = Q extends { readonly toolName: infer N extends string }
  ? N
  : Q extends { readonly id: `${infer P}.${infer V}` }
    ? `get_${Snake<P>}_${Snake<V>}`
    : never;
type ProposalToolName<P> = P extends { readonly toolName: infer N extends string }
  ? N
  : P extends { readonly actionType: infer T extends string }
    ? `propose_${T}`
    : never;
type KernelToolOf<K extends CoreAssistantToolKind> = {
  [N in KernelAgentTool]: (typeof CORE_ASSISTANT_TOOLS)[N]['kind'] extends K ? N : never;
}[KernelAgentTool];

export type AgentReadToolName = KernelToolOf<'read'> | QueryToolName<QueryOf<Manifest>>;
export type AgentProposalToolName = KernelToolOf<'propose'> | ProposalToolName<ProposalOf<Manifest>>;
export type AgentMemoryToolName = KernelToolOf<'preference'>;
export type AgentToolName = AgentReadToolName | AgentProposalToolName | AgentMemoryToolName;

const kernelTools = <K extends CoreAssistantToolKind>(kind: K) =>
  KERNEL_AGENT_TOOLS.filter((tool) => CORE_ASSISTANT_TOOLS[tool].kind === kind) as KernelToolOf<K>[];

/** 读工具：内核的在前，插件查询生成的在后。 */
export const AGENT_READ_TOOLS: readonly AgentReadToolName[] = [
  ...kernelTools('read'),
  ...(pluginReadTools().map((tool) => tool.name) as AgentReadToolName[]),
];
/** 提案工具：插件写提案生成的在前，内核的 propose_plan 在后。 */
export const AGENT_PROPOSAL_TOOLS: readonly AgentProposalToolName[] = [
  ...(pluginProposalTools().map((tool) => tool.name) as AgentProposalToolName[]),
  ...kernelTools('propose'),
];
/** 记忆工具：个人偏好的回顾与候选（内核）。 */
export const AGENT_MEMORY_TOOLS: readonly AgentMemoryToolName[] = kernelTools('preference');

/** 工具名 → 旧名（manifest 的 toolAliases；目前没有改过名，全部为空）。 */
export function agentToolAliases(): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    [...pluginReadTools(), ...pluginProposalTools()]
      .filter((tool) => tool.aliases.length)
      .map((tool) => [tool.name, tool.aliases]),
  );
}
