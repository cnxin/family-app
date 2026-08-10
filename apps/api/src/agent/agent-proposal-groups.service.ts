import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { DataSource, EntityManager, In } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  AgentActionProposal,
  AgentActionType,
  AgentProposalGroup,
  AgentProposalGroupEvent,
  AgentProposalGroupEventOperation,
  AgentProposalGroupStatus,
  AgentRun,
  AgentSetting,
  Member,
} from '../entities';
import {
  AgentProposalsService,
  SingleAgentProposalToolName,
} from './agent-proposals.service';

const groupInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(400),
    steps: z
      .array(
        z
          .object({
            type: z.enum(['task', 'reminder', 'poll', 'menu', 'shopping']),
          })
          .passthrough(),
      )
      .min(1)
      .max(8),
  })
  .passthrough();

const TOOL_BY_TYPE: Record<AgentActionType, SingleAgentProposalToolName> = {
  task: 'propose_task',
  reminder: 'propose_reminder',
  poll: 'propose_poll',
  menu: 'propose_menu',
  shopping: 'propose_shopping_items',
};

function untrustedText(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    : value;
}

function actingUser(member: Member, user: JwtUser): JwtUser {
  return {
    ...user,
    memberId: member.id,
    householdId: member.householdId,
    name: member.name,
    role: member.role,
  };
}

