import { BackupAttentionRule, BackupsAttention } from './backups-attention';
import { TodayModule } from '../today/today.module';
import { SystemModulesController } from './system-modules.controller';
import { SystemModulesService } from './system-modules.service';
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleHasDataRegistry } from './module-has-data.registry';
import { PluginFacadeRegistry } from './plugin-facades.registry';
import { TransactionHookRegistry } from './transaction-hooks.registry';
import { BackupPolicy, BackupRun, Member, Notification } from '../entities';
import { SystemBackupService } from './system-backup.service';
import { HealthController } from './health.controller';
import { SystemBackupController } from './system-backup.controller';

/**
 * 全局：内核的三个插件注册表（hasData 判定、门面、事务内钩子，J1.6 / J1b）任何插件模块都能直接注入，
 * 不用 import 本模块。
 */
@Global()
@Module({
  imports: [TodayModule, TypeOrmModule.forFeature([BackupPolicy, BackupRun, Member, Notification])],
  controllers: [HealthController, SystemBackupController, SystemModulesController],
  providers: [
    SystemBackupService,
    SystemModulesService,
    ModuleHasDataRegistry,
    PluginFacadeRegistry,
    TransactionHookRegistry,
    BackupAttentionRule,
    BackupsAttention,
  ],
  exports: [ModuleHasDataRegistry, PluginFacadeRegistry, TransactionHookRegistry],
})
export class SystemModule {}
