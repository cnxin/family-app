import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  ActivityModule,
  HouseholdActivityLog,
  MealType,
  MenuEvent,
} from '../entities';

type ActivityScope = 'all' | 'members' | 'menus';

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
};

function menuEventSummary(event: MenuEvent) {
  const actor = event.actor.name;
  const dish = event.menuItem?.dish.name;
  if (event.type === 'item_ordered') return `${actor} 点了「${dish ?? '一道菜'}」`;
  if (event.type === 'item_assigned') {
    return event.toValue
      ? `${actor} 将「${dish ?? '这道菜'}」交给 ${event.toValue}`
      : `${actor} 取消了「${dish ?? '这道菜'}」的认领`;
  }
  if (event.type === 'item_note_changed') {
    return `${actor} 更新了「${dish ?? '这道菜'}」的备注`;
  }
  if (event.type === 'meal_chef_assigned') {
    return event.toValue
      ? `${actor} 将本餐主厨设为 ${event.toValue}`
      : `${actor} 清除了本餐主厨`;
  }
  if (event.type === 'menu_completed') return `${actor} 结束并锁定了本餐`;
  if (event.toValue === 'accepted') return `${actor} 认领了「${dish ?? '这道菜'}」`;
  if (event.toValue === 'cooking') return `${actor} 开始制作「${dish ?? '这道菜'}」`;
  if (event.toValue === 'done') return `${actor} 将「${dish ?? '这道菜'}」标记为上桌`;
  if (event.toValue === 'pending') return `${actor} 恢复了「${dish ?? '这道菜'}」`;
  if (event.toValue === 'rejected') return `${actor} 划掉了「${dish ?? '这道菜'}」`;
  return `${actor} 更新了菜单`;
}

@Injectable()
class ActivitiesService {
  constructor(
    @InjectRepository(HouseholdActivityLog)
    private readonly activityLogs: Repository<HouseholdActivityLog>,
    @InjectRepository(MenuEvent)
    private readonly menuEvents: Repository<MenuEvent>,
  ) {}

  async list(user: JwtUser, scope: ActivityScope, limit: number) {
    const includeManagement = scope !== 'menus';
    const includeMenus = scope !== 'members';
    const [logs, menuEvents] = await Promise.all([
      includeManagement
        ? this.activityLogs.find({
            where:
              scope === 'members'
                ? {
                    householdId: user.householdId,
                    module: In<ActivityModule>(['member', 'invitation']),
                  }
                : { householdId: user.householdId },
            order: { createdAt: 'DESC' },
            take: limit,
          })
        : [],
      includeMenus
        ? this.menuEvents.find({
            where: { householdId: user.householdId },
            relations: {
              actor: true,
              menu: true,
              menuItem: { dish: true },
            },
            order: { createdAt: 'DESC' },
            take: limit,
          })
        : [],
    ]);

    return [
      ...logs.map((log) => ({
        id: `activity:${log.id}`,
        module: log.module,
        action: log.action,
        summary: log.summary,
        detail: log.detail,
        actor: log.actor
          ? {
              id: log.actor.id,
              name: log.actor.name,
              avatarEmoji: log.actor.avatarEmoji,
            }
          : { id: null, name: log.actorName, avatarEmoji: '👤' },
        subjectMemberId: log.subjectMemberId,
        targetPath:
          user.role === 'member' &&
          (log.module === 'member' || log.module === 'invitation')
            ? null
            : log.targetPath,
        metadata: log.metadata,
        occurredAt: log.createdAt,
      })),
      ...menuEvents.map((event) => ({
        id: `menu:${event.id}`,
        module: 'menu' as const,
        action: event.type,
        summary: menuEventSummary(event),
        detail: event.reason,
        actor: {
          id: event.actor.id,
          name: event.actor.name,
          avatarEmoji: event.actor.avatarEmoji,
        },
        subjectMemberId: event.recipientId,
        targetPath: `/kitchen?date=${event.menu.date}&mealType=${event.menu.mealType}`,
        metadata: {
          date: event.menu.date,
          mealType: event.menu.mealType,
          mealLabel: MEAL_LABELS[event.menu.mealType],
        },
        occurredAt: event.createdAt,
      })),
    ]
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() -
          new Date(left.occurredAt).getTime(),
      )
      .slice(0, limit);
  }
}

@Controller()
class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get('activities')
  list(
    @CurrentUser() user: JwtUser,
    @Query('scope') scopeValue?: string,
    @Query('limit') limitValue?: string,
  ) {
    const scope = scopeValue ?? 'all';
    if (!['all', 'members', 'menus'].includes(scope)) {
      throw new BadRequestException('活动范围无效');
    }
    const parsedLimit = Number(limitValue ?? 50);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('活动数量必须在 1 到 100 之间');
    }
    return this.activities.list(user, scope as ActivityScope, parsedLimit);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([HouseholdActivityLog, MenuEvent])],
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
})
export class ActivitiesModule {}
