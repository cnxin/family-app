import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  Dish,
  DishRecipeVariant,
  DishRecipeVariantIngredient,
  DishRecipeVariantLink,
  DishRecipeVariantStep,
  Ingredient,
  Member,
  MemberDishSkill,
} from '../entities';
import { UpsertRecipeVariantDto, UpsertDishSkillDto } from './recipes.dto';
import {
  isHouseholdAdmin,
  presentVariant,
  assertVariantManageable,
  assertMember,
  resolveIngredient,
  ensureAuthorSkill,
  syncLegacyDefault,
} from './recipes.helpers';

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
        .map((variant) => presentVariant(variant, user)),
      skills: skills.filter((skill) => skill.dishId === dish.id),
    }));
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
      await assertMember(authorMemberId, user, manager);
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
        await syncLegacyDefault(variant, manager);
      } else {
        await ensureAuthorSkill(variant, manager);
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
      assertVariantManageable(variant, user);
      if (dto.authorMemberId !== undefined) {
        const authorMemberId = dto.authorMemberId ?? user.memberId;
        await assertMember(authorMemberId, user, manager);
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
      if (variant.isDefault) await syncLegacyDefault(variant, manager);
      return this.loadVariant(variant.id, user, manager);
    });
  }

  async archiveVariant(id: string, user: JwtUser) {
    const variant = await this.variants.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!variant || variant.isArchived) throw new NotFoundException('做法不存在');
    assertVariantManageable(variant, user);
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
        const ingredient = await resolveIngredient(
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

  private async loadVariant(
    id: string,
    user: JwtUser,
    manager: EntityManager,
  ) {
    const variant = await manager.getRepository(DishRecipeVariant).findOne({
      where: { id, householdId: user.householdId },
    });
    if (!variant) throw new NotFoundException('做法不存在');
    return presentVariant(variant, user);
  }
}
