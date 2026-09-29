import { Controller, Delete, Get, Module, Patch, Post } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  createStorageLocationBody,
  itemLocationQuery,
  setLocationShapeBody,
  storageLocationSearchQuery,
  storageLocationsQuery,
  updateStorageLocationBody,
  uuid,
  type CreateStorageLocationBody,
  type SetLocationShapeBody,
  type UpdateStorageLocationBody,
} from '@family/contracts';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod';
import { HouseholdMap, StorageLocation } from '../entities';
import { LocationsService } from './locations.service';
import { MapController } from './map.controller';
import { MapService } from './map.service';

/**
 * /locations：I1 位置字典（docs/item-location-plan.md）；I2 加了形状（/:id/shape）和「东西放在哪」（/find），
 * 地图本身（/map）在 map.controller.ts。
 * 批次、资产的一跳改位置分别在库存、资产模块（PATCH /inventory-batches/:id/location、/assets/:id/location）。
 */
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  list(@ZodQuery(storageLocationsQuery) query: { includeArchived?: 'true' | 'false' }, @CurrentUser() user: JwtUser) {
    return this.locations.list(user.householdId, query.includeArchived === 'true');
  }

  @Get('search')
  search(@ZodQuery(storageLocationSearchQuery) query: { q: string }, @CurrentUser() user: JwtUser) {
    return this.locations.search(user.householdId, query.q);
  }

  @Get('find')
  find(@ZodQuery(itemLocationQuery) query: { q: string }, @CurrentUser() user: JwtUser) {
    return this.locations.find(user.householdId, query.q);
  }

  @Post()
  create(@ZodBody(createStorageLocationBody) body: CreateStorageLocationBody, @CurrentUser() user: JwtUser) {
    return this.locations.create(body, user);
  }

  @Get(':id/contents')
  contents(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.locations.contents(id, user.householdId);
  }

  @Patch(':id')
  update(
    @ZodParam('id', uuid) id: string,
    @ZodBody(updateStorageLocationBody) body: UpdateStorageLocationBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.locations.update(id, body, user);
  }

  @Patch(':id/shape')
  setShape(
    @ZodParam('id', uuid) id: string,
    @ZodBody(setLocationShapeBody) body: SetLocationShapeBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.locations.setShape(id, body, user);
  }

  @Post(':id/archive')
  archive(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.locations.archive(id, user);
  }

  @Delete(':id')
  remove(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.locations.remove(id, user);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([StorageLocation, HouseholdMap])],
  controllers: [LocationsController, MapController],
  providers: [LocationsService, MapService],
})
export class LocationsModule {}
