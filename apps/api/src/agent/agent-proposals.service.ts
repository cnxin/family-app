import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { assertCapability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import {
  AgentActionProposal,
  AgentActionType,
  AgentRun,
  AgentSetting,
  Dish,
  DishRecipeVariant,
  Member,
  Menu,
} from '../entities';
import { AddItemsDto, MenusService } from '../menus/menus.module';
import { CreatePollDto, PollsService } from '../polls/polls.module';
import {
  CreateReminderDto,
  RemindersService,
} from '../reminders/reminders.module';
import { ManualItemDto, ShoppingService } from '../shopping/shopping.module';
import { CreateTaskDto, TasksService } from '../tasks/tasks.module';
import {
  CreateFinanceTransactionDto,
  FinanceService,
} from '../finance/finance.module';
import {
  AGENT_PROPOSAL_TOOLS,
  AgentProposalToolName,
} from './agent.types';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).optional();

const taskSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    note: optionalText(1000).nullable(),
    startsOn: dateOnly,
    recurrence: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
    repeatInterval: z.number().int().min(1).max(365).optional(),
    endsOn: dateOnly.optional().nullable(),
    defaultAssigneeId: z.string().uuid().optional().nullable(),
    rewardPoints: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

const reminderSchema = z
  .object({
    sourceModule: z.enum([
      'menu',
      'task',
      'calendar',
      'poll',
      'maintenance',
      'travel',
    ]),
    sourceId: z.string().uuid(),
    occurrenceDate: dateOnly.optional().nullable(),
    remindAt: z.string().datetime({ offset: true }),
    recipientIds: z.array(z.string().uuid()).min(1).max(20),
  })
  .strict();

const pollSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: optionalText(1000).nullable(),
    category: z
      .enum(['general', 'meal', 'activity', 'movie', 'shopping'])
      .optional(),
    voteMode: z.enum(['single', 'multiple']).optional(),
    maxChoices: z.number().int().min(1).max(12).optional(),
    closesAt: z.string().datetime({ offset: true }).optional().nullable(),
    options: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            description: optionalText(500).nullable(),
          })
          .strict(),
      )
      .min(2)
      .max(12),
  })
  .strict();

