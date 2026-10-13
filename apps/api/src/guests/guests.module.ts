import { GuestMenuAttentionRule, GuestMealRequestAttentionRule, GuestsAttention } from './guests-attention';
import { TodayModule } from '../today/today.module';
import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { guestsFacade } from './guests.facade';
import {
  Guest,
  GuestInvitation,
  GuestMealRequest,
  GuestPollVote,
  GuestWifiProfile,
  HouseholdActivityLog,
  Member,
  Menu,
  MenuItem,
  Notification,
  Poll,
  PollOption,
  Visit,
  VisitGuest,
} from '../entities';
import { GuestsService } from './guests.service';
import { GuestsController } from './guests.controller';

/** 访客门面（J4 第四批：小管家读工具 get_upcoming_visits）。 */
@Injectable()
export class GuestsFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly guests: GuestsService,
    private readonly db: DataSource,
  ) {}

  onModuleInit() {
    this.registry.register('guests', guestsFacade(this.guests, this.db));
  }
}

@Module({
  imports: [TodayModule, TypeOrmModule.forFeature([Guest, Visit, VisitGuest, GuestInvitation, GuestMealRequest, GuestWifiProfile, GuestPollVote, Poll, PollOption, Menu, MenuItem, Member, Notification, HouseholdActivityLog])],
  controllers: [GuestsController],
  providers: [GuestsService, GuestMenuAttentionRule, GuestMealRequestAttentionRule, GuestsAttention, GuestsFacadeProvider],
  exports: [GuestsService],
})
export class GuestsModule {}
