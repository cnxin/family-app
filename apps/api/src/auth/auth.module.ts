import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  GoneException,
  Header,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { bootstrapSecret, jwtSecret } from '../common/config';
import { hashPin, verifyPin } from '../common/pin';
import {
  Account,
  AuthSession,
  Household,
  HouseholdInvitation,
  Member,
  MemberRole,
} from '../entities';
import { normalizeLoginName } from './account.credentials';
import {
  CapabilitiesGuard,
  RequireCapabilities,
} from './capabilities';
import { CurrentUser, JwtAuthGuard, JwtUser, Public } from './jwt.guard';
import {
  accessTokenExpiresSeconds,
  createInvitationToken,
  createRefreshToken,
  credentialSnapshot,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from './session.tokens';

const AUTH_ACCOUNT_SELECT = {
  id: true,
  loginName: true,
  loginNameNormalized: true,
  passwordHash: true,
  disabledAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const AUTH_MEMBER_SELECT = {
  id: true,
  householdId: true,
  accountId: true,
  name: true,
  avatarEmoji: true,
  role: true,
  prefersCooking: true,
  createdAt: true,
} as const;

class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  loginName: string;

  @IsOptional()
  @IsString()
  @MaxLength(72)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  householdSlug?: string;
}

class RefreshDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  refreshToken: string;
}

class BootstrapDto {
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  bootstrapSecret: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  householdName: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  householdSlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  ownerName: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatarEmoji?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  loginName: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}

class UpdatePreferencesDto {
  @IsBoolean()
  prefersCooking: boolean;
}

class UpdatePasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(72)
  currentPassword?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}

class CreateInvitationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  memberName: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatarEmoji?: string;

  @IsOptional()
  @IsIn(['admin', 'member'])
  role?: Exclude<MemberRole, 'owner'>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours?: number;
}

class InvitationTokenDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  invitationToken: string;
}

class RedeemInvitationDto extends InvitationTokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  loginName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password: string;
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
  };
}

function accountProfile(account: Account) {
  return {
    id: account.id,
    loginName: account.loginName,
    requiresPasswordSetup: !account.passwordHash,
  };
}

