import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { assertCapability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import {
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
import { buildRecipeSnapshot, isUniqueViolation } from '@family/shared';
import { UpdateItemDto } from './menus.dto';
import { MenusService, assertMenuOpen } from './menus.service';

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

/** 厨房协作：改菜品状态、指派大厨、整餐完成（J7.2 从 MenusService 拆出）。 */
@Injectable()
export class MenuKitchenService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly menusService: MenusService,
  ) {}

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
    return this.menusService.findOrCreate(user.householdId, menuDate, menuMealType);
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
    return this.menusService.findOrCreate(user.householdId, menuDate, menuMealType);
  }
}
