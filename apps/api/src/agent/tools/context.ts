// 小管家工具的公共部分（J4.1）：每次调用的上下文、工具依赖、参数归一的小函数。
// 工具实现只经内核的门面读写插件数据（PluginFacadeRegistry），本目录不 import 任何插件目录（check-plugins 盯着）。
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ToolDefinition, ToolSchema } from '@family/agent-core';
import type { Repository } from 'typeorm';
import type { JwtUser } from '../../auth/jwt.guard';
import type { AgentMemberProfile, AgentRun, AgentToolEvent, Member } from '../../entities';
import type { PluginFacadeRegistry } from '../../system/plugin-facades.registry';
import type { AgentMemoryService } from '../agent-memory.service';
import type { AgentProposalGroupsService } from '../agent-proposal-groups.service';
import type { AgentProposalsService } from '../agent-proposals.service';

/** 每次工具调用的应用上下文。 */
export interface AgentToolContext {
  readonly user: JwtUser;
  readonly run: AgentRun;
  /**
   * 提案工具把完整的提案（或提案组）交给调用方：MCP 与内置运行时原样回给 Hermes，行为与 J4.1 之前一致；
   * 自研循环（J4.2）不传，模型只拿到 proposalId。
   */
  readonly onProposal?: (presented: unknown) => void;
}

/** 工具实现用到的依赖：插件数据只经门面，其余是 agent 自己的表与服务。 */
export interface AgentToolDeps {
  readonly facades: PluginFacadeRegistry;
  readonly members: Repository<Member>;
  readonly memberProfiles: Repository<AgentMemberProfile>;
  readonly toolEvents: Repository<AgentToolEvent>;
  readonly proposals: AgentProposalsService;
  readonly proposalGroups: AgentProposalGroupsService;
  readonly agentMemory: AgentMemoryService;
}

export type AgentToolDefinition = ToolDefinition<AgentToolContext>;

/** 按 schema 推出 args 的类型，再放宽成注册表里统一的定义类型。 */
export function defineTool<S extends ToolSchema>(definition: ToolDefinition<AgentToolContext, S>): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition;
}

export const MAX_RESULT_ITEMS = 20;
export const MAX_EXTENDED_RESULT_ITEMS = 50;

export function dateOnly(value: unknown, fallback: string) {
  const normalized = typeof value === 'string' ? value : fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestException('日期必须使用 YYYY-MM-DD 格式');
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new BadRequestException('日期不是有效的日历日期');
  }
  return normalized;
}

export function limited(value: unknown, fallback = 10) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_RESULT_ITEMS);
}

export function boundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  label: string,
) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new BadRequestException(`${label}必须是 1 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

export function normalizedTerms(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLocaleLowerCase('zh-CN'))
    .filter(Boolean)
    .slice(0, maximum);
}

export async function requireHouseholdMember(
  deps: AgentToolDeps,
  memberId: string,
  user: JwtUser,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      memberId,
    )
  ) {
    throw new BadRequestException('成员 ID 格式无效');
  }
  const member = await deps.members.findOneBy({
    id: memberId,
    householdId: user.householdId,
  });
  if (!member || member.disabledAt) {
    throw new NotFoundException('家庭成员不存在');
  }
  return member;
}
