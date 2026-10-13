import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { AssetMaintenanceAttentionRule, AssetRenewalAttentionRule, AssetWarrantyAttentionRule, AssetsAttention } from './assets-attention';
import { TodayModule } from '../today/today.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AssetDocument,
  HomeAsset,
  InventoryItem,
  InventoryTransaction,
  MaintenanceConsumable,
  MaintenancePlan,
  MaintenanceRecord,
  Reminder,
  ShoppingItem,
} from '../entities';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { assetsFacade } from './assets.facade';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';

/** 把资产门面注册到内核（K3）：财务汇总页的「固定支出」读资产续费月均走这里。 */
@Injectable()
export class AssetsFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly dataSource: DataSource,
    private readonly assets: AssetsService,
  ) {}

  onModuleInit() {
    this.registry.register('assets', assetsFacade(this.dataSource, this.assets));
  }
}

@Module({
  imports: [
    TodayModule,
    TypeOrmModule.forFeature([
      HomeAsset,
      AssetDocument,
      MaintenancePlan,
      MaintenanceRecord,
      MaintenanceConsumable,
      InventoryItem,
      InventoryTransaction,
      ShoppingItem,
      Reminder,
    ]),
  ],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    AssetMaintenanceAttentionRule,
    AssetRenewalAttentionRule,
    AssetWarrantyAttentionRule,
    AssetsAttention,
    AssetsFacadeProvider,
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
