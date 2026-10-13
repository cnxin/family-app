import { Injectable, OnModuleInit, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalendarEvent,
  Household,
  HouseholdMedia,
  MaintenancePlan,
  Menu,
  TravelPlan,
  Visit,
} from '../entities';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { calendarFacade } from './calendar.facade';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';

/** 把日历门面注册到内核（J1b）。 */
@Injectable()
export class CalendarFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly calendar: CalendarService,
  ) {}

  onModuleInit() {
    this.registry.register('calendar', calendarFacade(this.calendar));
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarEvent,
      Menu,
      HouseholdMedia,
      Visit,
      Household,
      MaintenancePlan,
      TravelPlan,
    ]),
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarFacadeProvider],
  exports: [CalendarService],
})
export class CalendarModule {}
