import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { hasCapability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import {
  AgentChannelPairing,
  AgentMemberChannel,
  Member,
} from '../entities';
import { AgentService } from './agent.service';
import { isUniqueViolation } from '@family/shared';

const PLATFORM_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;

function normalizePlatform(value: string) {
  const platform = value.trim().toLocaleLowerCase('en-US');
  if (!PLATFORM_PATTERN.test(platform)) {
    throw new BadRequestException('消息渠道标识只能包含小写字母、数字、点、下划线或短横线');
  }
  return platform;
}

function normalizeExternalAccount(value: string) {
  const account = value.trim();
  if (!account || account.length > 200) {
    throw new BadRequestException('外部账号标识无效');
  }
  return account;
}

function normalizePairingCode(value: string) {
  const code = value.replace(/[^a-z0-9]/gi, '').toLocaleUpperCase('en-US');
  if (code.length < 8 || code.length > 32) {
    throw new GoneException('配对码无效或已过期');
  }
  return code;
}

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function pairingCode() {
  return randomBytes(5).toString('hex').toLocaleUpperCase('en-US');
}

function externalAccountHash(platform: string, account: string) {
  return hash(`${platform}\u0000${account}`);
}

function accountHint(account: string) {
  return account.length <= 4 ? account : `…${account.slice(-4)}`;
}

interface CreatePairingInput {
  memberId: string;
  platform: string;
  expiresInMinutes?: number;
  idempotencyKey: string;
}

@Injectable()
export class AgentChannelsService {
  constructor(
    @InjectRepository(AgentMemberChannel)
    private readonly channels: Repository<AgentMemberChannel>,
    @InjectRepository(AgentChannelPairing)
    private readonly pairings: Repository<AgentChannelPairing>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly dataSource: DataSource,
    private readonly agent: AgentService,
  ) {}

  async listChannels(user: JwtUser) {
    const rows = await this.channels.find({
      where: hasCapability(user, 'manage_agent')
        ? { householdId: user.householdId }
        : { householdId: user.householdId, memberId: user.memberId },
      order: { pairedAt: 'DESC' },
      take: 100,
    });
    return rows.map((row) => this.presentChannel(row, user));
  }

  async listPairings(user: JwtUser) {
    if (!hasCapability(user, 'manage_agent')) {
      throw new ForbiddenException('只有家庭管理员可以管理消息渠道配对');
    }
    const rows = await this.pairings.find({
      where: { householdId: user.householdId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return rows.map((row) => this.presentPairing(row));
  }

  async createPairing(input: CreatePairingInput, user: JwtUser) {
    if (!hasCapability(user, 'manage_agent')) {
      throw new ForbiddenException('只有家庭管理员可以创建消息渠道配对');
    }
    const memberId = input.memberId.trim();
    const platform = normalizePlatform(input.platform);
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 180) {
      throw new BadRequestException('配对请求幂等键无效');
    }
    const existing = await this.pairings.findOneBy({
      householdId: user.householdId,
      idempotencyKey,
    });
    if (existing) return { ...this.presentPairing(existing), pairingCode: null, replayed: true };

    const member = await this.members.findOneBy({
      id: memberId,
      householdId: user.householdId,
      disabledAt: IsNull(),
    });
    if (!member) throw new NotFoundException('目标家庭成员不存在或已停用');

    const expiresInMinutes = Math.min(
      Math.max(Math.trunc(input.expiresInMinutes ?? 10), 1),
      60,
    );
    const plainCode = pairingCode();
    try {
      const created = await this.pairings.save(
        this.pairings.create({
          householdId: user.householdId,
          memberId: member.id,
          member,
          createdByMemberId: user.memberId,
          platform,
          codeHash: hash(plainCode),
          idempotencyKey,
          expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
          usedAt: null,
          revokedAt: null,
          channelId: null,
          channel: null,
          version: 1,
        }),
      );
      return { ...this.presentPairing(created), pairingCode: plainCode, replayed: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const duplicate = await this.pairings.findOneBy({
          householdId: user.householdId,
          idempotencyKey,
        });
        if (duplicate) {
          return { ...this.presentPairing(duplicate), pairingCode: null, replayed: true };
        }
      }
      throw error;
    }
  }

  async revokePairing(id: string, user: JwtUser) {
    if (!hasCapability(user, 'manage_agent')) {
      throw new ForbiddenException('只有家庭管理员可以撤销消息渠道配对');
    }
    const pairing = await this.pairings.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!pairing) throw new NotFoundException('配对记录不存在');
    if (!pairing.revokedAt && !pairing.usedAt) {
      await this.pairings.update(pairing.id, {
        revokedAt: new Date(),
        version: pairing.version + 1,
      });
    }
    return this.presentPairing((await this.pairings.findOneBy({ id: pairing.id }))!);
  }

  async revokeChannel(id: string, expectedVersion: number, user: JwtUser) {
    const channel = await this.channels.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!channel) throw new NotFoundException('消息渠道绑定不存在');
    if (!hasCapability(user, 'manage_agent') && channel.memberId !== user.memberId) {
      throw new ForbiddenException('只能撤销自己的消息渠道绑定');
    }
    if (channel.revokedAt) return this.presentChannel(channel, user);
    const result = await this.channels.update(
      { id: channel.id, householdId: user.householdId, version: expectedVersion },
      { revokedAt: new Date(), version: channel.version + 1 },
    );
    if (!result.affected) {
      throw new ConflictException('消息渠道绑定已被其他成员更新，请刷新后重试');
    }
    return this.presentChannel((await this.channels.findOneBy({ id: channel.id }))!, user);
  }

  async pair(
    codeInput: string,
    externalAccountInput: string,
    externalDisplayName: string | undefined,
    externalHint: string | undefined,
  ) {
    const code = normalizePairingCode(codeInput);
    const codeHash = hash(code);
    const externalAccount = normalizeExternalAccount(externalAccountInput);
    let resolvedPlatform: string | null = null;
    let resolvedHouseholdId: string | null = null;
    return this.dataSource.transaction(async (manager) => {
      const pairings = manager.getRepository(AgentChannelPairing);
      const pairing = await pairings
        .createQueryBuilder('pairing')
        .addSelect('pairing.codeHash')
        .where('pairing.codeHash = :codeHash', { codeHash })
        .setLock('pessimistic_write')
        .getOne();
      if (!pairing) throw new GoneException('配对码无效或已过期');
      resolvedPlatform = pairing.platform;
      resolvedHouseholdId = pairing.householdId;
      if (pairing.revokedAt || pairing.expiresAt.getTime() <= Date.now()) {
        throw new GoneException('配对码无效或已过期');
      }
      const members = manager.getRepository(Member);
      const member = await members.findOneBy({
        id: pairing.memberId,
        householdId: pairing.householdId,
        disabledAt: IsNull(),
      });
      if (!member) throw new GoneException('配对目标成员已停用');

      const refHash = externalAccountHash(pairing.platform, externalAccount);
      const channels = manager.getRepository(AgentMemberChannel);
      if (pairing.usedAt && pairing.channelId) {
        const existing = await channels.findOneBy({
          id: pairing.channelId,
          householdId: pairing.householdId,
        });
        if (existing && existing.externalAccountRefHash === refHash) {
          return { channel: this.presentChannel(existing), replayed: true };
        }
        throw new ConflictException('配对码已经使用');
      }

      const active = await channels.findOneBy({
        householdId: pairing.householdId,
        platform: pairing.platform,
        externalAccountRefHash: refHash,
        revokedAt: IsNull(),
      });
      if (active) {
        if (active.memberId !== pairing.memberId) {
          throw new ConflictException('外部账号已经绑定到其他家庭成员');
        }
        pairing.usedAt = new Date();
        pairing.channelId = active.id;
        pairing.version += 1;
        await pairings.save(pairing);
        return { channel: this.presentChannel(active), replayed: true };
      }

      const channel = await channels.save(
        channels.create({
          householdId: pairing.householdId,
          memberId: member.id,
          member,
          platform: pairing.platform,
          externalAccountRefHash: refHash,
          externalAccountLabel: externalDisplayName?.trim().slice(0, 120) || null,
          externalAccountHint:
            externalHint?.trim().slice(0, 32) || accountHint(externalAccount),
          pairedAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
          version: 1,
        }),
      );
      pairing.usedAt = new Date();
      pairing.channelId = channel.id;
      pairing.version += 1;
      await pairings.save(pairing);
      return { channel: this.presentChannel(channel), replayed: false };
    }).catch(async (error) => {
      if (!isUniqueViolation(error)) throw error;
      if (!resolvedPlatform || !resolvedHouseholdId) throw error;
      const refHash = externalAccountHash(resolvedPlatform, externalAccount);
      const existing = await this.channels.findOneBy({
        householdId: resolvedHouseholdId,
        externalAccountRefHash: refHash,
        revokedAt: IsNull(),
      });
      if (existing) return { channel: this.presentChannel(existing), replayed: true };
      throw error;
    });
  }

  async sendChannelMessage(
    channelId: string,
    externalThreadRef: string,
    message: string,
    clientRequestId: string,
  ) {
    const channel = await this.channels.findOneBy({ id: channelId });
    if (!channel || channel.revokedAt) {
      throw new ForbiddenException('消息渠道绑定已撤销');
    }
    if (channel.member.disabledAt) {
      throw new ForbiddenException('家庭成员已停用');
    }
    const trimmedThread = externalThreadRef.trim();
    if (!trimmedThread || trimmedThread.length > 180) {
      throw new BadRequestException('外部会话标识无效');
    }
    const result = await this.agent.queueChannelMessage(
      channel,
      trimmedThread,
      message,
      clientRequestId,
    );
    await this.channels.update(channel.id, {
      lastUsedAt: new Date(),
      version: () => '"version" + 1',
    });
    return result;
  }

  async channelRun(channelId: string, runId: string) {
    const channel = await this.channels.findOneBy({ id: channelId });
    if (!channel || channel.revokedAt) {
      throw new ForbiddenException('消息渠道绑定已撤销');
    }
    if (channel.member.disabledAt) {
      throw new ForbiddenException('家庭成员已停用');
    }
    return this.agent.channelRun(runId, channelId);
  }

  private presentChannel(channel: AgentMemberChannel, user?: JwtUser) {
    return {
      id: channel.id,
      memberId: channel.memberId,
      memberName: channel.member?.name ?? null,
      platform: channel.platform,
      externalAccountLabel: channel.externalAccountLabel,
      externalAccountHint: channel.externalAccountHint,
      pairedAt: channel.pairedAt,
      lastUsedAt: channel.lastUsedAt,
      revokedAt: channel.revokedAt,
      version: channel.version,
      canRevoke:
        Boolean(user && hasCapability(user, 'manage_agent')) ||
        Boolean(user && user.memberId === channel.memberId),
    };
  }

  private presentPairing(pairing: AgentChannelPairing) {
    const status = pairing.revokedAt
      ? 'revoked'
      : pairing.usedAt
        ? 'used'
        : pairing.expiresAt.getTime() <= Date.now()
          ? 'expired'
          : 'pending';
    return {
      id: pairing.id,
      memberId: pairing.memberId,
      memberName: pairing.member?.name ?? null,
      platform: pairing.platform,
      expiresAt: pairing.expiresAt,
      usedAt: pairing.usedAt,
      revokedAt: pairing.revokedAt,
      channelId: pairing.channelId,
      status,
      version: pairing.version,
      createdAt: pairing.createdAt,
    };
  }
}
