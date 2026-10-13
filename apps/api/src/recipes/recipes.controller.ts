import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { UpsertRecipeVariantDto, UpsertDishSkillDto } from './recipes.dto';
import { RecipesService } from './recipes.service';

@Controller()
export class RecipesController {
  constructor(private readonly service: RecipesService) {}

  @Get('recipes')
  list(@CurrentUser() user: JwtUser) {
    return this.service.list(user);
  }

  @Get('recipes/:dishId')
  get(@Param('dishId') dishId: string, @CurrentUser() user: JwtUser) {
    return this.service.get(dishId, user);
  }

  @Post('dishes/:dishId/recipe-variants')
  createVariant(
    @Param('dishId') dishId: string,
    @Body() dto: UpsertRecipeVariantDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createVariant(dishId, dto, user);
  }

  @Patch('recipe-variants/:id')
  updateVariant(
    @Param('id') id: string,
    @Body() dto: UpsertRecipeVariantDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateVariant(id, dto, user);
  }

  @Delete('recipe-variants/:id')
  archiveVariant(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.archiveVariant(id, user);
  }

  @Post('member-dish-skills')
  upsertSkill(
    @Body() dto: UpsertDishSkillDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.upsertSkill(dto, user);
  }

  @Delete('members/:memberId/dish-skills/:dishId')
  removeSkill(
    @Param('memberId') memberId: string,
    @Param('dishId') dishId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.removeSkill(memberId, dishId, user);
  }
}
