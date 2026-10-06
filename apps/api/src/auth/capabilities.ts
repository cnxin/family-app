import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { pluginCapabilities } from '@family/contracts';
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
  | 'manage_points'
  | 'view_finance'
  | 'record_finance'
  | 'manage_finance'
  | 'manage_members'
  | 'manage_guests'
  | 'manage_integrations'
  | 'use_agent'
  | 'manage_agent';

/**
 * 角色 → 能力。能力名清单（上面的 Capability）仍是手写的 key 表；已迁插件在 manifest 里声明自己的能力
 * 和授予哪些角色（J1），这里只手写内核与还没迁的。
 */
const HANDWRITTEN_ROLE_CAPABILITIES: Record<MemberRole, readonly Capability[]> = {
  owner: [
    'manage_assets',
    'manage_members',
    'manage_integrations',
    'use_agent',
    'manage_agent',
  ],
  admin: [
    'manage_assets',
    'manage_members',
    'manage_integrations',
    'use_agent',
    'manage_agent',
  ],
  member: [
    'manage_assets',
    'use_agent',
  ],
};

const ROLE_CAPABILITIES = {} as Record<MemberRole, ReadonlySet<Capability>>;
for (const role of Object.keys(HANDWRITTEN_ROLE_CAPABILITIES) as MemberRole[]) {
  ROLE_CAPABILITIES[role] = new Set<Capability>([
    ...HANDWRITTEN_ROLE_CAPABILITIES[role],
    ...pluginCapabilities()
      .filter((capability) => capability.roles.includes(role))
      .map((capability) => capability.key as Capability),
  ]);
}

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
