import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DataSource, EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { assertCapability, RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  Dish,
  DishRecipeVariant,
  MealType,
  Member,
  MemberDishSkill,
  Menu,
  MenuEvent,
  MenuItem,
  MenuItemStatus,
  Notification,
} from '../entities';
import { buildRecipeSnapshot } from '../recipes/recipe.snapshot';

export class OrderItemDto {
  @IsUUID()
  dishId: string;

  @IsOptional()
  @IsUUID()
  recipeVariantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class AddItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

class UpdateItemDto {
  @IsOptional()
  @IsIn(['pending', 'accepted', 'cooking', 'done', 'rejected'])
  status?: MenuItemStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsUUID()
  recipeVariantId?: string;
}

class AssignChefDto {
  @IsOptional()
  @IsUUID()
  chefId?: string | null;
}

class MenuDateRangeDto {
  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;
}

class MenuQueryDto {
  @IsISO8601()
  date: string;

  @IsOptional()
  @IsIn(['breakfast', 'lunch', 'dinner'])
  mealType?: MealType;
}

const ALLOWED_STATUS_TRANSITIONS: Record<
  MenuItemStatus,
  readonly MenuItemStatus[]
> = {
  pending: ['accepted', 'rejected'],
  accepted: ['cooking', 'rejected'],
  cooking: ['done', 'rejected'],
  done: [],
  rejected: ['pending'],
};

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: string;
    driverError?: { code?: string };
  };
  return candidate.code === '23505' || candidate.driverError?.code === '23505';
}

function assertMenuOpen(menu: Menu) {
  if (menu.status === 'done') {
    throw new ConflictException('这餐已经结束，历史菜单不能再修改');
  }
}

@Injectable()
export class MenusService {
  constructor(
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    @InjectRepository(MenuItem) private readonly items: Repository<MenuItem>,
    @InjectRepository(MenuEvent)
    private readonly events: Repository<MenuEvent>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly dataSource: DataSource,
  ) {}

  async findOrCreate(householdId: string, date: string, mealType: MealType) {
    return this.findOrCreateWithinTransaction(
      householdId,
      date,
      mealType,
      this.dataSource.manager,
    );
  }

  async findOrCreateWithinTransaction(
    householdId: string,
    date: string,
    mealType: MealType,
    manager: EntityManager,
  ) {
    const menus = manager.getRepository(Menu);
    let menu = await menus.findOne({
      where: { householdId, date, mealType },
      relations: { items: true },
      order: { items: { createdAt: 'ASC' } },
    });
    if (!menu) {
      await menus
        .createQueryBuilder()
        .insert()
        .values({ householdId, date, mealType })
        .orIgnore()
        .execute();
      menu = await menus.findOne({
        where: { householdId, date, mealType },
        relations: { items: true },
        order: { items: { createdAt: 'ASC' } },
      });
      if (!menu) throw new ConflictException('菜单创建失败，请重试');
    }
    return menu;
  }

  async listByDate(householdId: string, date: string) {
    const breakfast = await this.findOrCreate(householdId, date, 'breakfast');
    const lunch = await this.findOrCreate(householdId, date, 'lunch');
    const dinner = await this.findOrCreate(householdId, date, 'dinner');
    return [breakfast, lunch, dinner];
  }

  async listExistingByDate(householdId: string, date: string) {
    return this.menus.find({
      where: { householdId, date },
      relations: { items: true },
      order: { items: { createdAt: 'ASC' } },
    });
  }

  async listDateCounts(householdId: string, start: string, end: string) {
    const rows = await this.items
      .createQueryBuilder('item')
      .innerJoin('item.menu', 'menu')
      .select('menu.date', 'date')
      .addSelect('COUNT(item.id)', 'count')
      .where('menu.date >= :start', { start })
      .andWhere('menu.date <= :end', { end })
      .andWhere('menu.householdId = :householdId', { householdId })
      .andWhere('item.status != :rejected', { rejected: 'rejected' })
      .groupBy('menu.date')
      .orderBy('menu.date', 'ASC')
      .getRawMany<{ date: string | Date; count: string }>();

    return rows.map((row) => ({
      date:
        row.date instanceof Date
          ? row.date.toISOString().slice(0, 10)
          : String(row.date).slice(0, 10),
      count: Number(row.count),
    }));
  }

