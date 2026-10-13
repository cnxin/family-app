import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { remindersFacade } from './reminders.facade';
import { TransactionHookRegistry } from '../system/transaction-hooks.registry';
import {
  CalendarEvent,
  HouseholdTask,
  HouseholdTaskInstance,
  Member,
  Menu,
  MaintenancePlan,
  Notification,
  Poll,
  Reminder,
  ReminderRecipient,
  TravelPlan,
} from '../entities';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';

/** 提醒订阅智能家居联动的事务内钩子（J1b）：联动要建提醒时，用联动的事务建（家务由任务先建好，见 TRANSACTION_HOOK_ORDER）。 */
@Injectable()
export class RemindersLinkHooks implements OnModuleInit {
  constructor(
    private readonly hooks: TransactionHookRegistry,
    private readonly reminders: RemindersService,
  ) {}

  onModuleInit() {
    this.hooks.on('smart-home.link-fired', 'reminders', async (payload, manager) => {
      if (!payload.reminder) return;
      await this.reminders.createWithinTransaction(payload.reminder, payload.actor as JwtUser, manager);
    });
  }
}

/** 把提醒门面注册到内核（J4.1）：小管家提醒提案的预览与确认后建提醒走这里。 */
@Injectable()
export class RemindersFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly reminders: RemindersService,
  ) {}

  onModuleInit() {
    this.registry.register('reminders', remindersFacade(this.reminders));
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Reminder,
      ReminderRecipient,
      Notification,
      Member,
      CalendarEvent,
      Menu,
      HouseholdTask,
      HouseholdTaskInstance,
      Poll,
      MaintenancePlan,
      TravelPlan,
    ]),
  ],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersLinkHooks, RemindersFacadeProvider],
  exports: [RemindersService],
})
export class RemindersModule {}
