import {
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsIn, IsOptional } from 'class-validator';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  MenuEvent,
  Notification,
  NotificationModule as SourceModule,
} from '../entities';

class NotificationQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  includeRead?: 'true' | 'false';

  @IsOptional()
  @IsIn(['menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'guest', 'system'])
  module?: SourceModule;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly dataSource: DataSource,
  ) {}

  list(query: NotificationQueryDto, user: JwtUser) {
    return this.notifications.find({
      where: {
        householdId: user.householdId,
        recipientId: user.memberId,
        ...(query.includeRead === 'true' ? {} : { readAt: IsNull() }),
        ...(query.module ? { module: query.module } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.includeRead === 'true' ? 50 : 30,
    });
  }

  async markRead(id: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const notifications = manager.getRepository(Notification);
      const notification = await notifications.findOneBy({
        id,
        householdId: user.householdId,
        recipientId: user.memberId,
      });
      if (!notification) throw new NotFoundException('通知不存在');
      if (!notification.readAt) {
        notification.readAt = new Date();
        await notifications.save(notification);
        if (notification.module === 'menu' && notification.sourceId) {
          await manager.getRepository(MenuEvent).update(
            {
              id: notification.sourceId,
              householdId: user.householdId,
              recipientId: user.memberId,
              readAt: IsNull(),
            },
            { readAt: notification.readAt },
          );
        }
      }
      return notification;
    });
  }

  async markAllRead(user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const notifications = manager.getRepository(Notification);
      const unreadMenuNotifications = await notifications.find({
        select: { sourceId: true },
        where: {
          householdId: user.householdId,
          recipientId: user.memberId,
          module: 'menu',
          readAt: IsNull(),
        },
      });
      const readAt = new Date();
      const result = await notifications.update(
        {
          householdId: user.householdId,
          recipientId: user.memberId,
          readAt: IsNull(),
        },
        { readAt },
      );
      const menuEventIds = unreadMenuNotifications.flatMap((notification) =>
        notification.sourceId ? [notification.sourceId] : [],
      );
      if (menuEventIds.length) {
        await manager.getRepository(MenuEvent).update(
          {
            id: In(menuEventIds),
            householdId: user.householdId,
            recipientId: user.memberId,
            readAt: IsNull(),
          },
          { readAt },
        );
      }
      return { updated: result.affected ?? 0 };
    });
  }
}

@Controller()
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('notifications')
  list(@Query() query: NotificationQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Patch('notifications/read-all')
  markAllRead(@CurrentUser() user: JwtUser) {
    return this.service.markAllRead(user);
  }

  @Patch('notifications/:id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.markRead(id, user);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Notification, MenuEvent])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
