import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Member, Menu, MenuEvent, MenuItem, Notification } from '../entities';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { menusFacade } from './menus.facade';
import { MenusService } from './menus.service';
import { MenusController } from './menus.controller';

/** 把点菜门面注册到内核（J1b）：购物生成清单读某天的菜从这里取，不再直读 Menu 实体。 */
@Injectable()
export class MenusFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly menus: MenusService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    this.registry.register('menus', menusFacade(this.menus, this.dataSource));
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Menu,
      MenuItem,
      MenuEvent,
      Member,
      Notification,
    ]),
  ],
  controllers: [MenusController],
  providers: [MenusService, MenusFacadeProvider],
  exports: [MenusService],
})
export class MenusModule {}
