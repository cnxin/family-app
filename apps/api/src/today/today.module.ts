import { Module } from '@nestjs/common';
import { TodayAttentionController } from './today-attention.controller';
import {
  AttentionRegistry,
  AssetMaintenanceAttentionRule,
  AssetRenewalAttentionRule,
  AssetWarrantyAttentionRule,
  BackupAttentionRule,
  FinanceBudgetAttentionRule,
  GuestMealRequestAttentionRule,
  GuestMenuAttentionRule,
  InventoryExpiryAttentionRule,
  PointsRedemptionAttentionRule,
  PollAttentionRule,
  TravelChecklistAttentionRule,
} from './today-attention.rules';
import { TodayAttentionService } from './today-attention.service';

@Module({
  controllers: [TodayAttentionController],
  providers: [
    TodayAttentionService,
    AssetMaintenanceAttentionRule,
    AssetRenewalAttentionRule,
    AssetWarrantyAttentionRule,
    GuestMenuAttentionRule,
    GuestMealRequestAttentionRule,
    TravelChecklistAttentionRule,
    InventoryExpiryAttentionRule,
    PollAttentionRule,
    PointsRedemptionAttentionRule,
    FinanceBudgetAttentionRule,
    BackupAttentionRule,
    AttentionRegistry,
  ],
  exports: [AttentionRegistry],
})
export class TodayModule {}
