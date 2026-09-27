import { Controller, Get, Patch } from '@nestjs/common';
import {
  shelfModuleKey,
  updateModuleOverrideBody,
  type ShelfModuleKey,
  type UpdateModuleOverrideBody,
} from '@family/contracts';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam } from '../common/zod';
import { SystemModulesService } from './system-modules.service';

@Controller('system/modules')
export class SystemModulesController {
  constructor(private readonly modules: SystemModulesService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.modules.list(user);
  }

  @Patch(':key')
  @RequireCapabilities('manage_integrations')
  update(
    @ZodParam('key', shelfModuleKey) key: ShelfModuleKey,
    @ZodBody(updateModuleOverrideBody) body: UpdateModuleOverrideBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.modules.update(key, body.override, user);
  }
}
