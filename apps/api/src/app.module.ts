import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivitiesModule } from './activities/activities.module';
import { AuthModule } from './auth/auth.module';
import { CalendarModule } from './calendar/calendar.module';
import { databaseOptions } from './database/database.options';
import { DishesModule } from './dishes/dishes.module';
import { InventoryModule } from './inventory/inventory.module';
import { MenusModule } from './menus/menus.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PollsModule } from './polls/polls.module';
import { RecipesModule } from './recipes/recipes.module';
import { RemindersModule } from './reminders/reminders.module';
import { ShoppingModule } from './shopping/shopping.module';
import { SystemModule } from './system/system.module';
import { TasksModule } from './tasks/tasks.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseOptions()),
    ActivitiesModule,
    AuthModule,
    CalendarModule,
    DishesModule,
    InventoryModule,
    MenusModule,
    NotificationsModule,
    PollsModule,
    RecipesModule,
    RemindersModule,
    ShoppingModule,
    SystemModule,
    TasksModule,
    UploadModule,
  ],
})
export class AppModule {}
