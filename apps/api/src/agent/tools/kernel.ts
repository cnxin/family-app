// 内核工具（不属于任何插件，清单在 contracts/plugins/core-assistant.ts）：今日摘要、家庭日程、成员档案、天气、
// 个人记忆两件、propose_plan。
import { BadRequestException } from '@nestjs/common';
import { pluginProposals } from '@family/contracts';
import { addDays, todayInShanghai } from '@family/shared';
import { z } from 'zod';
import { openweatherApiKey, openweatherBaseUrl } from '../../common/config';
import { AGENT_MEMORY_KEYS, type AgentMemoryKey } from '../agent.types';
import {
  boundedInteger,
  dateOnly,
  defineTool,
  limited,
  MAX_EXTENDED_RESULT_ITEMS,
  MAX_RESULT_ITEMS,
  requireHouseholdMember,
  type AgentToolDefinition,
  type AgentToolDeps,
} from './context';
import { inventoryAlerts } from './inventory';

export const getTodaySummaryTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_today_summary',
    description: '读取当前家庭的今日事项摘要',
    kind: 'read',
    schema: z.object({}),
    async execute({ user }) {
      const date = todayInShanghai();
      const [entries, alerts] = await Promise.all([
        deps.facades.get('calendar').listEntries(date, date, user),
        inventoryAlerts(deps, user.householdId, 8),
      ]);
      return {
        date,
        entries: entries.slice(0, MAX_RESULT_ITEMS).map((entry) => ({
          module: entry.module,
          date: entry.date,
          title: entry.title,
          status: entry.status,
          summary: entry.summary ? String(entry.summary).slice(0, 200) : null,
          targetPath: entry.targetPath,
        })),
        inventoryAlerts: alerts,
      };
    },
  });

export const getFamilyScheduleTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_family_schedule',
    description: '查询未来最多 30 天的家庭日程',
    kind: 'read',
    schema: z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      days: z.number().int().min(1).max(30).optional(),
    }),
    async execute({ user }, input) {
      const startDate = dateOnly(input.startDate, todayInShanghai());
      const days = boundedInteger(input.days, 7, 30, '查询天数');
      const endDate = addDays(startDate, days - 1);
      const entries = await deps.facades.get('calendar').listEntries(startDate, endDate, user);
      return {
        events: entries.slice(0, MAX_EXTENDED_RESULT_ITEMS).map((entry) => {
          const metadata = entry.metadata as Record<string, unknown>;
          const participants = [
            metadata.createdByName,
            metadata.assigneeName,
            metadata.hostMemberName,
          ].filter(
            (value): value is string =>
              typeof value === 'string' && Boolean(value),
          );
          return {
            id: entry.id,
            title: entry.title,
            eventDate: entry.date,
            date: entry.date,
            eventType: entry.module,
            participants: [...new Set(participants)],
            status: entry.status,
            summary: entry.summary ? String(entry.summary).slice(0, 200) : null,
            targetPath: entry.targetPath,
            untrustedContent: true,
          };
        }),
        total: entries.length,
      };
    },
  });

export const getMemberProfileTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_member_profile',
    description: '查询同一家庭成员的非敏感档案',
    kind: 'read',
    schema: z.object({
      memberId: z.string().uuid().optional(),
    }),
    async execute({ user }, input) {
      const memberId =
        typeof input.memberId === 'string' ? input.memberId : user.memberId;
      const member = await requireHouseholdMember(deps, memberId, user);
      const profile = await deps.memberProfiles.findOneBy({
        householdId: user.householdId,
        memberId: member.id,
      });
      return {
        id: member.id,
        name: member.name,
        role: member.role,
        avatar: member.avatarEmoji,
        prefersCooking: member.prefersCooking,
        assistantName: profile?.assistantName ?? null,
        memoryEnabled: profile?.memoryEnabled ?? null,
        responseStyle: profile?.responseStyle ?? null,
        untrustedContent: true,
      };
    },
  });

export const getWeatherTool = () =>
  defineTool({
    name: 'get_weather',
    description: '这是实时天气的唯一数据来源。回答任何城市的温度、降水或预报前必须调用本工具；不得依据模型自身知识生成天气结论，工具不可用时只能明确说明天气服务不可用',
    kind: 'read',
    schema: z.object({
      city: z.string().min(1).max(80).optional(),
      days: z.number().int().min(1).max(5).optional(),
    }),
    execute: (_ctx, input) => weatherForecast(input),
  });

