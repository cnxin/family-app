// 库存门面（J1b）：实现在 apps/api/src/inventory/inventory.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：资产（维护记出库，和维护记录同一事务）、购物（生成清单扣掉现有库存；列表 / 删除看有没有确认入库）、
// 小管家（库存提醒、库存摘要、每周回顾的库存告警数）。
import type { PluginActor, PluginTransaction } from './kernel';

/** 维护出库的一行。资产那边已锁住库存行、核过单位与余量，并预先生成流水 id 写进维护记录的耗材快照。 */
export interface MaintenanceConsumptionLine {
  inventoryItemId: string;
  transactionId: string;
  quantityBefore: number;
  /** 出库量（正数） */
  quantity: number;
  quantityAfter: number;
  unit: string;
}

export interface MaintenanceConsumption {
  householdId: string;
  operationId: string;
  recordId: string;
  actor: PluginActor;
  lines: MaintenanceConsumptionLine[];
}

/** 关联了食材的库存物品现有量（数据库里的 decimal 字符串）。 */
export interface IngredientStock {
  ingredientId: string | null;
  unit: string;
  quantity: string;
}

/** 购物项的确认入库流水，带撤销时间。按入库时间升序。 */
export interface ShoppingReceiptView {
  transactionId: string;
  shoppingItemId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantityBefore: string;
  delta: string;
  quantityAfter: string;
  unit: string;
  actorName: string;
  createdAt: Date;
  reversedAt: Date | null;
}

/** 库存物品的余量（数量已转成数字）。 */
export interface StockItemView {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
}

/** 每周回顾数库存告警用：余量、阈值（decimal 字符串）与批次汇总。 */
export interface StockStatusView {
  quantity: string;
  lowStockThreshold: string;
  batchSummary?: { expiringCount: number; expiredCount: number } | null;
}

export interface InventoryFacade {
  /**
   * 维护记出库：逐行写库存流水（来源 maintenance_record）、改余量、按批次先进先出扣减。
   * transaction 传资产那边的事务——维护记录和出库同一事务，任一步抛错一起回滚。
   */
  consumeForMaintenance(transaction: PluginTransaction, input: MaintenanceConsumption): Promise<void>;
  /** 关联这些食材的库存物品（购物生成清单用，在调用方的事务里读）。 */
  listIngredientStock(transaction: PluginTransaction, householdId: string, ingredientIds: string[]): Promise<IngredientStock[]>;
  /** 这些购物项的确认入库流水；transaction 不传时用默认连接。 */
  listShoppingReceipts(householdId: string, shoppingItemIds: string[], transaction?: PluginTransaction): Promise<ShoppingReceiptView[]>;
  /** 这个购物项是否确认入库过（撤销过也算）。 */
  hasShoppingReceipt(householdId: string, shoppingItemId: string): Promise<boolean>;
  /** 余量不高于阈值的物品，余量升序、同量按名字，最多 limit 条。 */
  lowStockItems(householdId: string, limit: number): Promise<StockItemView[]>;
  /** 全部物品（按名字），带有余量的批次里最早的到期日。 */
  listStockWithExpiry(householdId: string): Promise<(StockItemView & { earliestExpiresOn: string | null })[]>;
  /** 与 GET /inventory 同一个实现（带批次汇总）。 */
  listStockStatus(householdId: string): Promise<StockStatusView[]>;
}
