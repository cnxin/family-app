import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { databaseOptions } from './database/database.options';
import { DishesModule } from './dishes/dishes.module';
import { InventoryModule } from './inventory/inventory.module';
import { MenusModule } from './menus/menus.module';
import { ShoppingModule } from './shopping/shopping.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseOptions()),
    AuthModule,
    DishesModule,
    InventoryModule,
    MenusModule,
    ShoppingModule,
    UploadModule,
  ],
})
export class AppModule {}
