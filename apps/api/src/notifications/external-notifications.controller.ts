import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  NotificationChannelKind,
  NotificationDeliveryStatus,
  NotificationModule,
} from '../entities';
import {
  ExternalNotificationsService,
  UpdateNotificationChannelInput,
} from './external-notifications.service';

const MODULES: NotificationModule[] = [
  'menu',
  'task',
  'poll',
  'calendar',
  'reminder',
  'media',
  'guest',
  'points',
  'agent',
  'system',
];

class CreateNotificationChannelDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @IsIn(['webhook', 'ntfy'])
  kind: NotificationChannelKind;

  @IsString()
  @Length(8, 2000)
  endpoint: string;

  @IsOptional()
  @IsString()
  @Length(4, 2000)
  credential?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

class UpdateNotificationChannelDto implements UpdateNotificationChannelInput {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsIn(['webhook', 'ntfy'])
  kind?: NotificationChannelKind;

  @IsOptional()
  @IsString()
  @Length(8, 2000)
  endpoint?: string;

  @IsOptional()
  @IsString()
  @Length(4, 2000)
  credential?: string;

  @IsOptional()
  @IsBoolean()
  clearCredential?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

class UpdateNotificationPreferenceDto {
  @IsBoolean()
  isEnabled: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(MODULES, { each: true })
  modules: NotificationModule[];
}

class NotificationDeliveryQueryDto {
  @IsOptional()
  @IsIn(['pending', 'processing', 'retry_scheduled', 'sent', 'failed', 'all'])
  status?: NotificationDeliveryStatus | 'all';
}

@Controller()
export class ExternalNotificationsController {
  constructor(private readonly service: ExternalNotificationsService) {}

  @Get('notification-channels')
  listChannels(@CurrentUser() user: JwtUser) {
    return this.service.listChannels(user);
  }

  @RequireCapabilities('manage_integrations')
  @Post('notification-channels')
  createChannel(
    @Body() dto: CreateNotificationChannelDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createChannel(dto, user);
  }

  @RequireCapabilities('manage_integrations')
  @Patch('notification-channels/:id')
  updateChannel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationChannelDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateChannel(id, dto, user);
  }

  @RequireCapabilities('manage_integrations')
  @Delete('notification-channels/:id')
  deleteChannel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.deleteChannel(id, user);
  }

  @RequireCapabilities('manage_integrations')
  @Post('notification-channels/:id/test')
  testChannel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.testChannel(id, user);
  }

  @Put('notification-channels/:id/preference')
  updatePreference(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationPreferenceDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updatePreference(id, dto, user);
  }

  @Get('notification-deliveries')
  listDeliveries(
    @Query() query: NotificationDeliveryQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listDeliveries(query.status, user);
  }

  @Post('notification-deliveries/:id/retry')
  retryDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.retryDelivery(id, user);
  }
}
