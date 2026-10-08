import { daysBetween, todayInShanghai } from '@family/shared';
import { z } from 'zod';
import { defineTool, type AgentToolDeps } from './context';

export const getAssetDetailTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_asset_detail',
    description: '这是查询单个具体资产的详情、保修、维保和状态的唯一途径。用户用“这个东西”“这台电器”“这件资产”指代某个具体资产且页面上下文提供 assetId 时必须调用本工具；没有页面上下文且用户未指明是哪件资产时必须追问，不得自行选择家庭中的任意资产。本约束只覆盖单个具体资产的指代，不影响范围查询',
    kind: 'read',
    schema: z.object({
      assetId: z.string().uuid().optional(),
    }),
    async execute({ user }, input) {
      const assetId =
        typeof input.assetId === 'string' ? input.assetId.trim() : '';
      if (!assetId) {
        return {
          error: 'asset_id_required',
          message: '缺少 assetId，请先确认用户指的是哪件资产，不得自行选择',
        };
      }
      const asset = await deps.facades.get('assets').getAsset(user.householdId, assetId);
      const expiresAt = asset.warrantyExpiresOn;
      const warrantyDelta = expiresAt
        ? daysBetween(todayInShanghai(), expiresAt)
        : null;
      const nextMaintenanceAt = asset.maintenancePlans
        .filter((plan) => plan.isEnabled)
        .map((plan) => plan.nextDueDate)
        .sort()[0] ?? null;
      return {
        id: asset.id,
        name: asset.name,
        category: asset.category,
        status: asset.status,
        location: asset.location,
        brand: asset.brand,
        model: asset.model,
        brandModel: [asset.brand, asset.model].filter(Boolean).join(' ') || null,
        purchaseDate: asset.purchaseDate,
        expiresAt,
        warrantyStatus:
          warrantyDelta == null
            ? 'unknown'
            : warrantyDelta >= 0
              ? 'active'
              : 'expired',
        isUnderWarranty:
          warrantyDelta == null ? null : warrantyDelta >= 0,
        warrantyDaysRemaining:
          warrantyDelta != null && warrantyDelta >= 0 ? warrantyDelta : null,
        warrantyDaysExpired:
          warrantyDelta != null && warrantyDelta < 0
            ? Math.abs(warrantyDelta)
            : null,
        nextMaintenanceAt,
        targetPath: `/asset/${asset.id}`,
        untrustedContent: true,
      };
    },
  });