@Injectable()
export class AgentProposalGroupsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly proposals: AgentProposalsService,
  ) {}

  async createFromRun(
    input: Record<string, unknown>,
    run: AgentRun,
    user: JwtUser,
  ) {
    const parsed = groupInputSchema.safeParse({
      ...input,
      title: untrustedText(input.title),
      summary: untrustedText(input.summary),
    });
    if (!parsed.success) {
      throw new BadRequestException('多步骤提案参数无效，子项必须为 1 到 8 个');
    }
    if (
      run.householdId !== user.householdId ||
      run.requestedByMemberId !== user.memberId ||
      run.status !== 'running' ||
      !run.allowedTools.includes('propose_plan')
    ) {
      throw new ForbiddenException('本次运行不能创建多步骤提案');
    }

    return this.dataSource.transaction(async (manager) => {
      const groups = manager.getRepository(AgentProposalGroup);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
      const group = await groups.save(
        groups.create({
          householdId: user.householdId,
          conversationId: run.conversationId,
          runId: run.id,
          requestedByMemberId: user.memberId,
          title: parsed.data.title,
          summary: parsed.data.summary,
          status: 'pending',
          confirmedByMemberId: null,
          confirmedAt: null,
          rejectedAt: null,
          expiresAt,
          version: 1,
        }),
      );

      const steps: AgentActionProposal[] = [];
      for (const [index, rawStep] of parsed.data.steps.entries()) {
        const {
          type,
          memberId: _memberId,
          householdId: _householdId,
          groupId: _groupId,
          stepOrder: _stepOrder,
          runId: _runId,
          ...payload
        } = rawStep;
        steps.push(
          await this.proposals.createGroupedWithinTransaction(
            TOOL_BY_TYPE[type],
            payload,
            run,
            user,
            group.id,
            index + 1,
            expiresAt,
            manager,
          ),
        );
      }
      const event = await this.writeEvent(
        manager,
        group,
        user.memberId,
        'created',
        steps.length,
      );
      return this.present(group, steps, [event]);
    });
  }

  async list(status: AgentProposalGroupStatus | undefined, user: JwtUser) {
    await this.expireDue(user);
    const groups = await this.dataSource.getRepository(AgentProposalGroup).find({
      where: {
        householdId: user.householdId,
        requestedByMemberId: user.memberId,
        ...(status ? { status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return this.presentMany(groups);
  }

  async detail(id: string, user: JwtUser) {
    await this.expireOneIfDue(id, user);
    const group = await this.requireGroup(id, user);
    return (await this.presentMany([group]))[0];
  }

  async confirm(id: string, expectedVersion: number, user: JwtUser) {
    let executionStarted = false;
    let expired = false;
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const group = await this.lockGroup(id, user, manager);
        if (group.status === 'confirmed') return this.presentLocked(group, manager);
        if (group.status === 'expired') {
          expired = true;
          return this.presentLocked(group, manager);
        }
        if (group.status !== 'pending') return this.presentLocked(group, manager);
        if (group.version !== expectedVersion) {
          throw new ConflictException('多步骤提案已更新，请刷新后重试');
        }
        const steps = await this.stepsForGroup(group.id, manager, true);
        if (group.expiresAt.getTime() <= Date.now()) {
          await this.markExpired(group, steps, user.memberId, manager);
          expired = true;
          return this.presentLocked(group, manager);
        }

        const member = await manager.getRepository(Member).findOneBy({
          id: user.memberId,
          householdId: user.householdId,
        });
        if (!member || member.disabledAt) {
          throw new ForbiddenException('发起成员已停用');
        }
        const setting = await manager.getRepository(AgentSetting).findOneBy({
          householdId: user.householdId,
        });
        const requiredTools = [
          'propose_plan',
          ...steps.map((step) => TOOL_BY_TYPE[step.actionType]),
        ];
        if (
          !setting?.enabled ||
          requiredTools.some(
            (tool) => !setting.proposalToolsEnabled.includes(tool),
          )
        ) {
          throw new ForbiddenException('这个多步骤提案工具已被家庭管理员停用');
        }
        const sourceRun = await manager.getRepository(AgentRun).findOneBy({
          id: group.runId,
          householdId: user.householdId,
          requestedByMemberId: user.memberId,
        });
        if (!sourceRun) throw new NotFoundException('提案来源运行不存在');

        /*
         * A7.5 deliberately confirms the whole plan atomically. Allowing partial
         * confirmation would require dependency checks between steps (for example,
         * shopping derived from a menu) and a separate cross-row state machine. The
         * first release instead asks the member to revise the plan in conversation.
         */
        executionStarted = true;
        const current = actingUser(member, user);
        for (const step of steps) {
          step.status = 'confirmed';
          step.confirmedByMemberId = member.id;
          step.confirmedAt = new Date();
          step.version += 1;
          await manager.save(step);

          const executed = await this.proposals.executeWithinTransaction(
            step,
            current,
            manager,
          );
          step.status = 'executed';
          step.executedAt = new Date();
          step.resultModule = executed.module;
          step.resultId = executed.id;
          step.failureCode = null;
          step.failureMessage = null;
          step.version += 1;
          await manager.save(step);
        }
        group.status = 'confirmed';
        group.confirmedByMemberId = member.id;
        group.confirmedAt = new Date();
        group.version += 1;
        await manager.save(group);
        await this.writeEvent(
          manager,
          group,
          member.id,
          'confirmed',
          steps.length,
        );
        return this.presentLocked(group, manager);
      });
      if (expired) {
        throw new ConflictException('多步骤提案已过期，不能确认；可以选择全部放弃');
      }
      return result;
    } catch (error) {
      if (executionStarted) {
        await this.markFailed(id, user);
        throw new ConflictException('整组提案执行失败，未产生任何业务变更');
      }
      throw error;
    }
  }

  async reject(id: string, expectedVersion: number, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const group = await this.lockGroup(id, user, manager);
      if (group.status === 'rejected') return this.presentLocked(group, manager);
      if (!['pending', 'expired'].includes(group.status)) {
        return this.presentLocked(group, manager);
      }
      if (group.version !== expectedVersion) {
        throw new ConflictException('多步骤提案已更新，请刷新后重试');
      }
      const steps = await this.stepsForGroup(group.id, manager, true);
      group.status = 'rejected';
      group.rejectedAt = new Date();
      group.version += 1;
      await manager.save(group);
      for (const step of steps) {
        if (step.status === 'pending' || step.status === 'expired') {
          step.status = 'rejected';
          step.version += 1;
          await manager.save(step);
        }
      }
      await this.writeEvent(
        manager,
        group,
        user.memberId,
        'rejected',
        steps.length,
      );
      return this.presentLocked(group, manager);
    });
  }

  private async presentMany(groups: AgentProposalGroup[]) {
    if (!groups.length) return [];
    const groupIds = groups.map((group) => group.id);
    const [steps, events] = await Promise.all([
      this.dataSource.getRepository(AgentActionProposal).find({
        where: { groupId: In(groupIds) },
        order: { stepOrder: 'ASC' },
      }),
      this.dataSource.getRepository(AgentProposalGroupEvent).find({
        where: { groupId: In(groupIds) },
        order: { createdAt: 'ASC' },
      }),
    ]);
    return groups.map((group) =>
      this.present(
        group,
        steps.filter((step) => step.groupId === group.id),
        events.filter((event) => event.groupId === group.id),
      ),
    );
  }

  private async presentLocked(group: AgentProposalGroup, manager: EntityManager) {
    const [steps, events] = await Promise.all([
      this.stepsForGroup(group.id, manager),
      manager.getRepository(AgentProposalGroupEvent).find({
        where: { groupId: group.id },
        order: { createdAt: 'ASC' },
      }),
    ]);
    return this.present(group, steps, events);
  }

  private present(
    group: AgentProposalGroup,
    steps: AgentActionProposal[],
    events: AgentProposalGroupEvent[],
  ) {
    return {
      id: group.id,
      conversationId: group.conversationId,
      runId: group.runId,
      requestedByMemberId: group.requestedByMemberId,
      title: group.title,
      summary: group.summary,
      status: group.status,
      confirmedByMemberId: group.confirmedByMemberId,
      confirmedAt: group.confirmedAt,
      rejectedAt: group.rejectedAt,
      expiresAt: group.expiresAt,
      version: group.version,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      steps: steps.map((step) => ({
        ...this.proposals.present(step),
        groupId: step.groupId,
        stepOrder: step.stepOrder,
      })),
      events: events.map((event) => ({
        id: event.id,
        operation: event.operation,
        actorMemberId: event.actorMemberId,
        stepCount: event.stepCount,
        createdAt: event.createdAt,
      })),
    };
  }

  private async requireGroup(id: string, user: JwtUser) {
    const group = await this.dataSource.getRepository(AgentProposalGroup).findOneBy({
      id,
      householdId: user.householdId,
      requestedByMemberId: user.memberId,
    });
    if (!group) throw new NotFoundException('多步骤提案不存在');
    return group;
  }

  private async lockGroup(id: string, user: JwtUser, manager: EntityManager) {
    const group = await manager
      .getRepository(AgentProposalGroup)
      .createQueryBuilder('proposalGroup')
      .where('proposalGroup.id = :id', { id })
      .andWhere('proposalGroup.householdId = :householdId', {
        householdId: user.householdId,
      })
      .andWhere('proposalGroup.requestedByMemberId = :memberId', {
        memberId: user.memberId,
      })
      .setLock('pessimistic_write')
      .getOne();
    if (!group) throw new NotFoundException('多步骤提案不存在');
    return group;
  }

  private stepsForGroup(
    groupId: string,
    manager: EntityManager,
    lock = false,
  ) {
    const query = manager
      .getRepository(AgentActionProposal)
      .createQueryBuilder('proposal')
      .where('proposal.groupId = :groupId', { groupId })
      .orderBy('proposal.stepOrder', 'ASC');
    if (lock) query.setLock('pessimistic_write');
    return query.getMany();
  }

  private writeEvent(
    manager: EntityManager,
    group: AgentProposalGroup,
    actorMemberId: string,
    operation: AgentProposalGroupEventOperation,
    stepCount: number,
  ) {
    const events = manager.getRepository(AgentProposalGroupEvent);
    return events.save(
      events.create({
        householdId: group.householdId,
        groupId: group.id,
        actorMemberId,
        operation,
        stepCount,
      }),
    );
  }

  private async markExpired(
    group: AgentProposalGroup,
    steps: AgentActionProposal[],
    actorMemberId: string,
    manager: EntityManager,
  ) {
    group.status = 'expired';
    group.version += 1;
    await manager.save(group);
    for (const step of steps) {
      if (step.status === 'pending') {
        step.status = 'expired';
        step.version += 1;
        await manager.save(step);
      }
    }
    await this.writeEvent(
      manager,
      group,
      actorMemberId,
      'expired',
      steps.length,
    );
  }

  private async expireDue(user: JwtUser) {
    const due = await this.dataSource
      .getRepository(AgentProposalGroup)
      .createQueryBuilder('proposalGroup')
      .select('proposalGroup.id', 'id')
      .where('proposalGroup.householdId = :householdId', {
        householdId: user.householdId,
      })
      .andWhere('proposalGroup.requestedByMemberId = :memberId', {
        memberId: user.memberId,
      })
      .andWhere('proposalGroup.status = :status', { status: 'pending' })
      .andWhere('proposalGroup.expiresAt <= now()')
      .limit(50)
      .getRawMany<{ id: string }>();
    for (const entry of due) await this.expireOneIfDue(entry.id, user);
  }

  private async expireOneIfDue(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const group = await this.lockGroup(id, user, manager);
      if (
        group.status !== 'pending' ||
        group.expiresAt.getTime() > Date.now()
      ) {
        return;
      }
      const steps = await this.stepsForGroup(group.id, manager, true);
      await this.markExpired(group, steps, user.memberId, manager);
    });
  }

  private async markFailed(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const group = await this.lockGroup(id, user, manager);
      if (group.status !== 'pending') return;
      const steps = await this.stepsForGroup(group.id, manager, true);
      group.status = 'failed';
      group.version += 1;
      await manager.save(group);
      for (const step of steps) {
        step.status = 'failed';
        step.failureCode = 'PROPOSAL_GROUP_EXECUTION_FAILED';
        step.failureMessage = '整组提案执行失败，未产生任何业务变更';
        step.version += 1;
        await manager.save(step);
      }
      await this.writeEvent(
        manager,
        group,
        user.memberId,
        'failed',
        steps.length,
      );
    });
  }
}
