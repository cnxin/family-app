import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  Dish,
  DishIngredient,
  DishRecipeVariant,
  DishRecipeVariantIngredient,
  DishRecipeVariantLink,
  DishRecipeVariantStep,
  DishSkillLevel,
  Ingredient,
  Member,
  MemberDishSkill,
} from '../entities';

class VariantIngredientDto {
  @IsOptional()
  @IsUUID()
  ingredientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsString()
  @MaxLength(32)
  unit: string;
}

class VariantStepDto {
  @IsString()
  @MaxLength(2000)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;
}

class VariantLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsString()
  @MaxLength(1000)
  url: string;
}

class UpsertRecipeVariantDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUUID()
  authorMemberId?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  estMinutes?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantIngredientDto)
  ingredients?: VariantIngredientDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantStepDto)
  steps?: VariantStepDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantLinkDto)
  referenceLinks?: VariantLinkDto[];
}

class UpsertDishSkillDto {
  @IsUUID()
  dishId: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsUUID()
  preferredRecipeId?: string | null;

  @IsOptional()
  @IsIn(['learning', 'can_cook', 'signature'])
  level?: DishSkillLevel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

function isHouseholdAdmin(user: JwtUser) {
  return user.role === 'owner' || user.role === 'admin';
}

@Injectable()
export class RecipesService {
  constructor(
    @InjectRepository(Dish) private readonly dishes: Repository<Dish>,
    @InjectRepository(DishRecipeVariant)
    private readonly variants: Repository<DishRecipeVariant>,
    @InjectRepository(MemberDishSkill)
    private readonly skills: Repository<MemberDishSkill>,
    private readonly dataSource: DataSource,
  ) {}

