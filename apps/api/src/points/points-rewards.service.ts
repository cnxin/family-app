import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { type CreateRewardBody, type UpdateRewardBody } from '@family/contracts';
import { Reward } from '../entities';
import { isHouseholdManager, normalizedText } from '@family/shared';

/** 积分商城的奖励目录：列表、新增、修改（J7.2 从 PointsService 拆出）。 */
@Injectable()
export class PointsRewardsService {
  constructor(
    @InjectRepository(Reward)
    private readonly rewards: Repository<Reward>,
    private readonly dataSource: DataSource,
  ) {}

  listRewards(includeInactive: boolean, user: JwtUser) {
    return this.rewards.find({
      where: {
        householdId: user.householdId,
        ...(!includeInactive || !isHouseholdManager(user) ? { isActive: true } : {}),
      },
      order: { isActive: 'DESC', cost: 'ASC', createdAt: 'ASC' },
    });
  }

  async createReward(dto: CreateRewardBody, user: JwtUser) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('奖励名称不能为空');
    const reward = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Reward);
      const duplicate = await repository.findOneBy({
        householdId: user.householdId,
        name,
      });
      if (duplicate) throw new ConflictException('家庭内已存在同名奖励');
      const saved = await repository.save(
        repository.create({
          householdId: user.householdId,
          name,
          description: normalizedText(dto.description),
          cost: dto.cost,
          isActive: true,
          createdById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'points',
        action: 'reward_created',
        summary: `${user.name}创建了奖励「${saved.name}」`,
        detail: `${saved.cost} 积分`,
        targetPath: '/points',
        metadata: { rewardId: saved.id, cost: saved.cost },
      });
      return saved;
    });
    return this.findReward(reward.id, user.householdId);
  }

  async updateReward(id: string, dto: UpdateRewardBody, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Reward);
      const reward = await repository
        .createQueryBuilder('reward')
        .where('reward.id = :id', { id })
        .andWhere('reward.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!reward) throw new NotFoundException('家庭奖励不存在');
      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) throw new BadRequestException('奖励名称不能为空');
        const duplicate = await repository
          .createQueryBuilder('other')
          .where('other.householdId = :householdId', {
            householdId: user.householdId,
          })
          .andWhere('other.name = :name', { name })
          .andWhere('other.id <> :id', { id })
          .getOne();
        if (duplicate) throw new ConflictException('家庭内已存在同名奖励');
        reward.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'description')) {
        reward.description = normalizedText(dto.description);
      }
      if (dto.cost !== undefined) reward.cost = dto.cost;
      if (dto.isActive !== undefined) reward.isActive = dto.isActive;
      await repository.save(reward);
      await recordActivity(manager, user, {
        module: 'points',
        action: 'reward_updated',
        summary: `${user.name}更新了奖励「${reward.name}」`,
        detail: reward.isActive ? `${reward.cost} 积分` : '已停用',
        targetPath: '/points',
        metadata: {
          rewardId: reward.id,
          cost: reward.cost,
          isActive: reward.isActive,
        },
      });
    });
    return this.findReward(id, user.householdId);
  }

  private async findReward(id: string, householdId: string) {
    const reward = await this.rewards.findOneBy({ id, householdId });
    if (!reward) throw new NotFoundException('家庭奖励不存在');
    return reward;
  }
}
