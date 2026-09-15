import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
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
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { PointsModule, PointsService } from '../points/points.module';
import {
  HouseholdTask,
  HouseholdTaskInstance,
  Member,
  Notification,
  TaskInstanceStatus,
  TaskRecurrence,
} from '../entities';
import { isHouseholdManager, parseDateOnly } from '@family/shared';

class TaskRangeDto {
  @IsISO8601({ strict: true })
  start: string;

  @IsISO8601({ strict: true })
  end: string;
}

export class CreateTaskDto {
  @IsString()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsISO8601({ strict: true })
  startsOn: string;

  @IsOptional()
  @IsIn(['once', 'daily', 'weekly', 'monthly'])
  recurrence?: TaskRecurrence;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  repeatInterval?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsOn?: string | null;

  @IsOptional()
  @IsUUID()
  defaultAssigneeId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  rewardPoints?: number;
}

class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsOn?: string;

  @IsOptional()
  @IsIn(['once', 'daily', 'weekly', 'monthly'])
  recurrence?: TaskRecurrence;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  repeatInterval?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsOn?: string | null;

  @IsOptional()
  @IsUUID()
  defaultAssigneeId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  rewardPoints?: number;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

class UpdateTaskInstanceDto {
  @IsOptional()
  @IsIn(['pending', 'done', 'skipped'])
  status?: TaskInstanceStatus;

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}

const DAY_MS = 86_400_000;