  async list(user: JwtUser) {
    const dishes = await this.dishes.find({
      where: { householdId: user.householdId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    return this.enrichDishes(dishes, user);
  }

  async get(dishId: string, user: JwtUser) {
    const dish = await this.dishes.findOneBy({
      id: dishId,
      householdId: user.householdId,
      isActive: true,
    });
    if (!dish) throw new NotFoundException('菜品不存在');
    return (await this.enrichDishes([dish], user))[0];
  }

  private async enrichDishes(dishes: Dish[], user: JwtUser) {
    if (!dishes.length) return [];
    const dishIds = dishes.map((dish) => dish.id);
    const [variants, skills] = await Promise.all([
      this.variants.find({
        where: {
          householdId: user.householdId,
          dishId: In(dishIds),
          isArchived: false,
        },
        order: { isDefault: 'DESC', createdAt: 'ASC' },
      }),
      this.skills.find({
        where: { householdId: user.householdId, dishId: In(dishIds) },
        order: { createdAt: 'ASC' },
      }),
    ]);
    return dishes.map((dish) => ({
      ...dish,
      recipeVariants: variants
        .filter((variant) => variant.dishId === dish.id)
        .map((variant) => this.presentVariant(variant, user)),
      skills: skills.filter((skill) => skill.dishId === dish.id),
    }));
  }

  private presentVariant(variant: DishRecipeVariant, user: JwtUser) {
    variant.steps?.sort((left, right) => left.position - right.position);
    variant.referenceLinks?.sort(
      (left, right) => left.position - right.position,
    );
    variant.ingredients?.sort((left, right) =>
      left.ingredient.name.localeCompare(right.ingredient.name, 'zh'),
    );
    return {
      ...variant,
      canManage:
        isHouseholdAdmin(user) ||
        (!variant.isDefault && variant.authorMemberId === user.memberId),
    };
  }

  async createVariant(
    dishId: string,
    dto: UpsertRecipeVariantDto,
    user: JwtUser,
  ) {
    if (!dto.name?.trim()) throw new BadRequestException('做法名称不能为空');
    return this.dataSource.transaction(async (manager) => {
      const dishes = manager.getRepository(Dish);
      const variants = manager.getRepository(DishRecipeVariant);
      const dish = await dishes.findOneBy({
        id: dishId,
        householdId: user.householdId,
        isActive: true,
      });
      if (!dish) throw new NotFoundException('菜品不存在');
      const authorMemberId = dto.authorMemberId ?? user.memberId;
      await this.assertMember(authorMemberId, user, manager);
      if (authorMemberId !== user.memberId && !isHouseholdAdmin(user)) {
        throw new ForbiddenException('只能为自己创建个人做法');
      }
      if (dto.isDefault && !isHouseholdAdmin(user)) {
        throw new ForbiddenException('只有家庭管理员可以更改默认做法');
      }
      if (dto.isDefault) {
        await variants.update(
          { householdId: user.householdId, dishId, isDefault: true },
          { isDefault: false },
        );
      }
      const variant = await variants.save(
        variants.create({
          householdId: user.householdId,
          dishId,
          authorMemberId,
          name: dto.name!.trim(),
          isDefault: dto.isDefault ?? false,
          note: dto.note?.trim() || null,
          estMinutes: dto.estMinutes ?? null,
        }),
      );
      await this.replaceContent(variant, dto, user.householdId, manager);
      if (variant.isDefault) {
        await this.syncLegacyDefault(variant, manager);
      } else {
        await this.ensureAuthorSkill(variant, manager);
      }
      return this.loadVariant(variant.id, user, manager);
    });
  }

  async updateVariant(
    id: string,
    dto: UpsertRecipeVariantDto,
    user: JwtUser,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const variants = manager.getRepository(DishRecipeVariant);
      const variant = await variants
        .createQueryBuilder('variant')
        .where('variant.id = :id', { id })
        .andWhere('variant.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!variant || variant.isArchived) {
        throw new NotFoundException('做法不存在');
      }
      this.assertVariantManageable(variant, user);
      if (dto.authorMemberId !== undefined) {
        const authorMemberId = dto.authorMemberId ?? user.memberId;
        await this.assertMember(authorMemberId, user, manager);
        if (authorMemberId !== user.memberId && !isHouseholdAdmin(user)) {
          throw new ForbiddenException('不能将做法关联给其他成员');
        }
        variant.authorMemberId = authorMemberId;
      }
      if (dto.isDefault === true && !variant.isDefault) {
        if (!isHouseholdAdmin(user)) {
          throw new ForbiddenException('只有家庭管理员可以更改默认做法');
        }
        await variants.update(
          {
            householdId: user.householdId,
            dishId: variant.dishId,
            isDefault: true,
          },
          { isDefault: false },
        );
        variant.isDefault = true;
      }
      if (dto.name !== undefined) {
        if (!dto.name.trim()) throw new BadRequestException('做法名称不能为空');
        variant.name = dto.name.trim();
      }
      if (dto.note !== undefined) variant.note = dto.note?.trim() || null;
      if (dto.estMinutes !== undefined) {
        variant.estMinutes = dto.estMinutes ?? null;
      }
      await variants.save(variant);
      await this.replaceContent(variant, dto, user.householdId, manager);
      if (variant.isDefault) await this.syncLegacyDefault(variant, manager);
      return this.loadVariant(variant.id, user, manager);
    });
  }

  async archiveVariant(id: string, user: JwtUser) {
    const variant = await this.variants.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!variant || variant.isArchived) throw new NotFoundException('做法不存在');
    this.assertVariantManageable(variant, user);
    if (variant.isDefault) throw new ConflictException('家庭默认做法不能归档');
    variant.isArchived = true;
    await this.variants.save(variant);
    await this.skills.update(
      { householdId: user.householdId, preferredRecipeId: variant.id },
      { preferredRecipeId: null },
    );
    return { id, archived: true as const };
  }

