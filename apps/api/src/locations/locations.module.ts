import { Controller, Delete, Get, Module, Patch, Post } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  createStorageLocationBody,
  storageLocationSearchQuery,
  storageLocationsQuery,
  updateStorageLocationBody,
  uuid,
  type CreateStorageLocationBody,
  type UpdateStorageLocationBody,
} from '@family/contracts';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod';
import { StorageLocation } from '../entities';
import { LocationsService } from './locations.service';

/**
 * /locations：I1 位置字典（docs/item-location-plan.md）。地图端点是 I2 的事，这里没有。
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
  imports: [TypeOrmModule.forFeature([StorageLocation])],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