function dateString(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function taskOccursOn(task: HouseholdTask, date: string) {
  const startsAt = parseDateOnly(task.startsOn, '开始日期');
  const dueAt = parseDateOnly(date, '任务日期');
  if (dueAt < startsAt) return false;
  if (task.endsOn && dueAt > parseDateOnly(task.endsOn, '结束日期')) {
    return false;
  }
  const differenceDays = Math.round((dueAt - startsAt) / DAY_MS);
  if (task.recurrence === 'once') return differenceDays === 0;
  if (task.recurrence === 'daily') {
    return differenceDays % task.repeatInterval === 0;
  }
  if (task.recurrence === 'weekly') {
    return differenceDays % (task.repeatInterval * 7) === 0;
  }
  const starts = task.startsOn.split('-').map(Number);
  const due = date.split('-').map(Number);
  const monthDifference =
    (due[0] - starts[0]) * 12 + (due[1] - starts[1]);
  return due[2] === starts[2] && monthDifference % task.repeatInterval === 0;
}

function occurrenceDates(task: HouseholdTask, start: string, end: string) {
  const first = Math.max(
    parseDateOnly(start, '开始日期'),
    parseDateOnly(task.startsOn, '任务开始日期'),
  );
  const last = Math.min(
    parseDateOnly(end, '结束日期'),
    task.endsOn ? parseDateOnly(task.endsOn, '任务结束日期') : Number.MAX_SAFE_INTEGER,
  );
  const dates: string[] = [];
  for (let timestamp = first; timestamp <= last; timestamp += DAY_MS) {
    const date = dateString(timestamp);
    if (taskOccursOn(task, date)) dates.push(date);
  }
  return dates;
}

function normalizeTaskInput(
  dto: CreateTaskDto | UpdateTaskDto,
  current?: HouseholdTask,
) {
  const title = dto.title ?? current?.title;
  const startsOn = dto.startsOn ?? current?.startsOn;
  const recurrence = dto.recurrence ?? current?.recurrence ?? 'once';
  const repeatInterval = dto.repeatInterval ?? current?.repeatInterval ?? 1;
  const note = Object.prototype.hasOwnProperty.call(dto, 'note')
    ? dto.note?.trim() || null
    : current?.note ?? null;
  let endsOn = Object.prototype.hasOwnProperty.call(dto, 'endsOn')
    ? dto.endsOn ?? null
    : current?.endsOn ?? null;

  if (!title?.trim() || !startsOn) {
    throw new BadRequestException('任务名称和开始日期不能为空');
  }
  const startsAt = parseDateOnly(startsOn, '开始日期');
  if (recurrence === 'once') endsOn = null;
  if (endsOn && parseDateOnly(endsOn, '结束日期') < startsAt) {
    throw new BadRequestException('结束日期不能早于开始日期');
  }
  return {
    title: title.trim(),
    startsOn,
    recurrence,
    repeatInterval,
    endsOn,
    note,
  };
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(HouseholdTask)
    private readonly tasks: Repository<HouseholdTask>,
    @InjectRepository(HouseholdTaskInstance)
    private readonly instances: Repository<HouseholdTaskInstance>,
    private readonly dataSource: DataSource,
    private readonly pointsService: PointsService,
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
        this.presentOccurrence(
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

  async create(dto: CreateTaskDto, user: JwtUser) {
    const taskId = await this.dataSource.transaction((manager) =>
      this.createWithinTransaction(dto, user, manager),
    );
    return this.findTask(taskId, user.householdId);
  }

  async createWithinTransaction(
    dto: CreateTaskDto,
    user: JwtUser,
    manager: EntityManager,
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

  async update(id: string, dto: UpdateTaskDto, user: JwtUser) {
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

  async updateOccurrence(
    taskId: string,
    dueDate: string,
    dto: UpdateTaskInstanceDto,
    user: JwtUser,
  ) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    parseDateOnly(dueDate, '任务日期');
    let savedId = '';
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
        ? await this.requireMember(dto.assigneeId, user, manager)
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

      if (dto.status === 'done' && previousStatus !== 'done') {
        await this.pointsService.awardTaskCompletion(
          manager,
          task,
          instance,
          instance.assigneeId ?? user.memberId,
          user,
        );
      } else if (
        dto.status !== undefined &&
        dto.status !== 'done' &&
        previousStatus === 'done'
      ) {
        await this.pointsService.reverseTaskAward(manager, task, instance, user);
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

    const instance = await this.instances.findOneBy({
      id: savedId,
      householdId: user.householdId,
    });
    const task = await this.findTask(taskId, user.householdId);
    if (!instance) throw new NotFoundException('任务实例不存在');
    return this.presentOccurrence(task, dueDate, instance, user);
  }

  private presentOccurrence(
    task: HouseholdTask,
    dueDate: string,
    instance: HouseholdTaskInstance | undefined,
    user: JwtUser,
  ) {
    const assigneeId = instance?.assigneeId ?? task.defaultAssigneeId;
    const assignee = instance ? instance.assignee : task.defaultAssignee;
    const canManageTask = task.createdById === user.memberId || isHouseholdManager(user);
    return {
      id: instance?.id ?? `task:${task.id}:${dueDate}`,
      taskId: task.id,
      dueDate,
      status: instance?.status ?? ('pending' as const),
      assigneeId,
      assignee,
      resolvedById: instance?.resolvedById ?? null,
      resolvedBy: instance?.resolvedBy ?? null,
      resolvedAt: instance?.resolvedAt?.toISOString() ?? null,
      canManageTask,
      canUpdate:
        canManageTask || assigneeId == null || assigneeId === user.memberId,
      pointsAwarded: Boolean(instance?.pointsLedgerId),
      task: {
        id: task.id,
        title: task.title,
        note: task.note,
        startsOn: task.startsOn,
        recurrence: task.recurrence,
        repeatInterval: task.repeatInterval,
        endsOn: task.endsOn,
        createdById: task.createdById,
        createdBy: task.createdBy,
        defaultAssigneeId: task.defaultAssigneeId,
        defaultAssignee: task.defaultAssignee,
        rewardPoints: task.rewardPoints,
        isArchived: task.isArchived,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    };
  }

  private assertTaskManageable(task: HouseholdTask, user: JwtUser) {
    if (task.createdById !== user.memberId && !isHouseholdManager(user)) {
      throw new ForbiddenException('只能管理自己创建的任务');
    }
  }

  private async requireMember(
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

  private async findTask(id: string, householdId: string) {
    const task = await this.tasks.findOneBy({ id, householdId });
    if (!task) throw new NotFoundException('家庭任务不存在');
    return task;
  }
}

@Controller()
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get('tasks')
  list(@Query() query: TaskRangeDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query.start, query.end, user);
  }

  @Post('tasks')
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('tasks/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete('tasks/:id')
  archive(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.archive(id, user);
  }

  @Patch('tasks/:taskId/instances/:dueDate')
  updateOccurrence(
    @Param('taskId') taskId: string,
    @Param('dueDate') dueDate: string,
    @Body() dto: UpdateTaskInstanceDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateOccurrence(taskId, dueDate, dto, user);
  }
}

@Module({
  imports: [
    PointsModule,
    TypeOrmModule.forFeature([
      HouseholdTask,
      HouseholdTaskInstance,
      Member,
      Notification,
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
