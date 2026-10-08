import { BadRequestException } from '@nestjs/common';
import { addDays, todayInShanghai } from '@family/shared';
import { z } from 'zod';
import { defineTool, limited, MAX_EXTENDED_RESULT_ITEMS, type AgentToolDeps } from './context';

/** 低库存提醒（今日摘要也用）。 */
export async function inventoryAlerts(deps: AgentToolDeps, householdId: string, limit: number) {
  const rows = await deps.facades.get('inventory').lowStockItems(householdId, limit);
  return rows.map((item) => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    lowStockThreshold: item.lowStockThreshold,
    targetPath: '/shopping',
  }));
}

export const getInventoryAlertsTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_inventory_alerts',
    description: '读取当前家庭的低库存提醒',
    kind: 'read',
    schema: z.object({
      limit: z.number().int().min(1).max(20).optional(),
    }),
    execute: ({ user }, input) => inventoryAlerts(deps, user.householdId, limited(input.limit)),
  });

export const getInventorySummaryTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_inventory_summary',
    description: '查询家庭低库存和临期库存摘要',
    kind: 'read',
    schema: z.object({
      filter: z.enum(['low_stock', 'expiring_soon', 'all']).optional(),
    }),
    async execute({ user }, input) {
      const filter = input.filter ?? 'low_stock';
      if (!['low_stock', 'expiring_soon', 'all'].includes(String(filter))) {
        throw new BadRequestException('不支持的库存过滤条件');
      }
      const rows = await deps.facades.get('inventory').listStockWithExpiry(user.householdId);
      const expiryBoundary = addDays(todayInShanghai(), 7);
      const matched = rows
        .map((item) => {
          const expiresAt = item.earliestExpiresOn;
          const lowStock = item.quantity <= item.lowStockThreshold;
          const expiringSoon = expiresAt != null && expiresAt <= expiryBoundary;
          return {
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            lowStockThreshold: item.lowStockThreshold,
            expiresAt,
            alert:
              lowStock && expiringSoon
                ? 'low_stock_and_expiring'
                : lowStock
                  ? 'low_stock'
                  : expiringSoon
                    ? 'expiring_soon'
                    : 'normal',
            targetPath: '/shopping',
            lowStock,
            expiringSoon,
          };
        })
        .filter((item) => {
          if (filter === 'low_stock') return item.lowStock;
          if (filter === 'expiring_soon') return item.expiringSoon;
          return true;
        });
      return {
        items: matched
          .slice(0, MAX_EXTENDED_RESULT_ITEMS)
          .map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            lowStockThreshold: item.lowStockThreshold,
            expiresAt: item.expiresAt,
            alert: item.alert,
            targetPath: item.targetPath,
            untrustedContent: true,
          })),
        total: matched.length,
      };
    },
  });
