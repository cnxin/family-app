import { Injectable, OnModuleInit, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { recipesFacade } from './recipes.facade';
import { DataSource } from 'typeorm';
import { Dish, DishRecipeVariant, MemberDishSkill } from '../entities';
import { RecipesService } from './recipes.service';
import { RecipesController } from './recipes.controller';

/** 把菜谱门面注册到内核（J4.1）：小管家搜菜谱走这里。 */
@Injectable()
export class RecipesFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    this.registry.register('recipes', recipesFacade(this.dataSource));
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Dish,
      DishRecipeVariant,
      MemberDishSkill,
    ]),
  ],
  controllers: [RecipesController],
  providers: [RecipesService, RecipesFacadeProvider],
})
export class RecipesModule {}
