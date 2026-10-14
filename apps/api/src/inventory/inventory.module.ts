import { InventoryExpiryAttentionRule, InventoryAttention } from './inventory-attention';
import { TodayModule } from '../today/today.module';
import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Ingredient,
  InventoryBatch,
  InventoryBatchMovement,
  InventoryItem,
  InventoryTransaction,
  MaintenanceConsumable,
  ShoppingItem,
} from '../entities';
import { InventoryBatchesService } from './inventory-batches.service';
import { InventoryTransactionsService } from './inventory-transactions.service';
import { InventoryShoppingReceiptService } from './inventory-shopping-receipt.service';
import { InventoryMenuConsumptionService } from './inventory-menu-consumption.service';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { inventoryFacade } from './inventory.facade';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';

/** 把库存门面注册到内核（J1b）：资产维护记出库、购物读库存与入库确认走这里，不再 import 本目录。 */
@Injectable()
export class InventoryFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly ledger: InventoryTransactionsService,
    private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
  ) {}

  onModuleInit() {
    this.registry.register('inventory', inventoryFacade(this.ledger, this.dataSource, this.inventory));
  }
}

@Module({
  imports: [
    TodayModule,
    TypeOrmModule.forFeature([
      InventoryItem,
      Ingredient,
      InventoryBatch,
      InventoryBatchMovement,
      InventoryTransaction,
      MaintenanceConsumable,
      ShoppingItem,
    ]),
  ],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    InventoryBatchesService,
    InventoryTransactionsService,
    InventoryShoppingReceiptService,
    InventoryMenuConsumptionService,
    InventoryExpiryAttentionRule,
    InventoryAttention,
    InventoryFacadeProvider,
  ],
  exports: [
    InventoryService,
    InventoryBatchesService,
    InventoryTransactionsService,
  ],
})
export class InventoryModule {}
