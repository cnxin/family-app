import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { DataSource, MoreThan, Not, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  Dish,
  DishRecipeVariant,
  InventoryBatch,
  InventoryItem,
  MemberDishSkill,
  MenuItem,
  Poll,
  PollOption,
  SmartMenuCandidate,
  SmartMenuPlan,
} from '../entities';
import { MenusModule, MenusService } from '../menus/menus.module';
import { PollsModule, PollsService } from '../polls/polls.module';

class CreateSmartMenuPlanDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startsOn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  idempotencyKey: string;
}

class CreateSmartMenuPollDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  closesAt?: string | null;
}

class AdoptSmartMenuPlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  idempotencyKey: string;
}

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.floor(
    (new Date(`${end}T00:00:00.000Z`).getTime() -
      new Date(`${start}T00:00:00.000Z`).getTime()) /
      86_400_000,
  );
}

function assertDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('菜单提案开始日期无效');
  }
  const current = today();
  if (value < current) throw new BadRequestException('菜单提案不能从过去开始');
  if (value > addDays(current, 60)) {
    throw new BadRequestException('菜单提案最多提前 60 天创建');
  }
}

@Injectable()
export class SmartMenuService {
  constructor(
    @InjectRepository(SmartMenuPlan)
    private readonly plans: Repository<SmartMenuPlan>,
    @InjectRepository(SmartMenuCandidate)
    private readonly candidates: Repository<SmartMenuCandidate>,
    private readonly dataSource: DataSource,
    private readonly pollsService: PollsService,
    private readonly menusService: MenusService,
  ) {}

  async list(householdId: string) {
    const rows = await this.plans.find({
      where: { householdId },
      relations: {
        candidates: { dish: true, recipeVariant: true },
        poll: { options: { votes: true } },
      },
      order: { createdAt: 'DESC', candidates: { sortOrder: 'ASC' } },
      take: 10,
    });
    return rows.map((plan) => this.present(plan));
  }