  async upsertSkill(dto: UpsertDishSkillDto, user: JwtUser) {
    const memberId = dto.memberId ?? user.memberId;
    if (memberId !== user.memberId && !isHouseholdAdmin(user)) {
      throw new ForbiddenException('只能维护自己会做的菜');
    }
    const [member, dish] = await Promise.all([
      this.dataSource.getRepository(Member).findOneBy({
        id: memberId,
        householdId: user.householdId,
      }),
      this.dishes.findOneBy({
        id: dto.dishId,
        householdId: user.householdId,
        isActive: true,
      }),
    ]);
    if (!member) throw new NotFoundException('家庭成员不存在');
    if (!dish) throw new NotFoundException('菜品不存在');
    if (dto.preferredRecipeId) {
      const recipe = await this.variants.findOneBy({
        id: dto.preferredRecipeId,
        householdId: user.householdId,
        dishId: dto.dishId,
        isArchived: false,
      });
      if (!recipe) throw new NotFoundException('常用做法不存在');
    }
    let skill = await this.skills.findOneBy({
      householdId: user.householdId,
      memberId,
      dishId: dto.dishId,
    });
    if (!skill) {
      skill = this.skills.create({
        householdId: user.householdId,
        memberId,
        dishId: dto.dishId,
      });
    }
    if (dto.preferredRecipeId !== undefined) {
      skill.preferredRecipeId = dto.preferredRecipeId ?? null;
    }
    if (dto.level !== undefined) skill.level = dto.level;
    if (dto.note !== undefined) skill.note = dto.note?.trim() || null;
    return this.skills.save(skill);
  }

  async removeSkill(memberId: string, dishId: string, user: JwtUser) {
    if (memberId !== user.memberId && !isHouseholdAdmin(user)) {
      throw new ForbiddenException('只能维护自己会做的菜');
    }
    const result = await this.skills.delete({
      householdId: user.householdId,
      memberId,
      dishId,
    });
    if (!result.affected) throw new NotFoundException('会做的菜记录不存在');
    return { dishId, memberId, removed: true as const };
  }

  private assertVariantManageable(variant: DishRecipeVariant, user: JwtUser) {
    if (isHouseholdAdmin(user)) return;
    if (variant.isDefault) {
      throw new ForbiddenException('只有家庭管理员可以维护默认做法');
    }
    if (variant.authorMemberId !== user.memberId) {
      throw new ForbiddenException('只能维护自己的做法');
    }
  }

  private async assertMember(
    memberId: string,
    user: JwtUser,
    manager: EntityManager,
  ) {
    const member = await manager.getRepository(Member).findOneBy({
      id: memberId,
      householdId: user.householdId,
    });
    if (!member) throw new NotFoundException('家庭成员不存在');
  }

  private async resolveIngredient(
    dto: VariantIngredientDto,
    householdId: string,
    manager: EntityManager,
  ) {
    const ingredients = manager.getRepository(Ingredient);
    if (dto.ingredientId) {
      const ingredient = await ingredients.findOneBy({
        id: dto.ingredientId,
        householdId,
      });
      if (!ingredient) throw new NotFoundException('食材不存在');
      return ingredient;
    }
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('食材名称不能为空');
    const existing = await ingredients.findOneBy({ householdId, name });
    if (existing) return existing;
    return ingredients.save(
      ingredients.create({
        householdId,
        name,
        category: (dto.category as Ingredient['category']) || '其他',
        defaultUnit: dto.unit.trim() || '份',
      }),
    );
  }

