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
import { In, Repository } from 'typeorm';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { Menu, ShoppingItem } from '../entities';

class GenerateDto {
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
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
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
    const menus = await this.menus.find({
      where: { householdId, date },
      relations: { items: { dish: { ingredients: { ingredient: true } } } },
    });
    const wanted = menus
      .flatMap((m) => m.items)
      .filter((i) => i.status === 'accepted' || i.status === 'cooking');

    // 合并：同食材同单位数量相加，常备调料不进清单
    const merged = new Map<string, { ingredientId: string; unit: string; qty: number }>();
    for (const item of wanted) {
      for (const di of item.dish.ingredients ?? []) {
        if (di.ingredient.isPantryStaple) continue;
        const key = `${di.ingredientId}|${di.unit}`;
        const prev = merged.get(key);
        merged.set(key, {
          ingredientId: di.ingredientId,
          unit: di.unit,
          qty: (prev?.qty ?? 0) + Number(di.quantity),
        });
      }
    }

    // 保留旧 auto 项的勾选状态后重建
    const oldAuto = await this.items.find({
      where: { householdId, date, source: 'auto' },
    });
    const checkedKeys = new Set(
      oldAuto.filter((i) => i.checked).map((i) => `${i.ingredientId}|${i.unit}`),
    );
    if (oldAuto.length) {
      await this.items.delete({ id: In(oldAuto.map((i) => i.id)) });
    }
    for (const entry of merged.values()) {
      await this.items.save(
        this.items.create({
          householdId,
          date,
          ingredientId: entry.ingredientId,
          totalQty: String(entry.qty),
          unit: entry.unit,
          checked: checkedKeys.has(`${entry.ingredientId}|${entry.unit}`),
          source: 'auto',
        }),
      );
    }
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
  list(@Query('date') date: string, @CurrentUser() user: JwtUser) {
    if (!date) throw new NotFoundException('date 必填 (YYYY-MM-DD)');
    return this.service.list(user.householdId, date);
  }

  @Post('shopping-list/generate')
  generate(@Body() dto: GenerateDto, @CurrentUser() user: JwtUser) {
    return this.service.generate(user.householdId, dto.date);
  }

  @Post('shopping-items')
  addManual(@Body() dto: ManualItemDto, @CurrentUser() user: JwtUser) {
    return this.service.addManual(dto, user.householdId);
  }

  @Patch('shopping-items/:id')
  check(
    @Param('id') id: string,
    @Body() dto: CheckDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.check(id, dto.checked, user.householdId);
  }

  @Delete('shopping-items/:id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user.householdId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([ShoppingItem, Menu])],
  controllers: [ShoppingController],
  providers: [ShoppingService],
})
export class ShoppingModule {}
