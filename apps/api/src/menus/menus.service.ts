import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
import { assertCapability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import { Dish, DishRecipeVariant, MealType, Menu, MenuEvent, MenuItem } from '../entities';
import { buildRecipeSnapshot, isUniqueViolation } from '@family/shared';
import { AddItemsDto } from './menus.dto';

export function assertMenuOpen(menu: Menu) {
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

  async listEvents(menuId: string, householdId: string) {
    const exists = await this.menus.existsBy({ id: menuId, householdId });
    if (!exists) throw new NotFoundException('菜单不存在');
    return this.events.find({
      where: { menuId, householdId },
      order: { createdAt: 'DESC' },
      take: 30,
    });
  }
}
