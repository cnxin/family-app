import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { MemberRole } from '../entities';
import { JwtUser } from './jwt.guard';

export type Capability =
  | 'place_meal_order'
  | 'update_meal_status'
  | 'manage_recipes'
  | 'manage_shopping'
  | 'manage_inventory'
  | 'manage_assets'
  | 'manage_members'
  | 'manage_guests'
  | 'manage_integrations';

const ROLE_CAPABILITIES: Record<MemberRole, ReadonlySet<Capability>> = {
  owner: new Set([
    'place_meal_order',
    'update_meal_status',
    'manage_recipes',
    'manage_shopping',
    'manage_inventory',
    'manage_assets',
    'manage_members',
    'manage_guests',
    'manage_integrations',
  ]),
  admin: new Set([
    'place_meal_order',
    'update_meal_status',
    'manage_recipes',
    'manage_shopping',
    'manage_inventory',
    'manage_assets',
    'manage_members',
    'manage_guests',
    'manage_integrations',
  ]),
  member: new Set([
    'place_meal_order',
    'update_meal_status',
    'manage_recipes',
    'manage_shopping',
    'manage_inventory',
    'manage_assets',
  ]),
};

const REQUIRED_CAPABILITIES = 'requiredCapabilities';

export const RequireCapabilities = (...capabilities: Capability[]) =>
  SetMetadata(REQUIRED_CAPABILITIES, capabilities);

export function hasCapability(user: JwtUser, capability: Capability) {
  return ROLE_CAPABILITIES[user.role]?.has(capability) ?? false;
}

export function assertCapability(user: JwtUser, capability: Capability) {
  if (!hasCapability(user, capability)) {
    throw new ForbiddenException('当前家庭角色没有执行此操作的权限');
  }
}

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<Capability[]>(
      REQUIRED_CAPABILITIES,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('未登录');
    if (required.every((capability) => hasCapability(user, capability))) {
      return true;
    }
    throw new ForbiddenException('当前家庭角色没有执行此操作的权限');
  }
}
