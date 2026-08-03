import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivitiesModule } from './activities/activities.module';
import { AssetsModule } from './assets/assets.module';
import { AuthModule } from './auth/auth.module';
import { CalendarModule } from './calendar/calendar.module';
import { databaseOptions } from './database/database.options';
import { DishesModule } from './dishes/dishes.module';
import { GuestsModule } from './guests/guests.module';
import { InventoryModule } from './inventory/inventory.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MenusModule } from './menus/menus.module';
import { MediaModule } from './media/media.module';
import { MemoriesModule } from './memories/memories.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PollsModule } from './polls/polls.module';
import { PointsModule } from './points/points.module';
import { RecipesModule } from './recipes/recipes.module';
import { RemindersModule } from './reminders/reminders.module';
import { ShoppingModule } from './shopping/shopping.module';
import { SystemModule } from './system/system.module';
import { TasksModule } from './tasks/tasks.module';
import { TravelModule } from './travel/travel.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseOptions()),
    ActivitiesModule,
    AssetsModule,
    AuthModule,
    CalendarModule,
    DishesModule,
    GuestsModule,
    InventoryModule,
    KnowledgeModule,
    MenusModule,
    MediaModule,
    MemoriesModule,
    NotificationsModule,
    PollsModule,
    PointsModule,
    RecipesModule,
    RemindersModule,
    ShoppingModule,
    SystemModule,
    TasksModule,
    TravelModule,
    UploadModule,
  ],
})
export class AppModule {}
