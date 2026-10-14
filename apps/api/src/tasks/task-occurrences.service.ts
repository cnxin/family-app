import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHookRegistry } from '../system/transaction-hooks.registry';
import { DataSource, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { EventBus } from '../events/event-bus';
import { HouseholdTask, HouseholdTaskInstance, Notification } from '../entities';
import { isHouseholdManager, parseDateOnly, taskOccursOn } from '@family/shared';
import { type UpdateTaskInstanceBody } from '@family/contracts';
import { presentOccurrence } from './tasks.helpers';
import { TasksService } from './tasks.service';

/** 改某一次任务（打勾、改负责人、改备注）：在事务里写实例、跑打勾钩子、发 tasks.completed 事件（J7.2 从 TasksService 拆出）。 */
@Injectable()
export class TaskOccurrencesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hooks: TransactionHookRegistry,
    private readonly events: EventBus,
    @InjectRepository(HouseholdTaskInstance)
    private readonly instances: Repository<HouseholdTaskInstance>,
    private readonly taskService: TasksService,
  ) {}

  async updateOccurrence(
    taskId: string,
    dueDate: string,
    dto: UpdateTaskInstanceBody,
    user: JwtUser,
  ) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    parseDateOnly(dueDate, '任务日期');
    let savedId = '';
    let completedTitle: string | null = null;
    await this.dataSource.transaction(async (manager) => {
      const tasks = manager.getRepository(HouseholdTask);
      const instances = manager.getRepository(HouseholdTaskInstance);
      const notifications = manager.getRepository(Notification);
      const task = await tasks.findOne({
        where: { id: taskId, householdId: user.householdId },
      });
      if (!task || task.isArchived) throw new NotFoundException('家庭任务不存在');
      let instance = await instances
        .createQueryBuilder('instance')
        .where('instance.taskId = :taskId', { taskId })
        .andWhere('instance.dueDate = :dueDate', { dueDate })
        .andWhere('instance.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!instance && !taskOccursOn(task, dueDate)) {
        throw new NotFoundException('这一天没有该任务');
      }

      const previousStatus = instance?.status ?? 'pending';
      const previousAssigneeId = instance?.assigneeId ?? task.defaultAssigneeId;
      const assignmentProvided = Object.prototype.hasOwnProperty.call(
        dto,
        'assigneeId',
      );
      const canManage = task.createdById === user.memberId || isHouseholdManager(user);
      if (
        assignmentProvided &&
        !canManage &&
        !(
          (previousAssigneeId == null && dto.assigneeId === user.memberId) ||
          (previousAssigneeId === user.memberId && dto.assigneeId == null)
        )
      ) {
        throw new ForbiddenException('只能认领未分配任务或取消自己的认领');
      }
      if (
        dto.status !== undefined &&
        !canManage &&
        previousAssigneeId != null &&
        previousAssigneeId !== user.memberId
      ) {
        throw new ForbiddenException('只能更新分配给自己的任务');
      }

      const assignee = assignmentProvided && dto.assigneeId
        ? await this.taskService.requireMember(dto.assigneeId, user, manager)
        : null;
      if (!instance) {
        instance = instances.create({
          householdId: user.householdId,
          taskId,
          dueDate,
          assigneeId: previousAssigneeId,
          status: 'pending',
        });
      }
      if (assignmentProvided) instance.assigneeId = assignee?.id ?? null;
      if (dto.status !== undefined) {
        instance.status = dto.status;
        instance.resolvedAt = dto.status === 'pending' ? null : new Date();
        instance.resolvedById = dto.status === 'pending' ? null : user.memberId;
      }
      instance = await instances.save(instance);
      savedId = instance.id;

      // 连带写走事务内钩子（J1b）：积分订阅 tasks.completed / tasks.uncompleted，用本事务记 / 冲销积分，
      // 订阅方抛错则任务状态的修改一起回滚
      if (dto.status === 'done' && previousStatus !== 'done') {
        completedTitle = task.title;
        await this.hooks.run(
          'tasks.completed',
          {
            householdId: user.householdId,
            taskId: task.id,
            instanceId: instance.id,
            dueDate: instance.dueDate,
            title: task.title,
            rewardPoints: task.rewardPoints,
            memberId: instance.assigneeId ?? user.memberId,
            completedAt: instance.resolvedAt!,
            actor: user,
          },
          manager,
        );
      } else if (
        dto.status !== undefined &&
        dto.status !== 'done' &&
        previousStatus === 'done'
      ) {
        await this.hooks.run(
          'tasks.uncompleted',
          {
            householdId: user.householdId,
            taskId: task.id,
            instanceId: instance.id,
            dueDate: instance.dueDate,
            title: task.title,
            rewardPoints: task.rewardPoints,
            actor: user,
          },
          manager,
        );
      }

      if (
        assignmentProvided &&
        assignee &&
        assignee.id !== user.memberId &&
        assignee.id !== previousAssigneeId
      ) {
        await notifications.save(
          notifications.create({
            householdId: user.householdId,
            recipientId: assignee.id,
            module: 'task',
            type: 'task_assigned',
            sourceId: task.id,
            title: `${user.name}把「${task.title}」交给了你`.slice(0, 160),
            body: dueDate,
            targetPath: `/tasks?date=${dueDate}&taskId=${task.id}`,
          }),
        );
      }
      if (
        dto.status === 'done' &&
        previousStatus !== 'done' &&
        task.createdById !== user.memberId
      ) {
        await notifications.save(
          notifications.create({
            householdId: user.householdId,
            recipientId: task.createdById,
            module: 'task',
            type: 'task_completed',
            sourceId: task.id,
            title: `${user.name}完成了「${task.title}」`.slice(0, 160),
            body: dueDate,
            targetPath: `/tasks?date=${dueDate}&taskId=${task.id}`,
          }),
        );
      }
    });

    // 事务已提交：通知订阅方（智能家居联动等），不等它们
    if (completedTitle !== null) {
      this.events.emit('tasks.completed', {
        householdId: user.householdId,
        taskId,
        dueDate,
        title: completedTitle,
        actor: user,
      });
    }

    const instance = await this.instances.findOneBy({
      id: savedId,
      householdId: user.householdId,
    });
    const task = await this.taskService.findTask(taskId, user.householdId);
    if (!instance) throw new NotFoundException('任务实例不存在');
    return presentOccurrence(task, dueDate, instance, user);
  }
}
