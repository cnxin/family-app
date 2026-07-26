import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { DishesModule } from './dishes/dishes.module';
import { ALL_ENTITIES } from './entities';
import { MenusModule } from './menus/menus.module';
import { ShoppingModule } from './shopping/shopping.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5433),
      username: process.env.DB_USER || 'family',
      password: process.env.DB_PASSWORD || 'family123',
      database: process.env.DB_NAME || 'family_app',
      entities: ALL_ENTITIES,
      synchronize: true, // 家用项目，直接同步表结构
    }),
    AuthModule,
    DishesModule,
    MenusModule,
    ShoppingModule,
    UploadModule,
  ],
})
export class AppModule {}
