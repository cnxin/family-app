import {
  Body,
  ConflictException,
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
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ShoppingItem } from '../entities';
import { PluginFacadeRegistry, toPluginTransaction } from '../system/plugin-facades.registry';

class GenerateDto {
  @IsISO8601()
  date: string;
}

class ShoppingDateDto {
  @IsISO8601()
  date: string;
}

export class ManualItemDto {
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
    private readonly facades: PluginFacadeRegistry,
  ) {}

  async list(householdId: string, date: string) {
    const list = await this.items.find({ where: { householdId, date } });
    // 确认入库记录（含撤销时间）从库存门面读（J1b）
    const receipts = list.length
      ? await this.facades.get('inventory').listShoppingReceipts(
          householdId,
          list.map((item) => item.id),
        )
      : [];
    const receiptBySource = new Map(
      receipts.map((row) => [row.shoppingItemId, row]),
    );
    // 按食材分类分组排序，手动项排最后
    return list
      .map((item) => {
        const receipt = receiptBySource.get(item.id);
        return {
          ...item,
          inventoryConfirmation: receipt
            ? {
                transactionId: receipt.transactionId,
                inventoryItemId: receipt.inventoryItemId,
                inventoryItemName: receipt.inventoryItemName,
                quantityBefore: receipt.quantityBefore,
                delta: receipt.delta,
                quantityAfter: receipt.quantityAfter,
                unit: receipt.unit,
                actorName: receipt.actorName,
                createdAt: receipt.createdAt,
                reversedAt: receipt.reversedAt,
              }
            : null,
        };
      })
      .sort((a, b) => {
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
      // 某天的菜要哪些食材、现有库存、哪些自动项已确认入库：分别从点菜、库存门面读，同一事务（J1b）
      const transaction = toPluginTransaction(manager);
      const needs = await this.facades
        .get('menus')
        .listIngredientNeeds(transaction, householdId, date);

      const merged = new Map<
        string,
        {
          ingredientId: string;
          unit: string;
          requiredQty: number;
          isPantryStaple: boolean;
        }
      >();
      for (const ingredient of needs) {
        const key = `${ingredient.ingredientId}|${ingredient.unit}`;
        const previous = merged.get(key);
        merged.set(key, {
          ingredientId: ingredient.ingredientId,
          unit: ingredient.unit,
          requiredQty:
            (previous?.requiredQty ?? 0) + Number(ingredient.quantity),
          isPantryStaple:
            (previous?.isPantryStaple ?? true) &&
            ingredient.isPantryStaple,
        });
      }

      const inventory = merged.size
        ? await this.facades.get('inventory').listIngredientStock(
            transaction,
            householdId,
            [...new Set([...merged.values()].map((item) => item.ingredientId))],
          )
        : [];
      const inventoryByKey = new Map(
        inventory.map((item) => [
          `${item.ingredientId}|${item.unit}`,
          Number(item.quantity),
        ]),
      );
      const suggested = [...merged.entries()].flatMap(([key, entry]) => {
        const hasLinkedInventory = inventoryByKey.has(key);
        if (entry.isPantryStaple && !hasLinkedInventory) return [];
        const requiredQty = Math.round(entry.requiredQty * 100) / 100;
        const availableQty = inventoryByKey.get(key) ?? 0;
        const totalQty = Math.max(
          0,
          Math.round((requiredQty - availableQty) * 100) / 100,
        );
        return totalQty > 0
          ? [{ ...entry, requiredQty, availableQty, totalQty }]
          : [];
      });

      const oldAuto = await items.find({
        where: { householdId, date, source: 'auto' },
      });
      const receipts = oldAuto.length
        ? await this.facades.get('inventory').listShoppingReceipts(
            householdId,
            oldAuto.map((item) => item.id),
            transaction,
          )
        : [];
      const confirmedSourceIds = new Set(
        receipts.map((row) => row.shoppingItemId),
      );
      const reusableByKey = new Map(
        oldAuto
          .filter((item) => !confirmedSourceIds.has(item.id))
          .map((item) => [`${item.ingredientId}|${item.unit}`, item]),
      );
      const suggestedKeys = new Set(
        suggested.map((entry) => `${entry.ingredientId}|${entry.unit}`),
      );
      const staleIds = oldAuto
        .filter(
          (item) =>
            !suggestedKeys.has(`${item.ingredientId}|${item.unit}`) &&
            !confirmedSourceIds.has(item.id),
        )
        .map((item) => item.id);
      if (staleIds.length) await items.delete({ id: In(staleIds) });
      await items.save(
        suggested.map((entry) => {
          const previous = reusableByKey.get(
            `${entry.ingredientId}|${entry.unit}`,
          );
          return items.create({
            ...(previous ?? {}),
            householdId,
            date,
            ingredientId: entry.ingredientId,
            requiredQty: String(entry.requiredQty),
            availableQty: String(entry.availableQty),
            totalQty: String(entry.totalQty),
            unit: entry.unit,
            checked: previous?.checked ?? false,
            source: 'auto',
          });
        }),
      );
    });
    return this.list(householdId, date);
  }

  async addManual(dto: ManualItemDto, householdId: string) {
    return this.addManualWithinTransaction(
      dto,
      householdId,
      this.dataSource.manager,
    );
  }

  async addManualWithinTransaction(
    dto: ManualItemDto,
    householdId: string,
    manager: EntityManager,
  ) {
    const items = manager.getRepository(ShoppingItem);
    return items.save(
      items.create({
        householdId,
        date: dto.date,
        customName: dto.customName.trim(),
        totalQty: dto.totalQty != null ? String(dto.totalQty) : null,
        unit: dto.unit?.trim() || null,
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
    if (await this.facades.get('inventory').hasShoppingReceipt(householdId, id)) {
      throw new ConflictException('已经确认入库的购物项不能删除');
    }
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
  exports: [ShoppingService],
})
export class ShoppingModule {}
