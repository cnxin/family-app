import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { CalendarModule } from './calendar/calendar.module';
import { databaseOptions } from './database/database.options';
import { DishesModule } from './dishes/dishes.module';
import { InventoryModule } from './inventory/inventory.module';
import { MenusModule } from './menus/menus.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RecipesModule } from './recipes/recipes.module';
import { ShoppingModule } from './shopping/shopping.module';
import { SystemModule } from './system/system.module';
import { TasksModule } from './tasks/tasks.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseOptions()),
    AuthModule,
    CalendarModule,
    DishesModule,
    InventoryModule,
    MenusModule,
    NotificationsModule,
    RecipesModule,
    ShoppingModule,
    SystemModule,
    TasksModule,
    UploadModule,
  ],
})
export class AppModule {}
