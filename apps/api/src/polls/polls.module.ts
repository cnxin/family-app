import { Injectable, OnModuleInit, Module } from '@nestjs/common';
import { PollAttentionRule, PollsAttention } from './polls-attention';
import { TodayModule } from '../today/today.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { pollsFacade } from './polls.facade';
import { HouseholdMedia, Member, Notification, Poll, PollOption, PollVote } from '../entities';
import { PollsService } from './polls.service';
import { PollsController } from './polls.controller';

/** 把投票门面注册到内核（J4.1）：小管家投票提案确认后走这里建投票。 */
@Injectable()
export class PollsFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly polls: PollsService,
  ) {}

  onModuleInit() {
    this.registry.register('polls', pollsFacade(this.polls));
  }
}

@Module({
  imports: [
    TodayModule,
    TypeOrmModule.forFeature([
      Poll,
      PollOption,
      PollVote,
      Member,
      Notification,
      HouseholdMedia,
    ]),
  ],
  controllers: [PollsController],
  providers: [PollsService, PollAttentionRule, PollsAttention, PollsFacadeProvider],
  exports: [PollsService],
})
export class PollsModule {}
