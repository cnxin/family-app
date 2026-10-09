// 本地确定性助理的「剧本」：看成员原话决定调哪个工具（至多一个），再按工具结果拼回答。
// FakeAgentRuntime 直接照它执行；native 运行时的剧本 provider（native/scripted-provider.ts）把它翻成
// 模型的 tool_call / 正文，所以同一批黑盒在 fake 与 native 两种运行时下得到逐字相同的回答（J4.2）。
import { todayInShanghai } from '@family/shared';

export type FakeScriptStep =
  | { readonly kind: 'answer'; readonly content: string }
  | {
      readonly kind: 'tool';
      readonly tool: string;
      readonly args: Record<string, unknown>;
      readonly render: (result: unknown) => string;
    };

function asRows(value: unknown) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function dateFrom(text: string) {
  return text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? todayInShanghai();
}

const answer = (content: string): FakeScriptStep => ({ kind: 'answer', content });
const tool = (
  name: string,
  args: Record<string, unknown>,
  render: (result: unknown) => string,
): FakeScriptStep => ({ kind: 'tool', tool: name, args, render });

export function fakeAgentScript(
  message: string,
  canUse: (tool: string) => boolean,
): FakeScriptStep {
  const text = message.toLocaleLowerCase('zh-CN');
  if (/(创建|新增|安排|记一项).{0,8}任务|任务[：:]/.test(text)) {
    if (!canUse('propose_task')) {
      return answer('当前家庭没有开放任务提案，请联系家庭管理员。');
    }
    const startsOn = dateFrom(message);
    const title = message
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      .replace(/^(请|帮我|给我|我们)?\s*(创建|新增|安排|记一项)?\s*(家庭)?任务\s*[：:]?/i, '')
      .trim()
      .slice(0, 120);
    if (title) {
      return tool(
        'propose_task',
        { title, startsOn, recurrence: 'once' },
        () => `我整理了一份「${title}」任务提案。请先核对预计变化，再在下方明确确认或放弃。`,
      );
    }
  }
  if (/(发起|创建|新增).{0,8}投票|投票[：:]/.test(text)) {
    if (!canUse('propose_poll')) {
      return answer('当前家庭没有开放投票提案，请联系家庭管理员。');
    }
    const parts = message.split(/选项\s*[：:]/);
    const title = parts[0]
      .replace(/^(请|帮我|我们)?\s*(发起|创建|新增)?\s*(家庭)?投票\s*[：:]?/i, '')
      .trim()
      .slice(0, 120);
    const options = (parts[1] ?? '')
      .split(/[、,，/]/)
      .map((label) => label.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (title && options.length >= 2) {
      return tool(
        'propose_poll',
        { title, voteMode: 'single', options: options.map((label) => ({ label })) },
        () => `我整理了「${title}」投票提案，共 ${options.length} 个选项。确认前不会发起投票。`,
      );
    }
  }
  if (/(添加|新增|加入).{0,8}(购物|采购)|购物清单[：:]/.test(text)) {
    if (!canUse('propose_shopping_items')) {
      return answer('当前家庭没有开放购物提案，请联系家庭管理员。');
    }
    const raw = message
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      .replace(/^(请|帮我|我们)?\s*(添加|新增|加入)?\s*(到)?\s*(购物|采购)?清单\s*[：:]?/i, '')
      .trim();
    const names = raw
      .split(/[、,，/]/)
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (names.length) {
      return tool(
        'propose_shopping_items',
        { date: dateFrom(message), items: names.map((customName) => ({ customName })) },
        () => `我整理了 ${names.length} 个购物清单项。它们不会直接修改库存，请核对后确认。`,
      );
    }
  }
  if (canUse('get_tasks') && /任务|待办|家务/.test(text)) {
    return tool('get_tasks', { start: dateFrom(message), limit: 12 }, (result) => {
      const rows = asRows(result) as { title?: string; dueDate?: string; assigneeName?: string | null }[];
      return rows.length
        ? `近期有 ${rows.length} 项待完成任务：\n${rows
            .map(
              (row) =>
                `- ${row.dueDate ?? ''} ${row.title ?? '家庭任务'}${
                  row.assigneeName ? `（${row.assigneeName}）` : ''
                }`.trim(),
            )
            .join('\n')}`
        : '近期没有待完成的家庭任务。';
    });
  }
  if (canUse('get_shopping_list') && /购物清单|采购清单|买什么|要买/.test(text)) {
    return tool('get_shopping_list', { date: dateFrom(message), limit: 20 }, (result) => {
      const rows = asRows(result) as { name?: string; quantity?: number | null; unit?: string | null }[];
      return rows.length
        ? `购物清单还有 ${rows.length} 项：\n${rows
            .map(
              (row) =>
                `- ${row.name ?? '未命名采购项'}${
                  row.quantity != null ? `：${row.quantity}${row.unit ? ` ${row.unit}` : ''}` : ''
                }`,
            )
            .join('\n')}`
        : '这天的购物清单已经清空，或暂时没有待采购项。';
    });
  }
  if (canUse('get_meal_plan') && /菜单|吃什么|早餐|午餐|晚餐|三餐/.test(text)) {
    return tool('get_meal_plan', { date: dateFrom(message) }, (result) => {
      const rows = asRows(result) as { mealType?: string; chefName?: string | null; items?: { dishName?: string }[] }[];
      const mealLabel: Record<string, string> = {
        breakfast: '早餐',
        lunch: '午餐',
        dinner: '晚餐',
      };
      return rows.length
        ? rows
            .map(
              (row) =>
                `${mealLabel[row.mealType ?? ''] ?? '一餐'}：${
                  row.items?.length
                    ? row.items.map((item) => item.dishName ?? '未命名菜品').join('、')
                    : '还没有点菜'
                }${row.chefName ? `（掌勺：${row.chefName}）` : ''}`,
            )
            .join('\n')
        : '这天还没有安排家庭菜单。';
    });
  }
  if (canUse('search_knowledge') && /知识|说明|怎么|如何|流程|使用/.test(text)) {
    return tool('search_knowledge', { query: message, limit: 8 }, (result) => {
      const rows = asRows(result) as { title?: string; summary?: string | null }[];
      return rows.length
        ? `我在家庭知识库里找到 ${rows.length} 条相关内容：\n${rows
            .map(
              (row, index) =>
                `${index + 1}. ${row.title ?? '未命名'}${row.summary ? `：${row.summary}` : ''}`,
            )
            .join('\n')}`
        : '家庭知识库里暂时没有找到相关内容。';
    });
  }
  if (canUse('get_inventory_alerts') && /库存|缺货|补货|快没|采购/.test(text)) {
    return tool('get_inventory_alerts', { limit: 12 }, (result) => {
      const rows = asRows(result) as { name?: string; quantity?: number; unit?: string }[];
      return rows.length
        ? `目前有 ${rows.length} 项库存需要留意：\n${rows
            .map((row) => `- ${row.name}：${row.quantity} ${row.unit}`)
            .join('\n')}`
        : '目前没有低库存提醒。';
    });
  }
  if (canUse('get_travel_checklist') && /出行|旅行|行程|打包|清单/.test(text)) {
    return tool('get_travel_checklist', {}, (result) => {
      const plan = result as { title?: string; items?: { title?: string; status?: string }[] } | null;
      if (!plan) return '目前没有计划中的家庭行程。';
      const pending = (plan.items ?? []).filter((item) => item.status === 'pending');
      return `「${plan.title ?? '家庭行程'}」还有 ${pending.length} 项待处理${
        pending.length
          ? `：\n${pending.map((item) => `- ${item.title}`).join('\n')}`
          : '。'
      }`;
    });
  }
  if (canUse('get_watch_candidates') && /电影|观影|看什么|片单|剧/.test(text)) {
    return tool('get_watch_candidates', { limit: 10 }, (result) => {
      const rows = asRows(result) as { title?: string; year?: number | null; status?: string }[];
      return rows.length
        ? `家庭片单里有 ${rows.length} 个候选：\n${rows
            .map((row) => `- ${row.title}${row.year ? ` (${row.year})` : ''}`)
            .join('\n')}`
        : '家庭片单里暂时没有待看的候选。';
    });
  }
  if (canUse('get_recent_memories') && /回忆|以前|最近发生/.test(text)) {
    return tool('get_recent_memories', { limit: 8 }, (result) => {
      const rows = asRows(result) as { title?: string; happenedOn?: string }[];
      return rows.length
        ? `最近记录了这些家庭回忆：\n${rows
            .map((row) => `- ${row.happenedOn ?? ''} ${row.title ?? ''}`.trim())
            .join('\n')}`
        : '还没有记录家庭回忆。';
    });
  }
  if (canUse('get_calendar') && /日历|安排|这周|明天|接下来/.test(text)) {
    const start = new Date().toISOString().slice(0, 10);
    const endDate = new Date(`${start}T00:00:00.000Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 6);
    return tool(
      'get_calendar',
      { start, end: endDate.toISOString().slice(0, 10) },
      (result) => {
        const rows = asRows(result) as { date?: string; title?: string }[];
        return rows.length
          ? `接下来一周有 ${rows.length} 项安排：\n${rows
              .map((row) => `- ${row.date ?? ''} ${row.title ?? ''}`.trim())
              .join('\n')}`
          : '接下来一周暂时没有家庭安排。';
      },
    );
  }
  if (!canUse('get_today_summary')) {
    return answer('当前家庭没有开放可用于回答这个问题的只读工具。');
  }
  return tool('get_today_summary', {}, (result) => {
    const summary = result as { entries?: { title?: string; status?: string }[]; inventoryAlerts?: unknown[] };
    const entries = summary.entries ?? [];
    return entries.length
      ? `今天家里有 ${entries.length} 项安排：\n${entries
          .map((entry) => `- ${entry.title ?? '家庭事项'}`)
          .join('\n')}`
      : '今天暂时没有需要特别处理的家庭安排。';
  });
}
