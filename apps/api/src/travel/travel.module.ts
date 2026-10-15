import { Injectable, OnModuleInit, Module } from '@nestjs/common';
import { TravelChecklistAttentionRule, TravelAttention } from './travel-attention';
import { TodayModule } from '../today/today.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { travelFacade } from './travel.facade';
import {
  Member,
  Reminder,
  TravelChecklistItem,
  TravelOperation,
  TravelPackingTemplate,
  TravelPackingTemplateItem,
  TravelPlan,
  TravelTemplateApplication,
} from '../entities';
import { TravelService } from './travel.service';
import { TravelItemsService } from './travel-items.service';
import { TravelTemplatesService } from './travel-templates.service';
import { TravelController } from './travel.controller';

/** 把出行门面注册到内核（J4.1）：小管家读行程清单走这里。 */
@Injectable()
export class TravelFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly travel: TravelService,
  ) {}

  onModuleInit() {
    this.registry.register('travel', travelFacade(this.travel));
  }
}

@Module({
  imports: [
    TodayModule,
    TypeOrmModule.forFeature([
      TravelPlan,
      TravelChecklistItem,
      TravelPackingTemplate,
      TravelPackingTemplateItem,
      TravelTemplateApplication,
      TravelOperation,
      Reminder,
      Member,
    ]),
  ],
  controllers: [TravelController],
  providers: [TravelService, TravelItemsService, TravelTemplatesService, TravelChecklistAttentionRule, TravelAttention, TravelFacadeProvider],
  exports: [TravelService],
})
export class TravelModule {}
