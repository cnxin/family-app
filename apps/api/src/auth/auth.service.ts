import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { bootstrapSecret } from '../common/config';
import { hashPin, verifyPin } from '../common/pin';
import { Account, AuthSession, Household, HouseholdActivityLog, Member } from '../entities';
import { normalizeLoginName } from './account.credentials';
import { JwtUser } from './jwt.guard';
import {
  createRefreshToken,
  credentialSnapshot,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from './session.tokens';
import { isUniqueViolation } from '@family/shared';
import { LoginDto, RefreshDto, BootstrapDto, UpdatePasswordDto } from './auth.dto';
import { AUTH_ACCOUNT_SELECT, memberProfile } from './auth.shared';

export const AUTH_MEMBER_SELECT = {
  id: true,
  householdId: true,
  accountId: true,
  name: true,
  avatarEmoji: true,
  role: true,
  prefersCooking: true,
  disabledAt: true,
  createdAt: true,
} as const;

function accountProfile(account: Account) {
  return {
    id: account.id,
    loginName: account.loginName,
    requiresPasswordSetup: !account.passwordHash,
  };
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
export class AuthService {
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
    const requested = dto.timezone?.trim() ?? '';
    const timezone = validTimezone(requested) ? requested : 'Asia/Shanghai';
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
        const activityLogs = manager.getRepository(HouseholdActivityLog);
        await activityLogs.save(
          activityLogs.create({
            householdId: household.id,
            actorId: member.id,
            actorName: member.name,
            subjectMemberId: member.id,
            module: 'system',
            action: 'household_created',
            summary: `${member.name} 创建了家庭空间`,
            detail: household.name,
            targetPath: '/members',
            metadata: {},
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
      .where('member.accountId = :accountId', { accountId: account.id })
      .andWhere('member.disabledAt IS NULL');
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
        member.disabledAt ||
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
      householdTimezone: (await this.households.findOneByOrFail({ id: member.householdId })).timezone,
    };
  }
}