async function weatherForecast(input: Record<string, unknown>) {
  const city =
    typeof input.city === 'string' && input.city.trim()
      ? input.city.trim().slice(0, 80)
      : '深圳';
  const days = boundedInteger(input.days, 3, 5, '预报天数');
  const apiKey = openweatherApiKey();
  if (!apiKey) return { error: 'weather_api_not_configured' };

  try {
    const url = new URL(`${openweatherBaseUrl()}/forecast`);
    url.searchParams.set('q', city);
    url.searchParams.set('cnt', String(days * 8));
    url.searchParams.set('appid', apiKey);
    url.searchParams.set('units', 'metric');
    url.searchParams.set('lang', 'zh_cn');
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { error: 'weather_api_unavailable' };
    const payload = (await response.json()) as Record<string, unknown>;
    const rawEntries = Array.isArray(payload.list) ? payload.list : [];
    const groups = new Map<
      string,
      { temperatures: number[]; weather: string; description: string }
    >();
    for (const rawEntry of rawEntries) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as Record<string, unknown>;
      const date =
        typeof entry.dt_txt === 'string' ? entry.dt_txt.slice(0, 10) : '';
      const main =
        entry.main && typeof entry.main === 'object'
          ? (entry.main as Record<string, unknown>)
          : null;
      const temperature = Number(main?.temp);
      const weatherEntry =
        Array.isArray(entry.weather) &&
        entry.weather[0] &&
        typeof entry.weather[0] === 'object'
          ? (entry.weather[0] as Record<string, unknown>)
          : null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(temperature)) {
        continue;
      }
      const current = groups.get(date) ?? {
        temperatures: [],
        weather: '',
        description: '',
      };
      current.temperatures.push(temperature);
      if (!current.weather && typeof weatherEntry?.main === 'string') {
        current.weather = weatherEntry.main.slice(0, 80);
      }
      if (!current.description && typeof weatherEntry?.description === 'string') {
        current.description = weatherEntry.description.slice(0, 120);
      }
      groups.set(date, current);
    }
    const forecasts = [...groups.entries()]
      .slice(0, days)
      .map(([date, group]) => ({
        date,
        temp: Number(
          (
            group.temperatures.reduce((sum, value) => sum + value, 0) /
            group.temperatures.length
          ).toFixed(1),
        ),
        minTemp: Number(Math.min(...group.temperatures).toFixed(1)),
        maxTemp: Number(Math.max(...group.temperatures).toFixed(1)),
        weather: group.weather,
        description: group.description,
        untrustedContent: true,
      }));
    if (!forecasts.length) return { error: 'weather_api_unavailable' };
    const payloadCity =
      payload.city && typeof payload.city === 'object'
        ? (payload.city as Record<string, unknown>).name
        : null;
    return {
      city:
        typeof payloadCity === 'string' && payloadCity.trim()
          ? payloadCity.trim().slice(0, 80)
          : city,
      forecasts,
      untrustedContent: true,
    };
  } catch {
    return { error: 'weather_api_unavailable' };
  }
}

export const recallPreferencesTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'recall_preferences',
    description: '这是回顾当前成员已记录偏好的唯一数据来源。用户询问自己有哪些已记录偏好时必须调用本工具；不得仅凭对话历史声称某项偏好存在或不存在',
    kind: 'read',
    schema: z.object({
      scope: z.enum(['member_private', 'household']).optional(),
      memoryKey: z.enum(AGENT_MEMORY_KEYS).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    execute({ user }, input) {
      const memoryKey =
        typeof input.memoryKey === 'string' &&
        AGENT_MEMORY_KEYS.includes(input.memoryKey as AgentMemoryKey)
          ? (input.memoryKey as AgentMemoryKey)
          : undefined;
      if (input.memoryKey != null && !memoryKey) {
        throw new BadRequestException('不支持的记忆分类键');
      }
      return deps.agentMemory.search(
        {
          scope:
            input.scope === 'household' ? 'household' : 'member_private',
          memoryKey,
          limit: limited(input.limit),
        },
        user,
      );
    },
  });

/**
 * 写的是待成员确认的个人记忆候选（agent 自己的表，不是插件业务数据），确认前不生效；
 * 注册表只分读 / 提案两类，它按读工具登记，结果原样交回模型。
 */
export const rememberPreferenceTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'remember_preference',
    description: '当当前成员说“记住我……”或要求记住自己的偏好、习惯时，必须立即调用本工具，创建归属当前成员的 member_private 候选并等待其在 Family App 内确认；无需且不得追问是否适用于全家',
    kind: 'read',
    schema: z.object({
      memoryKey: z.enum(AGENT_MEMORY_KEYS),
      content: z.string().min(1).max(2000),
    }),
    execute({ user, run }, input) {
      return deps.agentMemory.createCandidate(
        {
          content: typeof input.content === 'string' ? input.content : '',
          memoryKey: input.memoryKey as AgentMemoryKey,
          sourceType: 'agent_tool',
          sourceId: run.id,
          sourceConversationId: run.conversationId,
          confidenceSource: 'summary_candidate',
        },
        user,
      );
    },
  });

/**
 * 打包提案：steps 是判别联合，由 manifest 推导——manifest 里能打包（grouped 不为 false）的提案工具，
 * 每个出一支 { type: <actionType>, ...该工具的参数 }，按传入的提案工具顺序排列。
 */
export function proposePlanTool(deps: AgentToolDeps, proposeTools: readonly AgentToolDefinition[]) {
  const groupable = new Map(
    pluginProposals()
      .filter((proposal) => proposal.grouped)
      .map((proposal) => [proposal.tool, proposal.actionType]),
  );
  const branches = proposeTools
    .filter((tool) => groupable.has(tool.name))
    .map((tool) => z.object({ type: z.literal(groupable.get(tool.name)!), ...tool.schema.shape }));
  if (branches.length < 2) throw new Error('propose_plan 至少要两种能打包的提案');
  return defineTool({
    name: 'propose_plan',
    description: '当用户的请求需要同时改动多个家庭模块（例如来客吃饭涉及菜单、任务和购物清单）时，必须只调用本工具把所有步骤打包成一组提案，不得分别调用多个 propose_* 工具。用户确认后整组生效，不支持只确认其中几步；请按实际执行依赖排列 steps。财务记账不能放入本工具，必须单独调用 propose_finance_transaction 并独立确认。',
    kind: 'propose',
    schema: z.object({
      title: z.string().min(1).max(120),
      summary: z.string().min(1).max(400),
      steps: z
        .array(z.discriminatedUnion('type', branches as [(typeof branches)[number], ...(typeof branches)[number][]]))
        .min(1)
        .max(8),
    }),
    async execute(ctx, input) {
      const presented = await deps.proposalGroups.createFromRun(input, ctx.run, ctx.user);
      ctx.onProposal?.(presented);
      return ctx.receipt(presented.id);
    },
  });
}
