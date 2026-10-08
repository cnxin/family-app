import { BadRequestException } from '@nestjs/common';
import { todayInShanghai } from '@family/shared';
import { z } from 'zod';
import { dateOnly, defineTool, limited, type AgentToolDeps } from './context';

export const getShoppingListTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_shopping_list',
    description: '这是查询家庭购物清单内容的唯一数据来源。用户询问购物清单中有什么、是否为空或某项是否在清单时必须调用本工具；不得依据对话历史或模型自身知识编造清单内容',
    kind: 'read',
    schema: z.object({
      date: z.string().optional(),
      includeChecked: z.boolean().optional(),
      status: z.enum(['pending', 'purchased', 'all']).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    async execute({ user }, input) {
      const date = dateOnly(input.date, todayInShanghai());
      const status = input.status;
      if (
        status != null &&
        !['pending', 'purchased', 'all'].includes(String(status))
      ) {
        throw new BadRequestException('不支持的购物清单状态');
      }
      const includeChecked = input.includeChecked === true || status === 'all';
      const rows = await deps.facades.get('shopping').listItems(user.householdId, date);
      return rows
        .filter((row) => {
          if (status === 'pending') return !row.checked;
          if (status === 'purchased') return row.checked;
          return includeChecked || !row.checked;
        })
        .slice(0, limited(input.limit))
        .map((row) => ({
          id: row.id,
          date: row.date,
          name: row.ingredient?.name ?? row.customName ?? '未命名采购项',
          quantity: row.totalQty == null ? null : Number(row.totalQty),
          unit: row.unit,
          checked: row.checked,
          status: row.checked ? 'purchased' : 'pending',
          source: row.source,
          inventoryLinked: row.inventoryItemId != null,
          targetPath: `/shopping?date=${row.date}`,
          untrustedContent: true,
        }));
    },
  });

export const proposeShoppingItemsTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'propose_shopping_items',
    description: '生成手动购物清单提案，不直接修改库存',
    kind: 'propose',
    schema: z.object({
      date: z.string(),
      items: z
        .array(
          z.object({
            customName: z.string().min(1).max(120),
            totalQty: z.number().positive().max(99_999).optional(),
            unit: z.string().max(32).optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
    async execute(ctx, input) {
      const presented = await deps.proposals.createFromRun('propose_shopping_items', input, ctx.run, ctx.user);
      ctx.onProposal?.(presented);
      return ctx.receipt(presented.id);
    },
  });
