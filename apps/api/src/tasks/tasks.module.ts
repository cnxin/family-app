import { Injectable, OnModuleInit, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { TransactionHookRegistry } from '../system/transaction-hooks.registry';
import { tasksFacade } from './tasks.facade';
import { JwtUser } from '../auth/jwt.guard';
import {
  HouseholdTask,
  HouseholdTaskInstance,
  Member,
  Notification,
} from '../entities';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';

/** 把任务门面注册到内核（J1b）。放在 TasksService 之后：门面文件只引类型，不反过来 import 本文件。 */
@Injectable()
export class TasksFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly tasks: TasksService,
  ) {}

  onModuleInit() {
    this.registry.register('tasks', tasksFacade(this.tasks));
  }
}

/** 任务订阅智能家居联动的事务内钩子（J1b）：联动要建家务时，用联动的事务、联动预先生成的 id 建。 */
@Injectable()
export class TasksLinkHooks implements OnModuleInit {
  constructor(
    private readonly hooks: TransactionHookRegistry,
    private readonly tasks: TasksService,
  ) {}

  onModuleInit() {
    this.hooks.on('smart-home.link-fired', 'tasks', async (payload, manager) => {
      if (!payload.task) return;
      const { id, title, startsOn, note } = payload.task;
      await this.tasks.createWithinTransaction(
        { title, startsOn, ...(note === undefined ? {} : { note }) },
        payload.actor as JwtUser,
        manager,
        id,
      );
    });
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HouseholdTask,
      HouseholdTaskInstance,
      Member,
      Notification,
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService, TasksFacadeProvider, TasksLinkHooks],
  exports: [TasksService],
})
export class TasksModule {}