function invitationProfile(invitation: HouseholdInvitation) {
  return {
    id: invitation.id,
    memberName: invitation.memberName,
    avatarEmoji: invitation.avatarEmoji,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'driverError' in error &&
    (error as { driverError?: { code?: string } }).driverError?.code === '23505'
  );
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function verifyOneTimeBootstrapSecret(presented: string) {
  const expectedBuffer = Buffer.from(bootstrapSecret(), 'utf8');
  const presentedBuffer = Buffer.from(presented, 'utf8');
  if (
    expectedBuffer.length !== presentedBuffer.length ||
    !timingSafeEqual(expectedBuffer, presentedBuffer)
  ) {
    throw new UnauthorizedException('初始化凭据不正确');
  }
}

@Injectable()
class AuthService {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Household)
    private readonly households: Repository<Household>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async setupStatus() {
    const [accountCount, householdCount] = await Promise.all([
      this.accounts.count(),
      this.households.count(),
    ]);
    return { initialized: accountCount > 0 || householdCount > 0 };
  }

  async bootstrap(dto: BootstrapDto) {
    verifyOneTimeBootstrapSecret(dto.bootstrapSecret);
    const timezone = dto.timezone?.trim() || 'Asia/Shanghai';
    if (!validTimezone(timezone)) {
      throw new BadRequestException('家庭时区无效');
    }
    const loginName = dto.loginName.trim();
    const loginNameNormalized = normalizeLoginName(loginName);
    const householdName = dto.householdName.trim();
    const ownerName = dto.ownerName.trim();
    if (!loginNameNormalized || !householdName || !ownerName) {
      throw new BadRequestException('家庭名称、成员名称和登录账号不能为空');
    }
    const requestedSlug = dto.householdSlug?.trim().toLocaleLowerCase('en-US');
    if (requestedSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) {
      throw new BadRequestException('家庭标识只能使用小写字母、数字和短横线');
    }
    const passwordHash = await hashPin(dto.password);

    let created: { account: Account; member: Member };
    try {
      created = await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `SELECT pg_advisory_xact_lock(hashtext('family-app-bootstrap-v1'))`,
        );
        const [accountCount, householdCount] = await Promise.all([
          manager.getRepository(Account).count(),
          manager.getRepository(Household).count(),
        ]);
        if (accountCount > 0 || householdCount > 0) {
          throw new ConflictException('家庭系统已经完成初始化');
        }

        const account = await manager.getRepository(Account).save(
          manager.getRepository(Account).create({
            loginName,
            loginNameNormalized,
            passwordHash,
            disabledAt: null,
          }),
        );
        const household = await manager.getRepository(Household).save(
          manager.getRepository(Household).create({
            name: householdName,
            slug:
              requestedSlug ||
              `home-${randomBytes(5).toString('hex').toLocaleLowerCase('en-US')}`,
            timezone,
          }),
        );
        const member = await manager.getRepository(Member).save(
          manager.getRepository(Member).create({
            householdId: household.id,
            accountId: account.id,
            name: ownerName,
            avatarEmoji: dto.avatarEmoji?.trim() || '🏠',
            role: 'owner',
            prefersCooking: false,
          }),
        );
        return { account, member };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('登录账号或家庭标识已经存在');
      }
      throw error;
    }
    return this.startSession(created.account, created.member);
  }

  async login(dto: LoginDto) {
    const candidate = await this.accounts.findOne({
      where: { loginNameNormalized: normalizeLoginName(dto.loginName) },
      select: AUTH_ACCOUNT_SELECT,
    });
    const account = await this.assertAccountCredential(
      candidate,
      dto.password ?? '',
    );

    const query = this.members
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.household', 'household')
      .where('member.accountId = :accountId', { accountId: account.id });
    if (dto.householdSlug?.trim()) {
      query.andWhere('household.slug = :householdSlug', {
        householdSlug: dto.householdSlug.trim().toLocaleLowerCase('en-US'),
      });
    }
    const memberships = await query.orderBy('member.createdAt', 'ASC').getMany();
    if (memberships.length === 0) {
      throw new UnauthorizedException('账号或密码不正确');
    }
    if (memberships.length > 1 && !dto.householdSlug?.trim()) {
      throw new ConflictException('该账号属于多个家庭，请指定家庭空间');
    }
    return this.startSession(account, memberships[0]);
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

      const [account, member] = await Promise.all([
        manager.getRepository(Account).findOne({
          where: { id: session.accountId },
          select: AUTH_ACCOUNT_SELECT,
        }),
        manager.getRepository(Member).findOne({
          where: {
            id: session.memberId,
            accountId: session.accountId,
            householdId: session.householdId,
          },
          select: AUTH_MEMBER_SELECT,
        }),
      ]);
      if (
        !account ||
        account.disabledAt ||
        !member ||
        member.role !== session.roleSnapshot ||
        credentialSnapshot(account.passwordHash) !== session.credentialSnapshot
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
      return { account, member, refreshToken, sessionId: session.id };
    });

    if (!rotated) {
      throw new UnauthorizedException('登录续期已失效，请重新登录');
    }
    return this.issueSession(
      rotated.account,
      rotated.member,
      rotated.sessionId,
      rotated.refreshToken,
    );
  }

  async logout(user: JwtUser) {
    await this.sessions.update(
      {
        id: user.sid,
        accountId: user.accountId,
        memberId: user.memberId,
        householdId: user.householdId,
      },
      { revokedAt: new Date() },
    );
    return { revoked: true };
  }

  async updatePassword(user: JwtUser, dto: UpdatePasswordDto) {
    const passwordHash = await hashPin(dto.newPassword);
    const account = await this.dataSource.transaction(async (manager) => {
      const accounts = manager.getRepository(Account);
      const current = await accounts.findOne({
        where: { id: user.accountId },
        select: AUTH_ACCOUNT_SELECT,
      });
      if (!current || current.disabledAt) {
        throw new UnauthorizedException('账号已失效');
      }
      if (
        current.passwordHash &&
        !(await verifyPin(dto.currentPassword ?? '', current.passwordHash))
      ) {
        throw new UnauthorizedException('当前密码不正确');
      }

      current.passwordHash = passwordHash;
      await accounts.save(current);
      const sessions = manager.getRepository(AuthSession);
      await sessions
        .createQueryBuilder()
        .update(AuthSession)
        .set({ revokedAt: new Date() })
        .where('"accountId" = :accountId', { accountId: user.accountId })
        .andWhere('"id" <> :sessionId', { sessionId: user.sid })
        .andWhere('"revokedAt" IS NULL')
        .execute();
      const activeSession = await sessions.findOneBy({
        id: user.sid,
        accountId: user.accountId,
      });
      if (!activeSession) throw new UnauthorizedException('登录会话已失效');
      activeSession.credentialSnapshot = credentialSnapshot(passwordHash);
      await sessions.save(activeSession);
      return current;
    });
    return accountProfile(account);
  }

  async startSession(account: Account, member: Member) {
    const refreshToken = createRefreshToken();
    const session = await this.sessions.save(
      this.sessions.create({
        accountId: account.id,
        householdId: member.householdId,
        memberId: member.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        roleSnapshot: member.role,
        credentialSnapshot: credentialSnapshot(account.passwordHash),
        expiresAt: refreshTokenExpiresAt(),
        revokedAt: null,
        lastUsedAt: null,
      }),
    );
    return this.issueSession(account, member, session.id, refreshToken);
  }

  private async assertAccountCredential(
    account: Account | null,
    password: string,
  ): Promise<Account> {
    if (
      !account ||
      account.disabledAt ||
      (account.passwordHash
        ? !(await verifyPin(password, account.passwordHash))
        : password.length > 0)
    ) {
      throw new UnauthorizedException('账号或密码不正确');
    }
    return account;
  }

  private async issueSession(
    account: Account,
    member: Member,
    sessionId: string,
    refreshToken: string,
  ) {
    const accessToken = await this.jwt.signAsync({
      sub: account.id,
      accountId: account.id,
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
      account: accountProfile(account),
      member: memberProfile(member),
    };
  }
}

