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
import { Account, AuthSession, Member, MemberRole } from '../entities';
import { credentialSnapshot } from './session.tokens';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface JwtUser {
  sub: string;
  accountId: string;
  memberId: string;
  householdId: string;
  sid: string;
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
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
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
      if (
        !user.sub ||
        user.accountId !== user.sub ||
        !user.memberId ||
        !user.householdId ||
        !user.sid
      ) {
        throw new UnauthorizedException('登录信息已失效，请重新登录');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const [account, member, session] = await Promise.all([
      this.accounts.findOne({
        where: { id: user.accountId },
        select: {
          id: true,
          passwordHash: true,
          disabledAt: true,
        },
      }),
      this.members.findOne({
        where: {
          id: user.memberId,
          accountId: user.accountId,
          householdId: user.householdId,
        },
        select: {
          id: true,
          householdId: true,
          name: true,
          role: true,
          disabledAt: true,
        },
      }),
      this.sessions.findOneBy({
        id: user.sid,
        accountId: user.accountId,
        memberId: user.memberId,
        householdId: user.householdId,
      }),
    ]);
    if (
      !account ||
      account.disabledAt ||
      !member ||
      member.disabledAt ||
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('登录会话已失效，请重新登录');
    }

    if (
      user.role !== session.roleSnapshot ||
      member.role !== session.roleSnapshot ||
      credentialSnapshot(account.passwordHash) !== session.credentialSnapshot
    ) {
      await this.sessions.update(session.id, { revokedAt: new Date() });
      throw new UnauthorizedException('成员权限或凭据已更新，请重新登录');
    }

    req.user = {
      ...user,
      name: member.name,
      role: member.role,
    };
    return true;
  }
}
