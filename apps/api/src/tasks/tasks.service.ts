import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  HouseholdTask,
  HouseholdTaskInstance,
  Member,
  Notification,
} from '../entities';
import { isHouseholdManager, parseDateOnly } from '@family/shared';
import { type CreateTaskBody, type UpdateTaskBody } from '@family/contracts';
import { DAY_MS, occurrenceDates, normalizeTaskInput, presentOccurrence } from './tasks.helpers';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(HouseholdTask)
    private readonly tasks: Repository<HouseholdTask>,
    @InjectRepository(HouseholdTaskInstance)
    private readonly instances: Repository<HouseholdTaskInstance>,
    private readonly dataSource: DataSource,
  ) {}

  async list(start: string, end: string, user: JwtUser) {
    const startTime = parseDateOnly(start, '开始日期');
    const endTime = parseDateOnly(end, '结束日期');
    if (startTime > endTime) {
      throw new BadRequestException('开始日期不能晚于结束日期');
    }
    if ((endTime - startTime) / DAY_MS > 370) {
      throw new BadRequestException('单次最多查询 371 天');
    }

    const tasks = await this.tasks.find({
      where: [
        {
          householdId: user.householdId,
          isArchived: false,
          startsOn: LessThanOrEqual(end),
          endsOn: IsNull(),
        },
        {
          householdId: user.householdId,
          isArchived: false,
          startsOn: LessThanOrEqual(end),
          endsOn: MoreThanOrEqual(start),
        },
      ],
      order: { startsOn: 'ASC', createdAt: 'ASC' },
    });
    if (!tasks.length) return [];

    const instances = await this.instances.find({
      where: {
        householdId: user.householdId,
        taskId: In(tasks.map((task) => task.id)),
        dueDate: Between(start, end),
      },
    });
    const instanceByOccurrence = new Map(
      instances.map((instance) => [`${instance.taskId}:${instance.dueDate}`, instance]),
    );
    const rows = tasks.flatMap((task) => {
      const scheduled = occurrenceDates(task, start, end);
      const historical = instances
        .filter(
          (instance) =>
            instance.taskId === task.id &&
            instance.status !== 'pending' &&
            !scheduled.includes(instance.dueDate),
        )
        .map((instance) => instance.dueDate);
      return [...new Set([...scheduled, ...historical])].map((dueDate) =>
        presentOccurrence(
          task,
          dueDate,
          instanceByOccurrence.get(`${task.id}:${dueDate}`),
          user,
        ),
      );
    });
    return rows.sort(
      (left, right) =>
        left.dueDate.localeCompare(right.dueDate) ||
        left.task.title.localeCompare(right.task.title, 'zh-CN'),
    );
  }

  async create(dto: CreateTaskBody, user: JwtUser) {
    const taskId = await this.dataSource.transaction((manager) =>
      this.createWithinTransaction(dto, user, manager),
    );
    return this.findTask(taskId, user.householdId);
  }

  /** id：智能家居联动预先生成（通知、提醒要挂在它上面）；其余调用方不传，由数据库生成。 */
  async createWithinTransaction(
    dto: CreateTaskBody,
    user: JwtUser,
    manager: EntityManager,
    id?: string,
  ) {
    if ((dto.rewardPoints ?? 0) > 0 && !isHouseholdManager(user)) {
      throw new ForbiddenException('只有家庭管理员可以设置任务积分');
    }
    const input = normalizeTaskInput(dto);
    const tasks = manager.getRepository(HouseholdTask);
    const notifications = manager.getRepository(Notification);
    const assignee = dto.defaultAssigneeId
      ? await this.requireMember(dto.defaultAssigneeId, user, manager)
      : null;
    const task = await tasks.save(
      tasks.create({
        ...(id ? { id } : {}),
        ...input,
        householdId: user.householdId,
        createdById: user.memberId,
        defaultAssigneeId: assignee?.id ?? null,
        rewardPoints: dto.rewardPoints ?? 0,
      }),
    );
    if (assignee && assignee.id !== user.memberId) {
      await notifications.save(
        notifications.create({
          householdId: user.householdId,
          recipientId: assignee.id,
          module: 'task',
          type: 'task_assigned',
          sourceId: task.id,
          title: `${user.name}给你安排了「${task.title}」`.slice(0, 160),
          body: task.startsOn,
          targetPath: `/tasks?date=${task.startsOn}&taskId=${task.id}`,
        }),
      );
    }
    return task.id;
  }

  async update(id: string, dto: UpdateTaskBody, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      const tasks = manager.getRepository(HouseholdTask);
      const instances = manager.getRepository(HouseholdTaskInstance);
      const notifications = manager.getRepository(Notification);
      const task = await tasks
        .createQueryBuilder('task')
        .where('task.id = :id', { id })
        .andWhere('task.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!task) throw new NotFoundException('家庭任务不存在');
      this.assertTaskManageable(task, user);
      if (dto.rewardPoints !== undefined && !isHouseholdManager(user)) {
        throw new ForbiddenException('只有家庭管理员可以修改任务积分');
      }

      const input = normalizeTaskInput(dto, task);
      const assignmentProvided = Object.prototype.hasOwnProperty.call(
        dto,
        'defaultAssigneeId',
      );
      const assignee = assignmentProvided && dto.defaultAssigneeId
        ? await this.requireMember(dto.defaultAssigneeId, user, manager)
        : null;
      const previousAssigneeId = task.defaultAssigneeId;
      const scheduleChanged =
        task.startsOn !== input.startsOn ||
        task.recurrence !== input.recurrence ||
        task.repeatInterval !== input.repeatInterval ||
        task.endsOn !== input.endsOn;

      Object.assign(task, input);
      if (assignmentProvided) task.defaultAssigneeId = assignee?.id ?? null;
      if (dto.rewardPoints !== undefined) task.rewardPoints = dto.rewardPoints;
      if (dto.isArchived !== undefined) task.isArchived = dto.isArchived;
      await tasks.save(task);

      if (scheduleChanged) {
        await instances.delete({ taskId: task.id, status: 'pending' });
      } else if (
        assignmentProvided &&
        previousAssigneeId !== task.defaultAssigneeId
      ) {
        const update = instances
          .createQueryBuilder()
          .update(HouseholdTaskInstance)
          .set({ assigneeId: task.defaultAssigneeId })
          .where('"taskId" = :taskId', { taskId: task.id })
          .andWhere('status = :status', { status: 'pending' });
        if (previousAssigneeId) {
          update.andWhere('"assigneeId" = :previousAssigneeId', {
            previousAssigneeId,
          });
        } else {
          update.andWhere('"assigneeId" IS NULL');
        }
        await update.execute();
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
            title: `${user.name}给你安排了「${task.title}」`.slice(0, 160),
            body: task.startsOn,
            targetPath: `/tasks?date=${task.startsOn}&taskId=${task.id}`,
          }),
        );
      }
    });
    return this.findTask(id, user.householdId);
  }

  async archive(id: string, user: JwtUser) {
    const task = await this.tasks.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!task) throw new NotFoundException('家庭任务不存在');
    this.assertTaskManageable(task, user);
    task.isArchived = true;
    await this.tasks.save(task);
    return { id, archived: true as const };
  }

  private assertTaskManageable(task: HouseholdTask, user: JwtUser) {
    if (task.createdById !== user.memberId && !isHouseholdManager(user)) {
      throw new ForbiddenException('只能管理自己创建的任务');
    }
  }

  async requireMember(
    memberId: string,
    user: JwtUser,
    manager = this.dataSource.manager,
  ) {
    const member = await manager.getRepository(Member).findOneBy({
      id: memberId,
      householdId: user.householdId,
    });
    if (!member) throw new NotFoundException('家庭成员不存在');
    return member;
  }

  async findTask(id: string, householdId: string) {
    const task = await this.tasks.findOneBy({ id, householdId });
    if (!task) throw new NotFoundException('家庭任务不存在');
    return task;
  }
}
