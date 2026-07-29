import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { Menu, ShoppingItem } from '../entities';

class GenerateDto {
  @IsISO8601()
  date: string;
}

class ShoppingDateDto {
  @IsISO8601()
  date: string;
}

class ManualItemDto {
  @IsISO8601()
  date: string;

  @IsString()
  customName: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  totalQty?: number;

  @IsOptional()
  @IsString()
  unit?: string;
}

class CheckDto {
  @IsBoolean()
  checked: boolean;
}

@Injectable()
export class ShoppingService {
  constructor(
    @InjectRepository(ShoppingItem)
    private readonly items: Repository<ShoppingItem>,
    private readonly dataSource: DataSource,
  ) {}

  async list(householdId: string, date: string) {
    const list = await this.items.find({ where: { householdId, date } });
    // 按食材分类分组排序，手动项排最后
    return list.sort((a, b) => {
      const ka = a.ingredient ? a.ingredient.category : '手动添加';
      const kb = b.ingredient ? b.ingredient.category : '手动添加';
      if (ka !== kb) return ka.localeCompare(kb, 'zh');
      const na = a.ingredient?.name ?? a.customName ?? '';
      const nb = b.ingredient?.name ?? b.customName ?? '';
      return na.localeCompare(nb, 'zh');
    });
  }

  async generate(householdId: string, date: string) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `shopping-list:${householdId}:${date}`,
      ]);
      const items = manager.getRepository(ShoppingItem);
      const menus = await manager.getRepository(Menu).find({
        where: { householdId, date },
        relations: { items: { dish: { ingredients: { ingredient: true } } } },
      });
      const wanted = menus
        .flatMap((menu) => menu.items)
        .filter((item) => item.status === 'accepted' || item.status === 'cooking');

      const merged = new Map<
        string,
        { ingredientId: string; unit: string; qty: number }
      >();
      for (const item of wanted) {
        const recipeIngredients = item.recipeSnapshot
          ? item.recipeSnapshot.ingredients
          : (item.dish.ingredients ?? []).map((dishIngredient) => ({
              ingredientId: dishIngredient.ingredientId,
              isPantryStaple: dishIngredient.ingredient.isPantryStaple,
              quantity: Number(dishIngredient.quantity),
              unit: dishIngredient.unit,
            }));
        for (const ingredient of recipeIngredients) {
          if (ingredient.isPantryStaple) continue;
          const key = `${ingredient.ingredientId}|${ingredient.unit}`;
          const previous = merged.get(key);
          merged.set(key, {
            ingredientId: ingredient.ingredientId,
            unit: ingredient.unit,
            qty: (previous?.qty ?? 0) + Number(ingredient.quantity),
          });
        }
      }

      const oldAuto = await items.find({
        where: { householdId, date, source: 'auto' },
      });
      const checkedKeys = new Set(
        oldAuto
          .filter((item) => item.checked)
          .map((item) => `${item.ingredientId}|${item.unit}`),
      );
      await items.delete({ householdId, date, source: 'auto' });
      await items.save(
        [...merged.values()].map((entry) =>
          items.create({
            householdId,
            date,
            ingredientId: entry.ingredientId,
            totalQty: String(entry.qty),
            unit: entry.unit,
            checked: checkedKeys.has(`${entry.ingredientId}|${entry.unit}`),
            source: 'auto',
          }),
        ),
      );
    });
    return this.list(householdId, date);
  }

  async addManual(dto: ManualItemDto, householdId: string) {
    return this.items.save(
      this.items.create({
        householdId,
        date: dto.date,
        customName: dto.customName,
        totalQty: dto.totalQty != null ? String(dto.totalQty) : null,
        unit: dto.unit ?? null,
        source: 'manual',
      }),
    );
  }

  async check(id: string, checked: boolean, householdId: string) {
    const item = await this.items.findOneBy({ id, householdId });
    if (!item) throw new NotFoundException('清单项不存在');
    item.checked = checked;
    return this.items.save(item);
  }

  async remove(id: string, householdId: string) {
    const result = await this.items.delete({ id, householdId });
    if (!result.affected) throw new NotFoundException('清单项不存在');
    return { id, removed: true };
  }
}

@Controller()
export class ShoppingController {
  constructor(private readonly service: ShoppingService) {}

  @Get('shopping-list')
  list(@Query() query: ShoppingDateDto, @CurrentUser() user: JwtUser) {
    return this.service.list(user.householdId, query.date);
  }

  @Post('shopping-list/generate')
  @RequireCapabilities('manage_shopping')
  generate(@Body() dto: GenerateDto, @CurrentUser() user: JwtUser) {
    return this.service.generate(user.householdId, dto.date);
  }

  @Post('shopping-items')
  @RequireCapabilities('manage_shopping')
  addManual(@Body() dto: ManualItemDto, @CurrentUser() user: JwtUser) {
    return this.service.addManual(dto, user.householdId);
  }

  @Patch('shopping-items/:id')
  @RequireCapabilities('manage_shopping')
  check(
    @Param('id') id: string,
    @Body() dto: CheckDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.check(id, dto.checked, user.householdId);
  }

  @Delete('shopping-items/:id')
  @RequireCapabilities('manage_shopping')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user.householdId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([ShoppingItem])],
  controllers: [ShoppingController],
  providers: [ShoppingService],
})
export class ShoppingModule {}
