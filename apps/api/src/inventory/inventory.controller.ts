import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { InventoryBatchesService } from './inventory-batches.service';
import { InventoryTransactionsService } from './inventory-transactions.service';
import { InventoryShoppingReceiptService } from './inventory-shopping-receipt.service';
import { InventoryMenuConsumptionService } from './inventory-menu-consumption.service';
import {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  InventoryTransactionsQueryDto,
  InventoryBatchesQueryDto,
  CreateInventoryBatchDto,
  UpdateInventoryBatchDto,
  ShoppingInventoryPreviewDto,
  ConfirmShoppingReceiptDto,
  SetLocationDto,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@Controller()
export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly ledger: InventoryTransactionsService,
    private readonly batchesService: InventoryBatchesService,
    private readonly shoppingReceipt: InventoryShoppingReceiptService,
    private readonly menuConsumption: InventoryMenuConsumptionService,
  ) {}

  @Get('inventory')
  list(@CurrentUser() user: JwtUser) {
    return this.service.list(user.householdId);
  }

  @Post('inventory-items')
  @RequireCapabilities('manage_inventory')
  create(@Body() dto: CreateInventoryItemDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('inventory-items/:id')
  @RequireCapabilities('manage_inventory')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete('inventory-items/:id')
  @RequireCapabilities('manage_inventory')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user.householdId);
  }

  @Get('inventory-transactions')
  transactions(
    @Query() query: InventoryTransactionsQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.ledger.list(
      user.householdId,
      query.inventoryItemId,
      query.limit,
    );
  }

  @Get('inventory-batches')
  batches(
    @Query() query: InventoryBatchesQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.batchesService.list(
      user.householdId,
      query.inventoryItemId,
      query.status,
      query.days,
    );
  }

  @Post('inventory-batches')
  @RequireCapabilities('manage_inventory')
  createBatch(
    @Body() dto: CreateInventoryBatchDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.batchesService.create(dto, user);
  }

  @Patch('inventory-batches/:id')
  @RequireCapabilities('manage_inventory')
  updateBatch(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryBatchDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.batchesService.update(id, dto, user);
  }

  @Patch('inventory-batches/:id/location')
  @RequireCapabilities('manage_inventory')
  setBatchLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetLocationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.batchesService.setLocation(id, dto.locationId ?? null, user);
  }

  @Get('shopping-items/:id/inventory-preview')
  shoppingPreview(
    @Param('id') id: string,
    @Query() query: ShoppingInventoryPreviewDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.shoppingReceipt.shoppingPreview(
      id,
      user.householdId,
      query.inventoryItemId,
    );
  }

  @Post('shopping-items/:id/confirm-stock')
  @RequireCapabilities('manage_inventory')
  confirmShoppingReceipt(
    @Param('id') id: string,
    @Body() dto: ConfirmShoppingReceiptDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.shoppingReceipt.confirmShoppingReceipt(
      id,
      dto.inventoryItemId,
      dto.batch,
      user,
      dto.locationId,
    );
  }

  @Get('menus/:id/inventory-preview')
  menuPreview(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.menuConsumption.menuPreview(id, user.householdId);
  }

  @Post('menus/:id/confirm-consumption')
  @RequireCapabilities('manage_inventory')
  confirmMenuConsumption(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.menuConsumption.confirmMenuConsumption(id, user);
  }

  @Post('inventory-transactions/:id/reverse')
  @RequireCapabilities('manage_inventory')
  reverse(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.ledger.reverse(id, user);
  }
}
