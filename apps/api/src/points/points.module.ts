import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { PointsRedemptionAttentionRule, PointsAttention } from './points-attention';
import { TodayModule } from '../today/today.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Member,
  Notification,
  PointsAccount,
  PointsLedger,
  Reward,
  RewardRedemption,
} from '../entities';
import { TransactionHookRegistry } from '../system/transaction-hooks.registry';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { pointsFacade } from './points.facade';
import { PointsService } from './points.service';
import { PointsController } from './points.controller';

/** 积分订阅任务的事务内钩子（J1b）：打勾记积分、取消打勾冲销，不再由任务 import PointsService。 */
@Injectable()
export class PointsTaskHooks implements OnModuleInit {
  constructor(
    private readonly hooks: TransactionHookRegistry,
    private readonly points: PointsService,
  ) {}

  onModuleInit() {
    this.hooks.on('tasks.completed', 'points', async (payload, manager) => {
      await this.points.awardTaskCompletion(manager, payload);
    });
    this.hooks.on('tasks.uncompleted', 'points', async (payload, manager) => {
      await this.points.reverseTaskAward(manager, payload);
    });
  }
}

/** 积分门面（J4 第四批：小管家读工具 get_points_summary）。 */
@Injectable()
export class PointsFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly db: DataSource,
  ) {}

  onModuleInit() {
    this.registry.register('points', pointsFacade(this.db));
  }
}

@Module({
  imports: [
    TodayModule,
    TypeOrmModule.forFeature([
      Member,
      Notification,
      PointsAccount,
      PointsLedger,
      Reward,
      RewardRedemption,
    ]),
  ],
  controllers: [PointsController],
  providers: [PointsService, PointsRedemptionAttentionRule, PointsAttention, PointsTaskHooks, PointsFacadeProvider],
  exports: [PointsService],
})
export class PointsModule {}
