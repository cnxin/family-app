import { Controller, Delete, Get, Injectable, Module, OnModuleInit, Patch, Post } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  createStorageLocationBody,
  itemLocationQuery,
  mergeLocationBody,
  setLocationShapeBody,
  splitLocationBody,
  storageLocationSearchQuery,
  storageLocationsQuery,
  updateStorageLocationBody,
  uuid,
  type CreateStorageLocationBody,
  type MergeLocationBody,
  type SetLocationShapeBody,
  type SplitLocationBody,
  type UpdateStorageLocationBody,
} from '@family/contracts';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod';
import { HouseholdMap, StorageLocation } from '../entities';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { locationsFacade } from './locations.facade';
import { LocationsService } from './locations.service';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { RoomRestructureService } from './room-restructure.service';

/**
 * /locations：I1 位置字典（docs/item-location-plan.md）；I2 加了形状（/:id/shape）和「东西放在哪」（/find），
 * 地图本身（/map）在 map.controller.ts。
 * 批次、资产的一跳改位置分别在库存、资产模块（PATCH /inventory-batches/:id/location、/assets/:id/location）。
 */
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly locations: LocationsService,
    private readonly rooms: RoomRestructureService,
  ) {}

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

  @Post(':id/split')
  split(@ZodParam('id', uuid) id: string, @ZodBody(splitLocationBody) body: SplitLocationBody, @CurrentUser() user: JwtUser) {
    return this.rooms.split(id, body, user);
  }

  @Post(':id/merge')
  merge(@ZodParam('id', uuid) id: string, @ZodBody(mergeLocationBody) body: MergeLocationBody, @CurrentUser() user: JwtUser) {
    return this.rooms.merge(id, body, user);
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

/** 把位置门面注册到内核（J1b）：库存、资产引用位置前的检查走这里，不再 import location-refs。 */
@Injectable()
export class LocationsFacadeProvider implements OnModuleInit {
  constructor(private readonly registry: PluginFacadeRegistry) {}

  onModuleInit() {
    this.registry.register('locations', locationsFacade());
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([StorageLocation, HouseholdMap])],
  controllers: [LocationsController, MapController],
  providers: [LocationsService, MapService, RoomRestructureService, LocationsFacadeProvider],
})
export class LocationsModule {}