  private async replaceContent(
    variant: DishRecipeVariant,
    dto: UpsertRecipeVariantDto,
    householdId: string,
    manager: EntityManager,
  ) {
    if (dto.steps !== undefined) {
      const steps = manager.getRepository(DishRecipeVariantStep);
      await steps.delete({ variantId: variant.id });
      await steps.save(
        dto.steps
          .map((step, index) => ({ step, index }))
          .filter(({ step }) => step.text.trim())
          .map(({ step, index }) =>
            steps.create({
              variantId: variant.id,
              position: index + 1,
              text: step.text.trim(),
              imageUrl: step.imageUrl?.trim() || null,
            }),
          ),
      );
    }
    if (dto.referenceLinks !== undefined) {
      const links = manager.getRepository(DishRecipeVariantLink);
      await links.delete({ variantId: variant.id });
      await links.save(
        dto.referenceLinks
          .map((link, index) => ({ link, index }))
          .filter(({ link }) => link.url.trim())
          .map(({ link, index }) =>
            links.create({
              variantId: variant.id,
              position: index + 1,
              title: link.title?.trim() || null,
              url: link.url.trim(),
            }),
          ),
      );
    }
    if (dto.ingredients !== undefined) {
      const ingredientItems = manager.getRepository(
        DishRecipeVariantIngredient,
      );
      await ingredientItems.delete({ variantId: variant.id });
      const merged = new Map<
        string,
        { ingredient: Ingredient; quantity: number; unit: string }
      >();
      for (const input of dto.ingredients) {
        const ingredient = await this.resolveIngredient(
          input,
          householdId,
          manager,
        );
        const unit = input.unit.trim();
        if (!unit) throw new BadRequestException('食材单位不能为空');
        const key = `${ingredient.id}|${unit}`;
        const current = merged.get(key);
        merged.set(key, {
          ingredient,
          unit,
          quantity: (current?.quantity ?? 0) + input.quantity,
        });
      }
      await ingredientItems.save(
        [...merged.values()].map((item) =>
          ingredientItems.create({
            variantId: variant.id,
            ingredientId: item.ingredient.id,
            quantity: String(item.quantity),
            unit: item.unit,
          }),
        ),
      );
    }
  }

  private async ensureAuthorSkill(
    variant: DishRecipeVariant,
    manager: EntityManager,
  ) {
    if (!variant.authorMemberId) return;
    const skills = manager.getRepository(MemberDishSkill);
    let skill = await skills.findOneBy({
      householdId: variant.householdId,
      memberId: variant.authorMemberId,
      dishId: variant.dishId,
    });
    if (!skill) {
      skill = skills.create({
        householdId: variant.householdId,
        memberId: variant.authorMemberId,
        dishId: variant.dishId,
        level: 'can_cook',
      });
    }
    if (!skill.preferredRecipeId) skill.preferredRecipeId = variant.id;
    await skills.save(skill);
  }

  private async syncLegacyDefault(
    variant: DishRecipeVariant,
    manager: EntityManager,
  ) {
    const loaded = await manager.getRepository(DishRecipeVariant).findOne({
      where: { id: variant.id },
    });
    if (!loaded) throw new NotFoundException('做法不存在');
    const dishes = manager.getRepository(Dish);
    const dishIngredients = manager.getRepository(DishIngredient);
    const dish = await dishes.findOneBy({
      id: loaded.dishId,
      householdId: loaded.householdId,
    });
    if (!dish) throw new NotFoundException('菜品不存在');
    dish.note = loaded.note;
    dish.estMinutes = loaded.estMinutes;
    dish.recipeSteps = [...(loaded.steps ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((step) => ({ text: step.text, imageUrl: step.imageUrl }));
    dish.referenceLinks = [...(loaded.referenceLinks ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((link) => ({ title: link.title ?? undefined, url: link.url }));
    await dishes.save(dish);
    await dishIngredients.delete({ dishId: dish.id });
    await dishIngredients.save(
      (loaded.ingredients ?? []).map((item) =>
        dishIngredients.create({
          dishId: dish.id,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
          unit: item.unit,
        }),
      ),
    );
  }

  private async loadVariant(
    id: string,
    user: JwtUser,
    manager: EntityManager,
  ) {
    const variant = await manager.getRepository(DishRecipeVariant).findOne({
      where: { id, householdId: user.householdId },
    });
    if (!variant) throw new NotFoundException('做法不存在');
    return this.presentVariant(variant, user);
  }
}

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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Dish,
      DishRecipeVariant,
      MemberDishSkill,
    ]),
  ],
  controllers: [RecipesController],
  providers: [RecipesService],
})
export class RecipesModule {}
