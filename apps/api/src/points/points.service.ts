import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  type AdjustmentBody,
  type LedgerOperationBody,
  type LedgerQuery,
  type TaskCompletedHookPayload,
  type TaskUncompletedHookPayload,
} from '@family/contracts';
import { HouseholdTaskInstance, Member, PointsAccount, PointsLedger } from '../entities';
import { normalizedText } from '@family/shared';
import { applyDelta, reverseEntry, lockedTaskInstance } from './points.ledger';

@Injectable()
export class PointsService {
  constructor(
    @InjectRepository(PointsAccount)
    private readonly accounts: Repository<PointsAccount>,
    @InjectRepository(PointsLedger)
    private readonly ledger: Repository<PointsLedger>,
    private readonly dataSource: DataSource,
  ) {}

  async listAccounts(user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const members = await manager.getRepository(Member).find({
        where: { householdId: user.householdId },
        order: { createdAt: 'ASC' },
      });
      for (const member of members) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(PointsAccount)
          .values({
            householdId: user.householdId,
            memberId: member.id,
            balance: 0,
          })
          .orIgnore()
          .execute();
      }
    });
    return this.accounts.find({
      where: { householdId: user.householdId },
      order: { balance: 'DESC', createdAt: 'ASC' },
    });
  }

  listLedger(query: LedgerQuery, user: JwtUser) {
    return this.ledger.find({
      where: {
        householdId: user.householdId,
        ...(query.memberId ? { memberId: query.memberId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 100,
    });
  }

  async adjust(dto: AdjustmentBody, user: JwtUser) {
    if (dto.delta === 0) throw new BadRequestException('积分变化不能为 0');
    await this.requireMember(dto.memberId, user.householdId);
    const entry = await this.dataSource.transaction(async (manager) => {
      const saved = await applyDelta(manager, {
        householdId: user.householdId,
        memberId: dto.memberId,
        delta: dto.delta,
        type: dto.delta > 0 ? 'award' : 'adjustment',
        actor: user,
        sourceType: 'manual',
        sourceId: dto.memberId,
        idempotencyKey: dto.idempotencyKey,
        note: normalizedText(dto.note),
      });
      if (saved.created) {
        await recordActivity(manager, user, {
          module: 'points',
          action: dto.delta > 0 ? 'points_awarded' : 'points_adjusted',
          summary: `${user.name}${dto.delta > 0 ? '发放' : '扣减'}了 ${Math.abs(dto.delta)} 积分`,
          detail: normalizedText(dto.note),
          subjectMemberId: dto.memberId,
          targetPath: '/points',
          metadata: { ledgerId: saved.entry.id, delta: dto.delta },
        });
      }
      return saved.entry;
    });
    return this.findLedger(entry.id, user.householdId);
  }

  async reverseLedger(id: string, dto: LedgerOperationBody, user: JwtUser) {
    const entry = await this.dataSource.transaction(async (manager) => {
      const original = await manager.getRepository(PointsLedger).findOneBy({
        id,
        householdId: user.householdId,
      });
      if (!original) throw new NotFoundException('积分流水不存在');
      if (original.sourceType !== 'manual') {
        throw new BadRequestException('任务和兑换积分必须通过原业务操作撤销');
      }
      const reversed = await reverseEntry(
        manager,
        original,
        user,
        dto.idempotencyKey,
        normalizedText(dto.note),
      );
      if (reversed.created) {
        await recordActivity(manager, user, {
          module: 'points',
          action: 'points_reversed',
          summary: `${user.name}撤销了一笔 ${Math.abs(original.delta)} 积分流水`,
          detail: normalizedText(dto.note),
          subjectMemberId: original.memberId,
          targetPath: '/points',
          metadata: {
            ledgerId: reversed.entry.id,
            reversesLedgerId: original.id,
          },
        });
      }
      return reversed.entry;
    });
    return this.findLedger(entry.id, user.householdId);
  }

  /** 订阅 tasks.completed（J1b）：在任务的事务里记积分，并把积分版本 / 流水 id 记回任务实例。 */
  async awardTaskCompletion(manager: EntityManager, payload: TaskCompletedHookPayload) {
    if (payload.rewardPoints <= 0) return null;
    const user = payload.actor as JwtUser;
    const memberId = payload.memberId;
    const task = { id: payload.taskId, title: payload.title, rewardPoints: payload.rewardPoints };
    const instance = await lockedTaskInstance(manager, payload);
    const version = instance.pointsAwardVersion + 1;
    const result = await applyDelta(manager, {
      householdId: user.householdId,
      memberId,
      delta: task.rewardPoints,
      type: 'award',
      actor: user,
      sourceType: 'task',
      sourceId: `${task.id}:${instance.dueDate}`,
      idempotencyKey: `task:${instance.id}:award:${version}`,
      note: `完成任务「${task.title}」`,
    });
    instance.pointsAwardVersion = version;
    instance.pointsLedgerId = result.entry.id;
    await manager.getRepository(HouseholdTaskInstance).save(instance);
    await recordActivity(manager, user, {
      module: 'points',
      action: 'task_points_awarded',
      summary: `完成「${task.title}」获得 ${task.rewardPoints} 积分`,
      subjectMemberId: memberId,
      targetPath: `/tasks?date=${instance.dueDate}&taskId=${task.id}`,
      metadata: { taskId: task.id, ledgerId: result.entry.id },
    });
    return result.entry;
  }

  /** 订阅 tasks.uncompleted（J1b）：在任务的事务里冲销这次完成记的积分。 */
  async reverseTaskAward(manager: EntityManager, payload: TaskUncompletedHookPayload) {
    const user = payload.actor as JwtUser;
    const task = { id: payload.taskId, title: payload.title, rewardPoints: payload.rewardPoints };
    const instance = await lockedTaskInstance(manager, payload);
    if (!instance.pointsLedgerId) return null;
    const original = await manager.getRepository(PointsLedger).findOneByOrFail({
      id: instance.pointsLedgerId,
      householdId: user.householdId,
    });
    const result = await reverseEntry(
      manager,
      original,
      user,
      `task:${instance.id}:reverse:${instance.pointsAwardVersion}`,
      `恢复任务「${task.title}」并撤销积分`,
    );
    instance.pointsLedgerId = null;
    await manager.getRepository(HouseholdTaskInstance).save(instance);
    await recordActivity(manager, user, {
      module: 'points',
      action: 'task_points_reversed',
      summary: `恢复「${task.title}」并撤销 ${task.rewardPoints} 积分`,
      subjectMemberId: original.memberId,
      targetPath: `/tasks?date=${instance.dueDate}&taskId=${task.id}`,
      metadata: { taskId: task.id, ledgerId: result.entry.id },
    });
    return result.entry;
  }

  private async requireMember(memberId: string, householdId: string) {
    const member = await this.dataSource.getRepository(Member).findOneBy({
      id: memberId,
      householdId,
    });
    if (!member) throw new NotFoundException('家庭成员不存在');
    return member;
  }

  private async findLedger(id: string, householdId: string) {
    const entry = await this.ledger.findOneBy({ id, householdId });
    if (!entry) throw new NotFoundException('积分流水不存在');
    return entry;
  }
}