  async addItems(
    menuId: string,
    dto: AddItemsDto,
    householdId: string,
    userId: string,
  ) {
    try {
      const menu = await this.dataSource.transaction((manager) =>
        this.addItemsWithinTransaction(
          menuId,
          dto,
          householdId,
          userId,
          manager,
        ),
      );
      return this.findOrCreate(householdId, menu.date, menu.mealType);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isUniqueViolation(error)) {
        throw new ConflictException('这餐已经点过所选菜品，请勿重复提交');
      }
      throw error;
    }
  }

  async addItemsForAgent(
    date: string,
    mealType: MealType,
    dto: AddItemsDto,
    user: JwtUser,
    manager: EntityManager,
  ) {
    assertCapability(user, 'place_meal_order');
    const menu = await this.findOrCreateWithinTransaction(
      user.householdId,
      date,
      mealType,
      manager,
    );
    await this.addItemsWithinTransaction(
      menu.id,
      dto,
      user.householdId,
      user.memberId,
      manager,
    );
    return menu.id;
  }

  async addItemsWithinTransaction(
    menuId: string,
    dto: AddItemsDto,
    householdId: string,
    userId: string,
    manager: EntityManager,
  ) {
    const menus = manager.getRepository(Menu);
    const items = manager.getRepository(MenuItem);
    const dishes = manager.getRepository(Dish);
    const variants = manager.getRepository(DishRecipeVariant);
    const events = manager.getRepository(MenuEvent);
    const menu = await menus
      .createQueryBuilder('menu')
      .where('menu.id = :menuId', { menuId })
      .andWhere('menu.householdId = :householdId', { householdId })
      .setLock('pessimistic_write')
      .getOne();
    if (!menu) throw new NotFoundException('菜单不存在');
    assertMenuOpen(menu);

    const dishIds = [...new Set(dto.items.map((item) => item.dishId))];
    if (dishIds.length !== dto.items.length) {
      throw new ConflictException('一次点菜中不能重复选择同一道菜');
    }
    const dishCount = await dishes.countBy({
      id: In(dishIds),
      householdId,
    });
    if (dishCount !== dishIds.length) {
      throw new NotFoundException('菜品不存在');
    }
    const availableVariants = await variants.find({
      where: {
        householdId,
        dishId: In(dishIds),
        isArchived: false,
      },
    });
    const selectedRecipes = new Map<string, DishRecipeVariant>();
    for (const input of dto.items) {
      const selected = input.recipeVariantId
        ? availableVariants.find(
            (variant) =>
              variant.id === input.recipeVariantId &&
              variant.dishId === input.dishId,
          )
        : availableVariants.find(
            (variant) =>
              variant.dishId === input.dishId && variant.isDefault,
          );
      if (!selected) {
        throw new NotFoundException(
          input.recipeVariantId ? '所选做法不存在' : '菜品缺少家庭默认做法',
        );
      }
      selectedRecipes.set(input.dishId, selected);
    }

    const existing = await items.findOne({
      where: {
        menuId,
        dishId: In(dishIds),
        requestedById: userId,
        status: Not('rejected'),
      },
    });
    if (existing) {
      throw new ConflictException('这餐已经点过所选菜品，请勿重复提交');
    }

    const savedItems = await items.save(
      dto.items.map((item) => {
        const recipe = selectedRecipes.get(item.dishId)!;
        return items.create({
          menuId,
          dishId: item.dishId,
          requestedById: userId,
          note: item.note?.trim() || null,
          recipeVariantId: recipe.id,
          recipeSnapshot: buildRecipeSnapshot(recipe),
        });
      }),
    );
    await events.save(
      savedItems.map((item) =>
        events.create({
          householdId,
          menuId,
          menuItemId: item.id,
          actorId: userId,
          type: 'item_ordered',
          toValue: 'pending',
        }),
      ),
    );
    return menu;
  }

  async updateItem(id: string, dto: UpdateItemDto, user: JwtUser) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const items = manager.getRepository(MenuItem);
        const members = manager.getRepository(Member);
        const variants = manager.getRepository(DishRecipeVariant);
        const skills = manager.getRepository(MemberDishSkill);
        const events = manager.getRepository(MenuEvent);
        const notifications = manager.getRepository(Notification);
        const item = await items
          .createQueryBuilder('item')
          .innerJoinAndSelect('item.menu', 'menu')
          .innerJoinAndSelect('item.dish', 'dish')
          .where('item.id = :id', { id })
          .andWhere('menu.householdId = :householdId', {
            householdId: user.householdId,
          })
          .setLock('pessimistic_write')
          .getOne();
        if (!item) throw new NotFoundException('这道菜不在菜单里');
        assertMenuOpen(item.menu);

        const previousStatus = item.status;
        const nextStatus = dto.status ?? previousStatus;
        const reason = dto.reason?.trim() || null;
        if (dto.status != null) {
          assertCapability(user, 'update_meal_status');
          if (
            nextStatus !== previousStatus &&
            !ALLOWED_STATUS_TRANSITIONS[previousStatus].includes(nextStatus)
          ) {
            throw new ConflictException(
              `不能从「${previousStatus}」直接变更为「${nextStatus}」`,
            );
          }
          if (
            nextStatus === 'rejected' &&
            (previousStatus === 'accepted' || previousStatus === 'cooking') &&
            !reason
          ) {
            throw new BadRequestException('已接单或制作中的菜需要填写划掉原因');
          }
        }

        const assignmentProvided = Object.prototype.hasOwnProperty.call(
          dto,
          'assignedToId',
        );
        if (
          assignmentProvided &&
          nextStatus !== 'pending' &&
          nextStatus !== 'accepted' &&
          nextStatus !== 'rejected'
        ) {
          throw new ConflictException('只有待接单或已接单的菜可以调整认领人');
        }

        const previousAssigneeId = item.assignedToId;
        let nextAssigneeId = previousAssigneeId;
        let nextAssigneeName: string | null = null;
        if (assignmentProvided) {
          nextAssigneeId = dto.assignedToId ?? null;
          if (nextAssigneeId) {
            const assignee = await members.findOneBy({
              id: nextAssigneeId,
              householdId: user.householdId,
            });
            if (!assignee) throw new NotFoundException('认领成员不存在');
            nextAssigneeName = assignee.name;
          }
        }
        if (
          nextStatus === 'accepted' &&
          previousStatus === 'pending' &&
          !assignmentProvided
        ) {
          nextAssigneeId = user.memberId;
          nextAssigneeName = user.name;
        }
        if (nextStatus === 'rejected' || nextStatus === 'pending') {
          nextAssigneeId = null;
          nextAssigneeName = null;
        }

        const recipeProvided = Object.prototype.hasOwnProperty.call(
          dto,
          'recipeVariantId',
        );
        let nextRecipeId = recipeProvided ? dto.recipeVariantId : undefined;
        if (
          !recipeProvided &&
          nextAssigneeId &&
          nextAssigneeId !== previousAssigneeId
        ) {
          const skill = await skills.findOneBy({
            householdId: user.householdId,
            memberId: nextAssigneeId,
            dishId: item.dishId,
          });
          nextRecipeId = skill?.preferredRecipeId ?? undefined;
        }
        if (nextRecipeId) {
          const recipe = await variants.findOne({
            where: {
              id: nextRecipeId,
              householdId: user.householdId,
              dishId: item.dishId,
              isArchived: false,
            },
          });
          if (!recipe) throw new NotFoundException('所选做法不存在');
          item.recipeVariantId = recipe.id;
          item.recipeSnapshot = buildRecipeSnapshot(recipe);
        }

        const pendingEvents: MenuEvent[] = [];
        let rejectionEvent: MenuEvent | null = null;
        if (nextAssigneeId !== previousAssigneeId) {
          const previousAssignee = previousAssigneeId
            ? await members.findOneBy({
                id: previousAssigneeId,
                householdId: user.householdId,
              })
            : null;
          item.assignedToId = nextAssigneeId;
          pendingEvents.push(
            events.create({
              householdId: user.householdId,
              menuId: item.menuId,
              menuItemId: item.id,
              actorId: user.memberId,
              type: 'item_assigned',
              fromValue: previousAssignee?.name ?? null,
              toValue: nextAssigneeName,
            }),
          );
        }

        if (nextStatus !== previousStatus) {
          item.status = nextStatus;
          item.statusReason = nextStatus === 'rejected' ? reason : null;
          const statusEvent = events.create({
              householdId: user.householdId,
              menuId: item.menuId,
              menuItemId: item.id,
              actorId: user.memberId,
              recipientId:
                nextStatus === 'rejected' &&
                item.requestedById !== user.memberId
                  ? item.requestedById
                  : null,
              type: 'item_status_changed',
              fromValue: previousStatus,
              toValue: nextStatus,
              reason: nextStatus === 'rejected' ? reason : null,
            });
          pendingEvents.push(statusEvent);
          if (statusEvent.recipientId) rejectionEvent = statusEvent;
        }
        if (dto.note != null) {
          if (item.requestedById !== user.memberId) {
            throw new ForbiddenException('只能修改自己点菜的备注');
          }
          const note = dto.note.trim() || null;
          if (note !== item.note) {
            item.note = note;
            pendingEvents.push(
              events.create({
                householdId: user.householdId,
                menuId: item.menuId,
                menuItemId: item.id,
                actorId: user.memberId,
                type: 'item_note_changed',
              }),
            );
          }
        }

        await items.save(item);
        if (pendingEvents.length) await events.save(pendingEvents);
        if (rejectionEvent?.recipientId) {
          await notifications.save(
            notifications.create({
              householdId: user.householdId,
              recipientId: rejectionEvent.recipientId,
              module: 'menu',
              type: 'menu_item_rejected',
              sourceId: rejectionEvent.id,
              title: `${user.name} 划掉了你点的「${item.dish.name}」`.slice(
                0,
                160,
              ),
              body: reason,
              targetPath: `/kitchen?date=${item.menu.date}&mealType=${item.menu.mealType}`,
            }),
          );
        }
        const saved = await items.findOne({ where: { id } });
        if (!saved) throw new NotFoundException('这道菜不在菜单里');
        return saved;
      });
    } catch (error) {
      if (dto.status === 'pending' && isUniqueViolation(error)) {
        throw new ConflictException('已经重新点过这道菜，无需恢复旧记录');
      }
      throw error;
    }
  }

  async assignChef(menuId: string, chefId: string | null, user: JwtUser) {
    let menuDate = '';
    let menuMealType: MealType = 'dinner';
    await this.dataSource.transaction(async (manager) => {
      const menus = manager.getRepository(Menu);
      const members = manager.getRepository(Member);
      const events = manager.getRepository(MenuEvent);
      const menu = await menus
        .createQueryBuilder('menu')
        .where('menu.id = :menuId', { menuId })
        .andWhere('menu.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!menu) throw new NotFoundException('菜单不存在');
      assertMenuOpen(menu);
      menuDate = menu.date;
      menuMealType = menu.mealType;

      const previousChef = menu.chefId
        ? await members.findOneBy({
            id: menu.chefId,
            householdId: user.householdId,
          })
        : null;
      const nextChef = chefId
        ? await members.findOneBy({
            id: chefId,
            householdId: user.householdId,
          })
        : null;
      if (chefId && !nextChef) throw new NotFoundException('主厨成员不存在');
      if (menu.chefId === chefId) return;

      menu.chefId = chefId;
      await menus.save(menu);
      await events.save(
        events.create({
          householdId: user.householdId,
          menuId: menu.id,
          actorId: user.memberId,
          type: 'meal_chef_assigned',
          fromValue: previousChef?.name ?? null,
          toValue: nextChef?.name ?? null,
        }),
      );
    });
    return this.findOrCreate(user.householdId, menuDate, menuMealType);
  }

  async complete(menuId: string, user: JwtUser) {
    let menuDate = '';
    let menuMealType: MealType = 'dinner';
    await this.dataSource.transaction(async (manager) => {
      const menus = manager.getRepository(Menu);
      const items = manager.getRepository(MenuItem);
      const events = manager.getRepository(MenuEvent);
      const menu = await menus
        .createQueryBuilder('menu')
        .where('menu.id = :menuId', { menuId })
        .andWhere('menu.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!menu) throw new NotFoundException('菜单不存在');
      menuDate = menu.date;
      menuMealType = menu.mealType;
      if (menu.status === 'done') return;

      const menuItems = await items.findBy({ menuId });
      const activeItems = menuItems.filter((item) => item.status !== 'rejected');
      if (!activeItems.length) {
        throw new ConflictException('菜单里还没有可完成的菜');
      }
      if (activeItems.some((item) => item.status !== 'done')) {
        throw new ConflictException('还有菜没有上桌，暂时不能结束本餐');
      }

      menu.status = 'done';
      menu.completedAt = new Date();
      menu.completedById = user.memberId;
      await menus.save(menu);
      await events.save(
        events.create({
          householdId: user.householdId,
          menuId: menu.id,
          actorId: user.memberId,
          type: 'menu_completed',
          fromValue: 'open',
          toValue: 'done',
        }),
      );
    });
    return this.findOrCreate(user.householdId, menuDate, menuMealType);
  }

  async listEvents(menuId: string, householdId: string) {
    const exists = await this.menus.existsBy({ id: menuId, householdId });
    if (!exists) throw new NotFoundException('菜单不存在');
    return this.events.find({
      where: { menuId, householdId },
      order: { createdAt: 'DESC' },
      take: 30,
    });
  }

  listNotifications(user: JwtUser) {
    return this.events.find({
      where: {
        householdId: user.householdId,
        recipientId: user.memberId,
        readAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async markNotificationRead(id: string, user: JwtUser) {
    const event = await this.events.findOneBy({
      id,
      householdId: user.householdId,
      recipientId: user.memberId,
    });
    if (!event) throw new NotFoundException('提醒不存在');
    if (!event.readAt) {
      event.readAt = new Date();
      await this.events.save(event);
      await this.notifications.update(
        {
          householdId: user.householdId,
          recipientId: user.memberId,
          module: 'menu',
          sourceId: event.id,
          readAt: IsNull(),
        },
        { readAt: event.readAt },
      );
    }
    return event;
  }
}

@Controller()
export class MenusController {
  constructor(private readonly service: MenusService) {}

  @Get('menu-dates')
  dateCounts(@Query() query: MenuDateRangeDto, @CurrentUser() user: JwtUser) {
    return this.service.listDateCounts(user.householdId, query.start, query.end);
  }

  @Get('menus')
  async get(@CurrentUser() user: JwtUser, @Query() query: MenuQueryDto) {
    if (query.mealType) {
      return this.service.findOrCreate(
        user.householdId,
        query.date,
        query.mealType,
      );
    }
    return this.service.listByDate(user.householdId, query.date);
  }

  @Post('menus/:id/items')
  @RequireCapabilities('place_meal_order')
  addItems(
    @Param('id') id: string,
    @Body() dto: AddItemsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.addItems(id, dto, user.householdId, user.memberId);
  }

  @Patch('menu-items/:id')
  updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateItem(id, dto, user);
  }

  @Patch('menus/:id/chef')
  @RequireCapabilities('update_meal_status')
  assignChef(
    @Param('id') id: string,
    @Body() dto: AssignChefDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!Object.prototype.hasOwnProperty.call(dto, 'chefId')) {
      throw new BadRequestException('需要指定主厨成员或明确设为未指定');
    }
    return this.service.assignChef(id, dto.chefId ?? null, user);
  }

  @Post('menus/:id/complete')
  @RequireCapabilities('update_meal_status')
  complete(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.complete(id, user);
  }

  @Get('menus/:id/events')
  events(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.listEvents(id, user.householdId);
  }

  @Get('menu-notifications')
  notifications(@CurrentUser() user: JwtUser) {
    return this.service.listNotifications(user);
  }

  @Patch('menu-notifications/:id/read')
  markNotificationRead(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.markNotificationRead(id, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Menu,
      MenuItem,
      MenuEvent,
      Member,
      Notification,
    ]),
  ],
  controllers: [MenusController],
  providers: [MenusService],
  exports: [MenusService],
})
export class MenusModule {}