const menuSchema = z
  .object({
    date: dateOnly,
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    items: z
      .array(
        z
          .object({
            dishId: z.string().uuid(),
            recipeVariantId: z.string().uuid().optional(),
            note: optionalText(200),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

const shoppingSchema = z
  .object({
    date: dateOnly,
    items: z
      .array(
        z
          .object({
            customName: z.string().trim().min(1).max(120),
            totalQty: z.number().positive().max(99_999).optional(),
            unit: optionalText(32),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

const financeSchema = z
  .object({
    type: z.enum(['expense', 'income', 'transfer']),
    amount: z.number().positive().max(999_999_999_999.99),
    accountId: z.string().uuid(),
    toAccountId: z.string().uuid().optional().nullable(),
    categoryId: z.string().uuid().optional().nullable(),
    title: z.string().trim().min(1).max(120),
    note: optionalText(1000).nullable(),
    occurredOn: dateOnly,
  })
  .strict();

type TaskPayload = z.infer<typeof taskSchema>;
type ReminderPayload = z.infer<typeof reminderSchema>;
type PollPayload = z.infer<typeof pollSchema>;
type MenuPayload = z.infer<typeof menuSchema>;
type ShoppingPayload = z.infer<typeof shoppingSchema>;
type FinancePayload = z.infer<typeof financeSchema>;
type ProposalPayload =
  | TaskPayload
  | ReminderPayload
  | PollPayload
  | MenuPayload
  | ShoppingPayload
  | FinancePayload;
export type SingleAgentProposalToolName = Exclude<
  AgentProposalToolName,
  'propose_plan'
>;
export type GroupedAgentProposalToolName = Exclude<
  SingleAgentProposalToolName,
  'propose_finance_transaction'
>;

const TYPE_BY_TOOL: Record<SingleAgentProposalToolName, AgentActionType> = {
  propose_task: 'task',
  propose_reminder: 'reminder',
  propose_poll: 'poll',
  propose_menu: 'menu',
  propose_shopping_items: 'shopping',
  propose_finance_transaction: 'finance',
};

const TOOL_BY_TYPE: Record<AgentActionType, AgentProposalToolName> = {
  task: 'propose_task',
  reminder: 'propose_reminder',
  poll: 'propose_poll',
  menu: 'propose_menu',
  shopping: 'propose_shopping_items',
  finance: 'propose_finance_transaction',
};

const ACTION_LABELS: Record<AgentActionType, string> = {
  task: '家庭任务',
  reminder: '家庭提醒',
  poll: '家庭投票',
  menu: '菜单点菜',
  shopping: '购物清单',
  finance: '家庭记账',
};

const MEAL_LABELS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
} as const;

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function fingerprint(actionType: AgentActionType, payload: ProposalPayload) {
  return createHash('sha256')
    .update(JSON.stringify(canonical({ actionType, payload })))
    .digest('hex');
}

function parsePayload(actionType: AgentActionType, value: unknown) {
  const schema = {
    task: taskSchema,
    reminder: reminderSchema,
    poll: pollSchema,
    menu: menuSchema,
    shopping: shoppingSchema,
    finance: financeSchema,
  }[actionType];
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException('操作提案参数无效或包含未开放字段');
  }
  return result.data as ProposalPayload;
}

function currentUser(member: Member, user: JwtUser): JwtUser {
  return {
    ...user,
    memberId: member.id,
    householdId: member.householdId,
    name: member.name,
    role: member.role,
  };
}

@Injectable()
export class AgentProposalsService {
  constructor(
    @InjectRepository(AgentActionProposal)
    private readonly proposals: Repository<AgentActionProposal>,
    private readonly dataSource: DataSource,
    private readonly tasks: TasksService,
    private readonly reminders: RemindersService,
    private readonly polls: PollsService,
    private readonly menus: MenusService,
    private readonly shopping: ShoppingService,
    private readonly finance: FinanceService,
  ) {}

  async createFromRun(
    toolName: SingleAgentProposalToolName,
    input: Record<string, unknown>,
    run: AgentRun,
    user: JwtUser,
  ) {
    const actionType = TYPE_BY_TOOL[toolName];
    const { runId: _runId, ...rawPayload } = input;
    const payload = parsePayload(actionType, rawPayload);
    const requestFingerprint = fingerprint(actionType, payload);
    const idempotencyKey = `proposal:${run.id}:${toolName}:${requestFingerprint}`;
    const existing = await this.proposals.findOneBy({
      householdId: run.householdId,
      idempotencyKey,
    });
    if (existing) return this.present(existing);

    const preview = await this.buildPreview(actionType, payload, user);
    try {
      const proposal = await this.proposals.save(
        this.proposals.create({
          householdId: run.householdId,
          runId: run.id,
          createdByMemberId: run.requestedByMemberId,
          groupId: null,
          stepOrder: null,
          confirmedByMemberId: null,
          actionType,
          payload: payload as Record<string, unknown>,
          preview,
          requestFingerprint,
          idempotencyKey,
          confirmationKey: null,
          expectedSourceVersion: null,
          status: 'pending',
          expiresAt: new Date(Date.now() + 30 * 60_000),
          confirmedAt: null,
          executedAt: null,
          resultModule: null,
          resultId: null,
          failureCode: null,
          failureMessage: null,
          version: 1,
        }),
      );
      return this.present(proposal);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const duplicate = await this.proposals.findOneBy({
          householdId: run.householdId,
          idempotencyKey,
        });
        if (duplicate) return this.present(duplicate);
      }
      throw error;
    }
  }

  async createGroupedWithinTransaction(
    toolName: GroupedAgentProposalToolName,
    input: Record<string, unknown>,
    run: AgentRun,
    user: JwtUser,
    groupId: string,
    stepOrder: number,
    expiresAt: Date,
    manager: EntityManager,
  ) {
    const actionType = TYPE_BY_TOOL[toolName];
    const payload = parsePayload(actionType, input);
    const requestFingerprint = fingerprint(actionType, payload);
    const preview = await this.buildPreview(actionType, payload, user);
    const proposals = manager.getRepository(AgentActionProposal);
    return proposals.save(
      proposals.create({
        householdId: run.householdId,
        runId: run.id,
        createdByMemberId: run.requestedByMemberId,
        groupId,
        stepOrder,
        confirmedByMemberId: null,
        actionType,
        payload: payload as Record<string, unknown>,
        preview,
        requestFingerprint,
        idempotencyKey: `proposal-group:${groupId}:${stepOrder}`,
        confirmationKey: null,
        expectedSourceVersion: null,
        status: 'pending',
        expiresAt,
        confirmedAt: null,
        executedAt: null,
        resultModule: null,
        resultId: null,
        failureCode: null,
        failureMessage: null,
        version: 1,
      }),
    );
  }

  async listForConversation(runIds: string[], user: JwtUser) {
    if (!runIds.length) return [];
    await this.proposals
      .createQueryBuilder()
      .update()
      .set({ status: 'expired', version: () => '"version" + 1' })
      .where('"householdId" = :householdId', { householdId: user.householdId })
      .andWhere('"createdByMemberId" = :memberId', { memberId: user.memberId })
      .andWhere('"runId" IN (:...runIds)', { runIds })
      .andWhere('"groupId" IS NULL')
      .andWhere('"status" = :status', { status: 'pending' })
      .andWhere('"expiresAt" <= now()')
      .execute();
    const proposals = await this.proposals.find({
      where: {
        householdId: user.householdId,
        createdByMemberId: user.memberId,
        runId: In(runIds),
        groupId: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
    return proposals.map((proposal) => this.present(proposal));
  }

  async confirm(
    id: string,
    expectedVersion: number,
    confirmationKey: string,
    user: JwtUser,
  ) {
    let executionStarted = false;
    try {
      return await this.dataSource.transaction(async (manager) => {
        const proposal = await this.lockProposal(id, user, manager);
        if (proposal.status === 'executed') return this.present(proposal);
        if (proposal.status !== 'pending') return this.present(proposal);
        if (proposal.version !== expectedVersion) {
          throw new ConflictException('操作提案已更新，请刷新后重试');
        }
        if (proposal.expiresAt.getTime() <= Date.now()) {
          proposal.status = 'expired';
          proposal.version += 1;
          return this.present(await manager.save(proposal));
        }
        const duplicate = await manager.getRepository(AgentActionProposal).findOne({
          where: { householdId: user.householdId, confirmationKey },
        });
        if (duplicate && duplicate.id !== proposal.id) {
          throw new ConflictException('确认幂等键已用于其他操作');
        }
        executionStarted = true;
        const member = await manager.getRepository(Member).findOneBy({
          id: user.memberId,
          householdId: user.householdId,
        });
        if (!member || member.disabledAt) {
          throw new ForbiddenException('发起成员已停用');
        }
        const actingUser = currentUser(member, user);
        const setting = await manager.getRepository(AgentSetting).findOneBy({
          householdId: user.householdId,
        });
        const requiredTool = TOOL_BY_TYPE[proposal.actionType];
        if (
          !setting?.enabled ||
          !setting.proposalToolsEnabled.includes(requiredTool)
        ) {
          throw new ForbiddenException('这个操作提案工具已被家庭管理员停用');
        }
        const run = await manager.getRepository(AgentRun).findOneBy({
          id: proposal.runId,
          householdId: user.householdId,
          requestedByMemberId: user.memberId,
        });
        if (!run) throw new NotFoundException('提案来源运行不存在');

        proposal.status = 'confirmed';
        proposal.confirmedByMemberId = member.id;
        proposal.confirmedAt = new Date();
        proposal.confirmationKey = confirmationKey;
        proposal.version += 1;
        await manager.save(proposal);

        const result = await this.executeWithinTransaction(
          proposal,
          actingUser,
          manager,
        );
        proposal.status = 'executed';
        proposal.executedAt = new Date();
        proposal.resultModule = result.module;
        proposal.resultId = result.id;
        proposal.failureCode = null;
        proposal.failureMessage = null;
        proposal.version += 1;
        return this.present(await manager.save(proposal));
      });
    } catch (error) {
      if (executionStarted) await this.markFailed(id, user, error);
      throw error;
    }
  }

  async reject(id: string, expectedVersion: number, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const proposal = await this.lockProposal(id, user, manager);
      if (proposal.status !== 'pending') return this.present(proposal);
      if (proposal.version !== expectedVersion) {
        throw new ConflictException('操作提案已更新，请刷新后重试');
      }
      proposal.status =
        proposal.expiresAt.getTime() <= Date.now() ? 'expired' : 'rejected';
      proposal.version += 1;
      return this.present(await manager.save(proposal));
    });
  }

  present(proposal: AgentActionProposal) {
    return {
      id: proposal.id,
      runId: proposal.runId,
      actionType: proposal.actionType,
      actionLabel: ACTION_LABELS[proposal.actionType],
      preview: proposal.preview,
      status: proposal.status,
      expiresAt: proposal.expiresAt,
      confirmedAt: proposal.confirmedAt,
      executedAt: proposal.executedAt,
      resultModule: proposal.resultModule,
      resultId: proposal.resultId,
      failureCode: proposal.failureCode,
      failureMessage: proposal.failureMessage,
      version: proposal.version,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
    };
  }

  private async buildPreview(
    actionType: AgentActionType,
    payload: ProposalPayload,
    user: JwtUser,
  ) {
    if (actionType === 'task') {
      const task = payload as TaskPayload;
      const assignee = task.defaultAssigneeId
        ? await this.requireMember(task.defaultAssigneeId, user)
        : null;
      return {
        title: task.title,
        summary: '确认后新增一项家庭任务',
        changes: [
          { label: '日期', value: task.startsOn },
          {
            label: '重复',
            value:
              task.recurrence && task.recurrence !== 'once'
                ? `每 ${task.repeatInterval ?? 1} 个${task.recurrence}`
                : '仅一次',
          },
          { label: '负责人', value: assignee?.name ?? '暂不指定' },
          { label: '积分', value: String(task.rewardPoints ?? 0) },
        ],
        targetPath: `/tasks?date=${task.startsOn}`,
      };
    }
    if (actionType === 'reminder') {
      const reminder = payload as ReminderPayload;
      const { source, members } = await this.reminders.previewSource(
        reminder as CreateReminderDto,
        user,
      );
      return {
        title: source.title,
        summary: '确认后为现有家庭事项新增提醒',
        changes: [
          { label: '提醒时间', value: reminder.remindAt },
          { label: '接收成员', value: members.map((member) => member.name).join('、') },
          { label: '关联事项', value: source.title },
        ],
        targetPath: source.targetPath,
      };
    }
    if (actionType === 'poll') {
      const poll = payload as PollPayload;
      return {
        title: poll.title,
        summary: `确认后发起含 ${poll.options.length} 个选项的家庭投票`,
        changes: [
          { label: '选项', value: poll.options.map((option) => option.label).join('、') },
          { label: '规则', value: poll.voteMode === 'multiple' ? `最多选 ${poll.maxChoices ?? 2} 项` : '单选' },
          { label: '截止', value: poll.closesAt ?? '不设截止时间' },
        ],
        targetPath: '/polls',
      };
    }
    if (actionType === 'menu') {
      const menu = payload as MenuPayload;
      const existing = await this.dataSource.getRepository(Menu).findOneBy({
        householdId: user.householdId,
        date: menu.date,
        mealType: menu.mealType,
      });
      if (existing?.status === 'done') {
        throw new ConflictException('这餐已经结束，不能再生成点菜提案');
      }
      const dishIds = menu.items.map((item) => item.dishId);
      if (new Set(dishIds).size !== dishIds.length) {
        throw new ConflictException('一次点菜中不能重复选择同一道菜');
      }
      const dishes = await this.dataSource.getRepository(Dish).find({
        where: { householdId: user.householdId, id: In(dishIds), isActive: true },
      });
      if (dishes.length !== dishIds.length) {
        throw new NotFoundException('菜品不存在或已经停用');
      }
      const variants = await this.dataSource.getRepository(DishRecipeVariant).find({
        where: { householdId: user.householdId, dishId: In(dishIds), isArchived: false },
      });
      const names = menu.items.map((item) => {
        const dish = dishes.find((entry) => entry.id === item.dishId)!;
        const variant = item.recipeVariantId
          ? variants.find(
              (entry) =>
                entry.id === item.recipeVariantId && entry.dishId === item.dishId,
            )
          : variants.find((entry) => entry.dishId === item.dishId && entry.isDefault);
        if (!variant) {
          throw new NotFoundException(
            item.recipeVariantId ? '所选做法不存在' : '菜品缺少家庭默认做法',
          );
        }
        return `${dish.name}（${variant.name}）`;
      });
      return {
        title: `${menu.date} ${MEAL_LABELS[menu.mealType]}`,
        summary: `确认后向菜单加入 ${menu.items.length} 道菜`,
        changes: [{ label: '菜品与做法', value: names.join('、') }],
        targetPath: `/menu?date=${menu.date}`,
      };
    }
    if (actionType === 'finance') {
      const finance = payload as FinancePayload;
      const preview = await this.finance.previewTransaction(
        { ...finance, idempotencyKey: 'agent-preview' } as CreateFinanceTransactionDto,
        user,
      );
      const typeLabel = {
        expense: '支出',
        income: '收入',
        transfer: '转账',
      }[finance.type];
      return {
        title: `${typeLabel}：${finance.title}`,
        summary: '确认后写入家庭共享账本；财务流水不能编辑，只能通过反向流水撤销',
        changes: [
          { label: '金额', value: `¥${finance.amount.toFixed(2)}` },
          { label: '日期', value: finance.occurredOn },
          { label: '账户', value: preview.toAccount ? `${preview.account.name} → ${preview.toAccount.name}` : preview.account.name },
          { label: '分类', value: preview.category?.name ?? '账户间转账' },
        ],
        targetPath: '/finance',
        warning: '这是家庭共享账本，确认后所有有财务权限的家庭成员均可查看。',
      };
    }
    const shopping = payload as ShoppingPayload;
    return {
      title: `${shopping.date} 购物清单`,
      summary: `确认后新增 ${shopping.items.length} 个手动购物项，不会直接修改库存`,
      changes: [
        {
          label: '新增项目',
          value: shopping.items
            .map(
              (item) =>
                `${item.customName}${item.totalQty ? ` ${item.totalQty}${item.unit ?? ''}` : ''}`,
            )
            .join('、'),
        },
      ],
      targetPath: `/shopping?date=${shopping.date}`,
      warning: '自由名称购物项需要在购物页明确关联库存后，才能确认入库。',
    };
  }

  async executeWithinTransaction(
    proposal: AgentActionProposal,
    user: JwtUser,
    manager: EntityManager,
  ) {
    const payload = parsePayload(proposal.actionType, proposal.payload);
    if (proposal.actionType === 'task') {
      return {
        module: 'task',
        id: await this.tasks.createWithinTransaction(
          payload as CreateTaskDto,
          user,
          manager,
        ),
      };
    }
    if (proposal.actionType === 'reminder') {
      return {
        module: 'reminder',
        id: await this.reminders.createWithinTransaction(
          payload as CreateReminderDto,
          user,
          manager,
        ),
      };
    }
    if (proposal.actionType === 'poll') {
      return {
        module: 'poll',
        id: await this.polls.createWithinTransaction(
          payload as CreatePollDto,
          user,
          manager,
        ),
      };
    }
    if (proposal.actionType === 'menu') {
      const menu = payload as MenuPayload;
      return {
        module: 'menu',
        id: await this.menus.addItemsForAgent(
          menu.date,
          menu.mealType,
          { items: menu.items } as AddItemsDto,
          user,
          manager,
        ),
      };
    }
    if (proposal.actionType === 'finance') {
      const finance = payload as FinancePayload;
      const saved = await this.finance.createWithinTransaction(
        {
          ...finance,
          idempotencyKey: `agent-proposal:${proposal.id}`,
        } as CreateFinanceTransactionDto,
        user,
        manager,
        { sourceType: 'agent', sourceId: proposal.id },
      );
      return { module: 'finance', id: saved.id };
    }
    assertCapability(user, 'manage_shopping');
    const shopping = payload as ShoppingPayload;
    const saved: { id: string }[] = [];
    for (const item of shopping.items) {
      saved.push(
        await this.shopping.addManualWithinTransaction(
          { date: shopping.date, ...item } as ManualItemDto,
          user.householdId,
          manager,
        ),
      );
    }
    return { module: 'shopping', id: saved[0].id };
  }

  private async lockProposal(
    id: string,
    user: JwtUser,
    manager: EntityManager,
  ) {
    const proposal = await manager
      .getRepository(AgentActionProposal)
      .createQueryBuilder('proposal')
      .where('proposal.id = :id', { id })
      .andWhere('proposal.householdId = :householdId', {
        householdId: user.householdId,
      })
      .andWhere('proposal.createdByMemberId = :memberId', {
        memberId: user.memberId,
      })
      .andWhere('proposal.groupId IS NULL')
      .setLock('pessimistic_write')
      .getOne();
    if (!proposal) throw new NotFoundException('操作提案不存在');
    return proposal;
  }

  private async requireMember(memberId: string, user: JwtUser) {
    const member = await this.dataSource.getRepository(Member).findOneBy({
      id: memberId,
      householdId: user.householdId,
    });
    if (!member || member.disabledAt) {
      throw new NotFoundException('家庭成员不存在或已经停用');
    }
    return member;
  }

  private async markFailed(id: string, user: JwtUser, error: unknown) {
    await this.dataSource.transaction(async (manager) => {
      const proposal = await this.lockProposal(id, user, manager);
      if (proposal.status !== 'pending') return;
      proposal.status = 'failed';
      proposal.failureCode =
        error instanceof HttpException
          ? `PROPOSAL_EXECUTION_${error.getStatus()}`
          : 'PROPOSAL_EXECUTION_FAILED';
      proposal.failureMessage =
        error instanceof Error
          ? error.message.slice(0, 300)
          : '操作执行失败，请重新发起提案';
      proposal.version += 1;
      await manager.save(proposal);
    });
  }
}

export function isAgentProposalTool(
  toolName: string,
): toolName is AgentProposalToolName {
  return AGENT_PROPOSAL_TOOLS.includes(toolName as AgentProposalToolName);
}