@Injectable()
class InvitationService {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(HouseholdInvitation)
    private readonly invitations: Repository<HouseholdInvitation>,
    private readonly auth: AuthService,
    private readonly dataSource: DataSource,
  ) {}

  async list(user: JwtUser) {
    const invitations = await this.invitations.find({
      where: {
        householdId: user.householdId,
        acceptedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
    return invitations.map(invitationProfile);
  }

  async create(user: JwtUser, dto: CreateInvitationDto) {
    const memberName = dto.memberName.trim();
    if (!memberName) throw new BadRequestException('成员名称不能为空');
    const invitationToken = createInvitationToken();
    const expiresAt = new Date(
      Date.now() + (dto.expiresInHours ?? 48) * 60 * 60 * 1000,
    );
    const invitation = await this.invitations.save(
      this.invitations.create({
        householdId: user.householdId,
        tokenHash: hashRefreshToken(invitationToken),
        memberName,
        avatarEmoji: dto.avatarEmoji?.trim() || '🙂',
        role: dto.role ?? 'member',
        invitedById: user.memberId,
        acceptedByAccountId: null,
        expiresAt,
        acceptedAt: null,
        revokedAt: null,
      }),
    );
    return { ...invitationProfile(invitation), invitationToken };
  }

  async revoke(user: JwtUser, id: string) {
    const invitation = await this.invitations.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!invitation) throw new NotFoundException('邀请不存在');
    if (invitation.acceptedAt) throw new ConflictException('邀请已经被领取');
    if (!invitation.revokedAt) {
      invitation.revokedAt = new Date();
      await this.invitations.save(invitation);
    }
    return invitationProfile(invitation);
  }

  async preview(dto: InvitationTokenDto) {
    const invitation = await this.findUsableInvitation(
      this.invitations,
      dto.invitationToken,
      false,
    );
    return {
      householdName: invitation.household.name,
      memberName: invitation.memberName,
      avatarEmoji: invitation.avatarEmoji,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }

  async redeem(dto: RedeemInvitationDto) {
    const loginName = dto.loginName.trim();
    const loginNameNormalized = normalizeLoginName(loginName);
    if (!loginNameNormalized) throw new BadRequestException('登录账号不能为空');

    let accepted: { account: Account; member: Member };
    try {
      accepted = await this.dataSource.transaction(async (manager) => {
        const invitation = await this.findUsableInvitation(
          manager.getRepository(HouseholdInvitation),
          dto.invitationToken,
          true,
        );
        const accounts = manager.getRepository(Account);
        let account = await accounts.findOne({
          where: { loginNameNormalized },
          select: AUTH_ACCOUNT_SELECT,
        });
        if (account) {
          if (
            account.disabledAt ||
            !account.passwordHash ||
            !(await verifyPin(dto.password, account.passwordHash))
          ) {
            throw new UnauthorizedException('账号或密码不正确');
          }
        } else {
          if (dto.password.length < 8) {
            throw new BadRequestException('新账号密码至少需要 8 位');
          }
          account = await accounts.save(
            accounts.create({
              loginName,
              loginNameNormalized,
              passwordHash: await hashPin(dto.password),
              disabledAt: null,
            }),
          );
        }

        const members = manager.getRepository(Member);
        if (
          await members.findOneBy({
            householdId: invitation.householdId,
            accountId: account.id,
          })
        ) {
          throw new ConflictException('该账号已经是这个家庭的成员');
        }
        const member = await members.save(
          members.create({
            householdId: invitation.householdId,
            accountId: account.id,
            name: invitation.memberName,
            avatarEmoji: invitation.avatarEmoji,
            role: invitation.role,
            prefersCooking: false,
          }),
        );
        invitation.acceptedAt = new Date();
        invitation.acceptedByAccountId = account.id;
        await manager.getRepository(HouseholdInvitation).save(invitation);
        return { account, member };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('登录账号已经被使用');
      }
      throw error;
    }
    return this.auth.startSession(accepted.account, accepted.member);
  }

  private async findUsableInvitation(
    repository: Repository<HouseholdInvitation>,
    invitationToken: string,
    lock: boolean,
  ) {
    let query = repository
      .createQueryBuilder('invitation')
      .innerJoinAndSelect('invitation.household', 'household')
      .where('invitation.tokenHash = :tokenHash', {
        tokenHash: hashRefreshToken(invitationToken),
      });
    if (lock) query = query.setLock('pessimistic_write');
    const invitation = await query.getOne();
    if (!invitation) throw new NotFoundException('邀请无效');
    if (invitation.acceptedAt) throw new GoneException('邀请已经被领取');
    if (invitation.revokedAt) throw new GoneException('邀请已经被撤销');
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('邀请已经过期');
    }
    return invitation;
  }
}

@Controller()
export class AuthController {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly auth: AuthService,
    private readonly invitations: InvitationService,
  ) {}

  @Public()
  @Header('Cache-Control', 'no-store')
  @Get('auth/setup/status')
  setupStatus() {
    return this.auth.setupStatus();
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Header('Cache-Control', 'no-store')
  @Post('auth/setup/bootstrap')
  bootstrap(@Body() dto: BootstrapDto) {
    return this.auth.bootstrap(dto);
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

  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Post('auth/invitations/preview')
  previewInvitation(@Body() dto: InvitationTokenDto) {
    return this.invitations.preview(dto);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Header('Cache-Control', 'no-store')
  @Post('auth/invitations/redeem')
  redeemInvitation(@Body() dto: RedeemInvitationDto) {
    return this.invitations.redeem(dto);
  }

  @HttpCode(200)
  @Post('auth/logout')
  logout(@CurrentUser() user: JwtUser) {
    return this.auth.logout(user);
  }

  @Get('members')
  async list(@CurrentUser() user: JwtUser) {
    const list = await this.members.find({
      where: { householdId: user.householdId },
      order: { createdAt: 'ASC' },
      select: AUTH_MEMBER_SELECT,
    });
    return list.map(memberProfile);
  }

  @Patch('members/me/preferences')
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() user: JwtUser,
  ) {
    const member = await this.members.findOneBy({
      id: user.memberId,
      accountId: user.accountId,
      householdId: user.householdId,
    });
    if (!member) throw new NotFoundException('成员不存在');
    member.prefersCooking = dto.prefersCooking;
    return memberProfile(await this.members.save(member));
  }

  @HttpCode(200)
  @Patch('accounts/me/password')
  updatePassword(
    @Body() dto: UpdatePasswordDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.auth.updatePassword(user, dto);
  }

  @RequireCapabilities('manage_members')
  @Get('household/invitations')
  listInvitations(@CurrentUser() user: JwtUser) {
    return this.invitations.list(user);
  }

  @RequireCapabilities('manage_members')
  @Post('household/invitations')
  createInvitation(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.invitations.create(user, dto);
  }

  @RequireCapabilities('manage_members')
  @Delete('household/invitations/:id')
  revokeInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.invitations.revoke(user, id);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Household,
      Member,
      AuthSession,
      HouseholdInvitation,
    ]),
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
    InvitationService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CapabilitiesGuard },
  ],
})
export class AuthModule {}
