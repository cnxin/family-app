import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { Member, MemberRole } from '../entities';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface JwtUser {
  sub: string;
  memberId: string;
  householdId: string;
  name: string;
  role: MemberRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser =>
    ctx.switchToHttp().getRequest().user,
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(Member) private readonly members: Repository<Member>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('未登录');

    let user: JwtUser;
    try {
      user = await this.jwt.verifyAsync<JwtUser>(token);
      if (!user.sub || user.memberId !== user.sub || !user.householdId) {
        throw new UnauthorizedException('登录信息已失效，请重新登录');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const member = await this.members.findOneBy({
      id: user.memberId,
      householdId: user.householdId,
    });
    if (!member) {
      throw new UnauthorizedException('成员已停用，请重新登录');
    }
    req.user = {
      ...user,
      name: member.name,
      role: member.role,
    };
    return true;
  }
}