  async create(dto: CreateSmartMenuPlanDto, user: JwtUser) {
    assertDate(dto.startsOn);
    const idempotencyKey = dto.idempotencyKey.trim();
    if (!idempotencyKey) throw new BadRequestException('需要提供幂等键');
    const id = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `smart-menu:${user.householdId}:${idempotencyKey}`,
      ]);
      const existing = await manager.getRepository(SmartMenuPlan).findOneBy({
        householdId: user.householdId,
        idempotencyKey,
      });
      if (existing) {
        if (existing.startsOn !== dto.startsOn) {
          throw new ConflictException('这个幂等键已经用于其他菜单周次');
        }
        return existing.id;
      }

      const scored = await this.scoreCandidates(user.householdId);
      if (scored.length < 2) {
        throw new ConflictException(
          '至少需要两道包含家庭默认做法的菜，才能生成智能菜单候选',
        );
      }
      const plan = await manager.getRepository(SmartMenuPlan).save(
        manager.getRepository(SmartMenuPlan).create({
          householdId: user.householdId,
          startsOn: dto.startsOn,
          endsOn: addDays(dto.startsOn, 6),
          status: 'draft',
          pollId: null,
          createdById: user.memberId,
          idempotencyKey,
          adoptedById: null,
          adoptedAt: null,
        }),
      );
      await manager.getRepository(SmartMenuCandidate).save(
        scored.slice(0, 7).map((candidate, sortOrder) =>
          manager.getRepository(SmartMenuCandidate).create({
            householdId: user.householdId,
            planId: plan.id,
            dishId: candidate.dish.id,
            recipeVariantId: candidate.recipeVariant.id,
            targetDate: addDays(dto.startsOn, sortOrder),
            mealType: 'dinner',
            score: candidate.score,
            reasons: candidate.reasons,
            expiringIngredients: candidate.expiringIngredients,
            pollOptionId: null,
            adoptedMenuId: null,
            sortOrder,
          }),
        ),
      );
      await recordActivity(manager, user, {
        module: 'menu',
        action: 'smart_menu_plan_created',
        summary: `${user.name} 生成了 ${dto.startsOn} 起的一周菜单候选`,
        detail: null,
        targetPath: '/shopping?view=smart-menu',
        metadata: { planId: plan.id, startsOn: plan.startsOn },
      });
      return plan.id;
    });
    return this.get(id, user.householdId);
  }

  async createPoll(
    id: string,
    dto: CreateSmartMenuPollDto,
    user: JwtUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `smart-menu-poll:${user.householdId}:${id}`,
      ]);
      const plan = await manager
        .getRepository(SmartMenuPlan)
        .createQueryBuilder('plan')
        .where('plan.id = :id', { id })
        .andWhere('plan.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!plan) throw new NotFoundException('智能菜单提案不存在');
      if (plan.status === 'adopted') {
        throw new ConflictException('这个菜单提案已经采纳');
      }
      if (plan.pollId) return;
      const candidates = await manager.getRepository(SmartMenuCandidate).find({
        where: { householdId: user.householdId, planId: plan.id },
        relations: { dish: true },
        order: { sortOrder: 'ASC' },
      });
      if (candidates.length < 2) {
        throw new ConflictException('智能菜单候选不足，不能发起投票');
      }
      const pollId = await this.pollsService.createWithinTransaction(
        {
          title: `${plan.startsOn} 起的一周晚餐吃什么`,
          description: '请选择本周想吃的菜。投票结束后仍需明确采纳，才会写入菜单。',
          category: 'meal',
          voteMode: 'multiple',
          maxChoices: Math.min(7, candidates.length),
          closesAt: dto.closesAt,
          options: candidates.map((candidate) => ({
            label: candidate.dish.name,
            description: candidate.reasons.slice(0, 2).join('；'),
          })),
        },
        user,
        manager,
      );
      const options = await manager.getRepository(PollOption).find({
        where: { pollId },
        order: { sortOrder: 'ASC' },
      });
      if (options.length !== candidates.length) {
        throw new ConflictException('投票候选创建不完整，请重试');
      }
      for (let index = 0; index < candidates.length; index += 1) {
        candidates[index].pollOptionId = options[index].id;
      }
      await manager.getRepository(SmartMenuCandidate).save(candidates);
      plan.pollId = pollId;
      plan.status = 'voting';
      await manager.getRepository(SmartMenuPlan).save(plan);
      await recordActivity(manager, user, {
        module: 'menu',
        action: 'smart_menu_poll_created',
        summary: `${user.name} 为一周菜单候选发起了家庭投票`,
        detail: null,
        targetPath: `/polls?pollId=${pollId}`,
        metadata: { planId: plan.id, pollId },
      });
    });
    return this.get(id, user.householdId);
  }

  async adopt(id: string, dto: AdoptSmartMenuPlanDto, user: JwtUser) {
    if (!dto.idempotencyKey.trim()) throw new BadRequestException('需要提供幂等键');
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `smart-menu-adopt:${user.householdId}:${id}`,
      ]);
      const plan = await manager
        .getRepository(SmartMenuPlan)
        .createQueryBuilder('plan')
        .where('plan.id = :id', { id })
        .andWhere('plan.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!plan) throw new NotFoundException('智能菜单提案不存在');
      if (plan.status === 'adopted') return;
      if (plan.status !== 'voting' || !plan.pollId) {
        throw new ConflictException('请先把菜单候选发起家庭投票');
      }
      const poll = await manager.getRepository(Poll).findOne({
        where: { id: plan.pollId, householdId: user.householdId },
        relations: { options: { votes: true } },
        order: { options: { sortOrder: 'ASC' } },
      });
      if (!poll) throw new NotFoundException('关联投票不存在');
      const pollClosed =
        poll.status === 'closed' ||
        Boolean(poll.closesAt && poll.closesAt.getTime() <= Date.now());
      if (!pollClosed) throw new ConflictException('请先结束家庭投票再采纳结果');

      const candidates = await manager.getRepository(SmartMenuCandidate).find({
        where: { householdId: user.householdId, planId: plan.id },
        relations: { dish: true },
        order: { sortOrder: 'ASC' },
      });
      const votesByOption = new Map(
        poll.options.map((option) => [option.id, option.votes?.length ?? 0]),
      );
      const selected = candidates
        .filter(
          (candidate) =>
            candidate.pollOptionId &&
            (votesByOption.get(candidate.pollOptionId) ?? 0) > 0,
        )
        .sort(
          (a, b) =>
            (votesByOption.get(b.pollOptionId!) ?? 0) -
              (votesByOption.get(a.pollOptionId!) ?? 0) ||
            b.score - a.score ||
            a.sortOrder - b.sortOrder,
        )
        .slice(0, 7);
      if (!selected.length) {
        throw new ConflictException('投票还没有有效选择，暂时不能采纳菜单');
      }

      for (let index = 0; index < selected.length; index += 1) {
        const candidate = selected[index];
        const targetDate = addDays(plan.startsOn, index);
        const menu = await this.menusService.findOrCreateWithinTransaction(
          user.householdId,
          targetDate,
          candidate.mealType,
          manager,
        );
        const existing = await manager.getRepository(MenuItem).findOne({
          where: {
            menuId: menu.id,
            dishId: candidate.dishId,
            status: Not('rejected'),
          },
        });
        if (!existing) {
          await this.menusService.addItemsWithinTransaction(
            menu.id,
            {
              items: [
                {
                  dishId: candidate.dishId,
                  recipeVariantId: candidate.recipeVariantId,
                  note: '来自智能菜单投票结果',
                },
              ],
            },
            user.householdId,
            user.memberId,
            manager,
          );
        }
        candidate.targetDate = targetDate;
        candidate.adoptedMenuId = menu.id;
      }
      await manager.getRepository(SmartMenuCandidate).save(selected);
      plan.status = 'adopted';
      plan.adoptedById = user.memberId;
      plan.adoptedAt = new Date();
      await manager.getRepository(SmartMenuPlan).save(plan);
      await recordActivity(manager, user, {
        module: 'menu',
        action: 'smart_menu_plan_adopted',
        summary: `${user.name} 采纳了 ${selected.length} 道投票菜品到一周菜单`,
        detail: null,
        targetPath: `/kitchen?date=${plan.startsOn}`,
        metadata: {
          planId: plan.id,
          pollId: plan.pollId,
          menuIds: selected.map((candidate) => candidate.adoptedMenuId),
        },
      });
    });
    return this.get(id, user.householdId);
  }

  private async scoreCandidates(householdId: string) {
    const [dishes, inventory, batches, skills, history] = await Promise.all([
      this.dataSource.getRepository(Dish).find({
        where: { householdId, isActive: true },
        relations: {
          recipeVariants: { ingredients: { ingredient: true } },
        },
        order: { name: 'ASC' },
      }),
      this.dataSource.getRepository(InventoryItem).find({
        where: { householdId },
      }),
      this.dataSource.getRepository(InventoryBatch).find({
        where: { householdId, quantity: MoreThan('0') },
      }),
      this.dataSource.getRepository(MemberDishSkill).find({
        where: { householdId },
      }),
      this.dataSource
        .getRepository(MenuItem)
        .createQueryBuilder('item')
        .innerJoin('item.menu', 'menu')
        .select('item.dishId', 'dishId')
        .addSelect('MAX(menu.date)', 'lastDate')
        .where('menu.householdId = :householdId', { householdId })
        .andWhere('item.status != :rejected', { rejected: 'rejected' })
        .groupBy('item.dishId')
        .getRawMany<{ dishId: string; lastDate: string | Date }>(),
    ]);
    const inventoryByIngredientUnit = new Map(
      inventory
        .filter((item) => item.ingredientId)
        .map((item) => [`${item.ingredientId}|${item.unit}`, item]),
    );
    const batchesByItem = new Map<string, InventoryBatch[]>();
    for (const batch of batches) {
      batchesByItem.set(batch.inventoryItemId, [
        ...(batchesByItem.get(batch.inventoryItemId) ?? []),
        batch,
      ]);
    }
    const lastDateByDish = new Map(
      history.map((row) => [
        row.dishId,
        row.lastDate instanceof Date
          ? row.lastDate.toISOString().slice(0, 10)
          : String(row.lastDate).slice(0, 10),
      ]),
    );
    const current = today();

    return dishes
      .flatMap((dish) => {
        const recipeVariant = dish.recipeVariants?.find(
          (variant) => variant.isDefault && !variant.isArchived,
        );
        if (!recipeVariant || !recipeVariant.ingredients.length) return [];
        let score = 0;
        let availableCount = 0;
        let missingCount = 0;
        const expiringIngredients: SmartMenuCandidate['expiringIngredients'] = [];
        for (const ingredient of recipeVariant.ingredients) {
          const inventoryItem = inventoryByIngredientUnit.get(
            `${ingredient.ingredientId}|${ingredient.unit}`,
          );
          if (
            inventoryItem &&
            Number(inventoryItem.quantity) >= Number(ingredient.quantity)
          ) {
            availableCount += 1;
            score += 4;
          } else {
            missingCount += 1;
            score -= 5;
          }
          if (!inventoryItem) continue;
          const expiring = (batchesByItem.get(inventoryItem.id) ?? [])
            .filter((batch) => {
              if (!batch.expiresOn) return false;
              const remaining = daysBetween(current, batch.expiresOn);
              return remaining >= 0 && remaining <= 14;
            })
            .sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!))[0];
          if (expiring) {
            const daysRemaining = daysBetween(current, expiring.expiresOn!);
            expiringIngredients.push({
              ingredientId: ingredient.ingredientId,
              name: ingredient.ingredient.name,
              expiresOn: expiring.expiresOn!,
              daysRemaining,
            });
            score += daysRemaining <= 3 ? 30 : 20;
          }
        }
        const reasons: string[] = [];
        if (expiringIngredients.length) {
          reasons.push(
            `优先使用${expiringIngredients
              .slice(0, 2)
              .map((ingredient) => ingredient.name)
              .join('、')}等临期食材`,
          );
        }
        if (availableCount && missingCount === 0) {
          reasons.push('家中主要食材已经齐备');
        } else if (availableCount) {
          reasons.push(`${availableCount} 项主要食材已有库存`);
        }
        const lastDate = lastDateByDish.get(dish.id);
        if (!lastDate) {
          score += 14;
          reasons.push('近期菜单中没有安排过');
        } else {
          const daysSince = daysBetween(lastDate, current);
          if (daysSince >= 30) {
            score += 10;
            reasons.push('已经一个月没有安排');
          } else if (daysSince >= 14) {
            score += 5;
            reasons.push('近两周没有重复');
          } else if (daysSince < 7) {
            score -= 12;
          }
        }
        const skillLevels = skills
          .filter((skill) => skill.dishId === dish.id)
          .map((skill) => skill.level);
        if (skillLevels.includes('signature')) {
          score += 8;
          reasons.push('家中有人擅长这道菜');
        } else if (skillLevels.includes('can_cook')) {
          score += 4;
          reasons.push('家中已有成员会做');
        }
        if (dish.difficulty <= 2) score += 3;
        if (!reasons.length) reasons.push('根据家庭菜谱与菜单间隔推荐');
        return [
          { dish, recipeVariant, score, reasons, expiringIngredients },
        ];
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.dish.name.localeCompare(b.dish.name, 'zh-CN'),
      );
  }

  private async get(id: string, householdId: string) {
    const plan = await this.plans.findOne({
      where: { id, householdId },
      relations: {
        candidates: { dish: true, recipeVariant: true },
        poll: { options: { votes: true } },
      },
      order: { candidates: { sortOrder: 'ASC' }, poll: { options: { sortOrder: 'ASC' } } },
    });
    if (!plan) throw new NotFoundException('智能菜单提案不存在');
    return this.present(plan);
  }

  private present(plan: SmartMenuPlan) {
    const pollStatus = plan.poll
      ? plan.poll.status === 'closed' ||
        Boolean(plan.poll.closesAt && plan.poll.closesAt.getTime() <= Date.now())
        ? 'closed'
        : 'open'
      : null;
    const votesByOption = new Map(
      (plan.poll?.options ?? []).map((option) => [
        option.id,
        option.votes?.length ?? 0,
      ]),
    );
    const candidates = [...(plan.candidates ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((candidate) => ({
        ...candidate,
        voteCount: candidate.pollOptionId
          ? (votesByOption.get(candidate.pollOptionId) ?? 0)
          : 0,
      }));
    return {
      ...plan,
      candidates,
      pollStatus,
      canCreatePoll: plan.status === 'draft' && candidates.length >= 2,
      canAdopt:
        plan.status === 'voting' &&
        pollStatus === 'closed' &&
        candidates.some((candidate) => candidate.voteCount > 0),
      adoptedCount: candidates.filter((candidate) => candidate.adoptedMenuId).length,
    };
  }
}

@Controller('smart-menu-plans')
export class SmartMenuController {
  constructor(private readonly service: SmartMenuService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.service.list(user.householdId);
  }

  @Post()
  @RequireCapabilities('place_meal_order')
  create(@Body() dto: CreateSmartMenuPlanDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Post(':id/poll')
  @RequireCapabilities('place_meal_order')
  createPoll(
    @Param('id') id: string,
    @Body() dto: CreateSmartMenuPollDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createPoll(id, dto, user);
  }

  @Post(':id/adopt')
  @RequireCapabilities('place_meal_order')
  adopt(
    @Param('id') id: string,
    @Body() dto: AdoptSmartMenuPlanDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.adopt(id, dto, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Dish,
      DishRecipeVariant,
      InventoryBatch,
      InventoryItem,
      MemberDishSkill,
      MenuItem,
      Poll,
      PollOption,
      SmartMenuCandidate,
      SmartMenuPlan,
    ]),
    MenusModule,
    PollsModule,
  ],
  controllers: [SmartMenuController],
  providers: [SmartMenuService],
})
export class SmartMenuModule {}
