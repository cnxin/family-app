import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { verifyPin } from '../common/pin';
import { DEFAULT_HOUSEHOLD_ID } from '../database/database.constants';
import { AuthSession, Member } from '../entities';
import { CapabilitiesGuard } from './capabilities';
import { CurrentUser, JwtAuthGuard, JwtUser, Public } from './jwt.guard';
import {
  accessTokenExpiresSeconds,
  createRefreshToken,
  credentialSnapshot,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from './session.tokens';

const AUTH_MEMBER_SELECT = {
  id: true,
  householdId: true,
  name: true,
  avatarEmoji: true,
  role: true,
  prefersCooking: true,
  pinHash: true,
  createdAt: true,
} as const;

class LoginDto {
  @IsUUID()
  memberId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pin?: string;
}

class RefreshDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  refreshToken: string;
}

class UpdatePreferencesDto {
  @IsBoolean()
  prefersCooking: boolean;
}

function jwtSecret() {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 JWT_SECRET');
  }
  return 'family-app-dev-secret';
}

function memberProfile(member: Member) {
  return {
    id: member.id,
    householdId: member.householdId,
    name: member.name,
    avatarEmoji: member.avatarEmoji,
    role: member.role,
    prefersCooking: member.prefersCooking,
    createdAt: member.createdAt,
    hasPin: !!member.pinHash,
  };
}

@Injectable()
class AuthService {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async login(dto: LoginDto) {
    const member = await this.members.findOne({
      where: {
        id: dto.memberId,
        householdId: DEFAULT_HOUSEHOLD_ID,
      },
      select: AUTH_MEMBER_SELECT,
    });
    if (!member) throw new NotFoundException('成员不存在');
    if (member.pinHash && !(await verifyPin(dto.pin ?? '', member.pinHash))) {
      throw new UnauthorizedException('PIN 不正确');
    }

    const refreshToken = createRefreshToken();
    const session = await this.sessions.save(
      this.sessions.create({
        householdId: member.householdId,
        memberId: member.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        roleSnapshot: member.role,
        credentialSnapshot: credentialSnapshot(member.pinHash),
        expiresAt: refreshTokenExpiresAt(),
        revokedAt: null,
        lastUsedAt: null,
      }),
    );
    return this.issueSession(member, session.id, refreshToken);
  }

  async refresh(dto: RefreshDto) {
    const presentedHash = hashRefreshToken(dto.refreshToken);
    const rotated = await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(AuthSession);
      const session = await sessions
        .createQueryBuilder('session')
        .setLock('pessimistic_write')
        .where('session.refreshTokenHash = :presentedHash', { presentedHash })
        .getOne();
      if (!session) return null;

      const now = new Date();
      if (session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
        if (!session.revokedAt) {
          session.revokedAt = now;
          await sessions.save(session);
        }
        return null;
      }

      const member = await manager.getRepository(Member).findOne({
        where: {
          id: session.memberId,
          householdId: session.householdId,
        },
        select: AUTH_MEMBER_SELECT,
      });
      if (
        !member ||
        member.role !== session.roleSnapshot ||
        credentialSnapshot(member.pinHash) !== session.credentialSnapshot
      ) {
        session.revokedAt = now;
        await sessions.save(session);
        return null;
      }

      const refreshToken = createRefreshToken();
      session.refreshTokenHash = hashRefreshToken(refreshToken);
      session.expiresAt = refreshTokenExpiresAt(now);
      session.lastUsedAt = now;
      await sessions.save(session);
      return { member, refreshToken, sessionId: session.id };
    });

    if (!rotated) {
      throw new UnauthorizedException('登录续期已失效，请重新登录');
    }
    return this.issueSession(
      rotated.member,
      rotated.sessionId,
      rotated.refreshToken,
    );
  }

  async logout(user: JwtUser) {
    await this.sessions.update(
      {
        id: user.sid,
        memberId: user.memberId,
        householdId: user.householdId,
      },
      { revokedAt: new Date() },
    );
    return { revoked: true };
  }

  private async issueSession(
    member: Member,
    sessionId: string,
    refreshToken: string,
  ) {
    const accessToken = await this.jwt.signAsync({
      sub: member.id,
      memberId: member.id,
      householdId: member.householdId,
      sid: sessionId,
      name: member.name,
      role: member.role,
    });
    return {
      token: accessToken,
      accessToken,
      refreshToken,
      member: memberProfile(member),
    };
  }
}

@Controller()
export class AuthController {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Get('members')
  async list() {
    const list = await this.members.find({
      where: { householdId: DEFAULT_HOUSEHOLD_ID },
      order: { createdAt: 'ASC' },
      select: AUTH_MEMBER_SELECT,
    });
    return list.map(memberProfile);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Header('Cache-Control', 'no-store')
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Post('auth/refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @HttpCode(200)
  @Post('auth/logout')
  logout(@CurrentUser() user: JwtUser) {
    return this.auth.logout(user);
  }

  @Patch('members/me/preferences')
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() user: JwtUser,
  ) {
    const member = await this.members.findOneBy({
      id: user.memberId,
      householdId: user.householdId,
    });
    if (!member) throw new NotFoundException('成员不存在');
    member.prefersCooking = dto.prefersCooking;
    return this.members.save(member);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Member, AuthSession]),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.LOGIN_RATE_WINDOW_MS || 60_000),
        limit: Number(process.env.LOGIN_RATE_LIMIT || 5),
      },
    ]),
    JwtModule.register({
      global: true,
      secret: jwtSecret(),
      signOptions: {
        expiresIn: accessTokenExpiresSeconds(),
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CapabilitiesGuard },
  ],
})
export class AuthModule {}
