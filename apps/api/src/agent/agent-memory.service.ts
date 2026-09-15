import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Brackets, DataSource, EntityManager, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  AgentMemoryConfidenceSource,
  AgentMemoryEvent,
  AgentMemoryEventOperation,
  AgentMemoryItem,
  AgentMemoryKind,
  AgentMemoryScope,
  AgentMemoryStatus,
  AgentMemberProfile,
} from '../entities';
import {
  decryptAgentMemoryContent,
  encryptAgentMemoryContent,
} from './agent.crypto';
import { AGENT_MEMORY_KEYS, AgentMemoryKey } from './agent.types';
import { isUniqueViolation } from '@family/shared';

const CANDIDATE_TTL_MS = 14 * 86_400_000;
const EPISODIC_SUMMARY_TTL_MS = 60 * 86_400_000;
const MAX_LIST_ITEMS = 50;
const MAX_SEARCH_ITEMS = 20;
const MAX_SEARCH_BYTES = 16_000;
const MAX_SEARCH_LOOKBACK_DAYS = 3_650;

export interface MemorySearchInput {
  scope: AgentMemoryScope;
  memoryKey?: AgentMemoryKey;
  limit?: number;
  maxBytes?: number;
  lookbackDays?: number;
}

export interface MemoryCandidateInput {
  content: string;
  memoryKey: AgentMemoryKey;
  category?: AgentMemoryKey;
  kind?: AgentMemoryKind;
  sourceType: string;
  sourceId?: string | null;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  confidenceSource?: AgentMemoryConfidenceSource;
}

export interface MemoryCorrectionInput {
  content: string;
  memoryKey?: AgentMemoryKey;
  category?: AgentMemoryKey;
  kind?: AgentMemoryKind;
}

export interface AgentMemoryProvider {
  search(input: MemorySearchInput, user: JwtUser): Promise<unknown[]>;
  createCandidate(input: MemoryCandidateInput, user: JwtUser): Promise<unknown>;
  confirm(id: string, expectedVersion: number, user: JwtUser): Promise<unknown>;
  correct(
    id: string,
    input: MemoryCorrectionInput,
    expectedVersion: number,
    user: JwtUser,
  ): Promise<unknown>;
  forget(id: string, expectedVersion: number, user: JwtUser): Promise<unknown>;
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number) {
  if (!Number.isInteger(value) || (value ?? 0) < 1) return fallback;
  return Math.min(value!, maximum);
}

@Injectable()
export class AgentMemoryService implements AgentMemoryProvider {
  constructor(
    @InjectRepository(AgentMemoryItem)
    private readonly items: Repository<AgentMemoryItem>,
    @InjectRepository(AgentMemberProfile)
    private readonly profiles: Repository<AgentMemberProfile>,
    private readonly dataSource: DataSource,
  ) {}

  async list(
    input: { status?: AgentMemoryStatus; scope?: AgentMemoryScope },
    user: JwtUser,
  ) {
    const status = input.status ?? 'active';
    const query = this.items
      .createQueryBuilder('memory')
      .where('memory.householdId = :householdId', {
        householdId: user.householdId,
      })
      .andWhere('memory.status = :status', {
        status,
      });
    if (status === 'active') {
      query.andWhere(
        '(memory.expiresAt IS NULL OR memory.expiresAt > CURRENT_TIMESTAMP)',
      );
      if (input.scope === 'member_private') {
        query
          .andWhere('memory.scope = :scope', { scope: 'member_private' })
          .andWhere('memory.ownerMemberId = :memberId', {
            memberId: user.memberId,
          });
      } else if (input.scope === 'household') {
        query.andWhere('memory.scope = :scope', { scope: 'household' });
      } else {
        query.andWhere(
          new Brackets((visible) => {
            visible.where('memory.scope = :householdScope', {
              householdScope: 'household',
            });
            visible.orWhere(
              '(memory.scope = :privateScope AND memory.ownerMemberId = :memberId)',
              {
                privateScope: 'member_private',
                memberId: user.memberId,
              },
            );
          }),
        );
      }
    } else {
      query.andWhere('memory.ownerMemberId = :memberId', {
        memberId: user.memberId,
      });
      if (input.scope) {
        query.andWhere('memory.scope = :scope', { scope: input.scope });
      }
    }
    const rows = await query
      .orderBy('memory.updatedAt', 'DESC')
      .take(MAX_LIST_ITEMS)
      .getMany();
    return Promise.all(rows.map((item) => this.present(item)));
  }

  async search(input: MemorySearchInput, user: JwtUser) {
    await this.requireMemoryEnabled(user);
    const limit = boundedInteger(input.limit, 10, MAX_SEARCH_ITEMS);
    const maxBytes = boundedInteger(
      input.maxBytes,
      MAX_SEARCH_BYTES,
      MAX_SEARCH_BYTES,
    );
    const lookbackDays = boundedInteger(
      input.lookbackDays,
      365,
      MAX_SEARCH_LOOKBACK_DAYS,
    );
    const since = new Date(Date.now() - lookbackDays * 86_400_000);
    const query = this.items
      .createQueryBuilder('memory')
      .where('memory.householdId = :householdId', {
        householdId: user.householdId,
      })
      .andWhere('memory.status = :status', { status: 'active' })
      .andWhere('memory.scope = :scope', { scope: input.scope })
      .andWhere('(memory.validFrom IS NULL OR memory.validFrom <= CURRENT_TIMESTAMP)')
      .andWhere('(memory.expiresAt IS NULL OR memory.expiresAt > CURRENT_TIMESTAMP)')
      .andWhere('memory.createdAt >= :since', { since });
    if (input.scope === 'member_private') {
      query.andWhere('memory.ownerMemberId = :memberId', {
        memberId: user.memberId,
      });
    }
    if (input.memoryKey) {
      query.andWhere('memory.memoryKey = :memoryKey', {
        memoryKey: input.memoryKey,
      });
    }
    const rows = await query
      .orderBy('memory.updatedAt', 'DESC')
      .take(limit)
      .getMany();
    const results: Awaited<ReturnType<AgentMemoryService['present']>>[] = [];
    let bytes = 0;
    for (const item of rows) {
      const presented = await this.present(item);
      const size = Buffer.byteLength(JSON.stringify(presented), 'utf8');
      if (bytes + size > maxBytes) break;
      bytes += size;
      results.push(presented);
    }
    return results;
  }

  async createCandidate(input: MemoryCandidateInput, user: JwtUser) {
    await this.requireMemoryEnabled(user);
    const content = this.validContent(input.content);
    this.assertMemoryKey(input.memoryKey);
    const id = randomUUID();
    const encrypted = encryptAgentMemoryContent(
      content,
      user.householdId,
      user.memberId,
      id,
    );
    if (!encrypted) {
      throw new ServiceUnavailableException('小管家记忆加密尚未配置');
    }
    const item = await this.dataSource.transaction(async (manager) => {
      const items = manager.getRepository(AgentMemoryItem);
      const created = await items.save(
        items.create({
          id,
          householdId: user.householdId,
          ownerMemberId: user.memberId,
          scope: 'member_private',
          kind: input.kind ?? 'preference',
          category: input.category ?? input.memoryKey,
          memoryKey: input.memoryKey,
          ...encrypted,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          sourceConversationId: input.sourceConversationId ?? null,
          sourceMessageId: input.sourceMessageId ?? null,
          status: 'candidate',
          confirmedByMemberId: null,
          confidenceSource: input.confidenceSource ?? 'summary_candidate',
          validFrom: null,
          expiresAt: new Date(Date.now() + CANDIDATE_TTL_MS),
          version: 1,
        }),
      );
      await this.recordEvent(manager, created, 'created', user.memberId, null, {
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
      });
      return created;
    });
    return this.present(item);
  }

  async confirm(id: string, expectedVersion: number, user: JwtUser) {
    await this.requireMemoryEnabled(user);
    try {
      const item = await this.dataSource.transaction(async (manager) => {
        const items = manager.getRepository(AgentMemoryItem);
        const current = await this.requireOwned(manager, id, user);
        if (current.status === 'active') return current;
        if (current.status !== 'candidate') {
          throw new ConflictException('这条小管家记忆当前不能确认');
        }
        this.assertVersion(current, expectedVersion);
        const result = await items.update(
          { id: current.id, version: expectedVersion },
          {
            status: 'active',
            confirmedByMemberId: user.memberId,
            validFrom: new Date(),
            expiresAt:
              current.kind === 'episodic_summary'
                ? new Date(Date.now() + EPISODIC_SUMMARY_TTL_MS)
                : null,
            version: current.version + 1,
          },
        );
        if (!result.affected) {
          const raced = await items.findOneBy({ id: current.id });
          if (raced?.status === 'active') return raced;
          this.versionConflict();
        }
        const updated = (await items.findOneBy({
          id: current.id,
        }))!;
        await this.recordEvent(
          manager,
          updated,
          'confirmed',
          user.memberId,
          current.scope,
        );
        return updated;
      });
      return this.present(item);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('已有同类的小管家记忆，请先处理现有记录');
      }
      throw error;
    }
  }

  async correct(
    id: string,
    input: MemoryCorrectionInput,
    expectedVersion: number,
    user: JwtUser,
  ) {
    await this.requireMemoryEnabled(user);
    const content = this.validContent(input.content);
    if (input.memoryKey) this.assertMemoryKey(input.memoryKey);
    try {
      const item = await this.dataSource.transaction(async (manager) => {
        const current = await this.requireOwned(manager, id, user);
        if (!['candidate', 'active'].includes(current.status)) {
          throw new ConflictException('这条小管家记忆当前不能修改');
        }
        this.assertVersion(current, expectedVersion);
        const encrypted = encryptAgentMemoryContent(
          content,
          current.householdId,
          current.ownerMemberId,
          current.id,
        );
        if (!encrypted) {
          throw new ServiceUnavailableException('小管家记忆加密尚未配置');
        }
        const result = await manager.getRepository(AgentMemoryItem).update(
          { id: current.id, version: expectedVersion },
          {
            ...encrypted,
            memoryKey: input.memoryKey ?? current.memoryKey,
            category: input.category ?? current.category,
            kind: input.kind ?? current.kind,
            expiresAt:
              current.status === 'active'
                ? (input.kind ?? current.kind) === 'episodic_summary'
                  ? new Date(Date.now() + EPISODIC_SUMMARY_TTL_MS)
                  : null
                : current.expiresAt,
            version: current.version + 1,
          },
        );
        if (!result.affected) this.versionConflict();
        const updated = (await manager.getRepository(AgentMemoryItem).findOneBy({
          id: current.id,
        }))!;
        await this.recordEvent(
          manager,
          updated,
          'corrected',
          user.memberId,
          current.scope,
        );
        return updated;
      });
      return this.present(item);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('已有同类的小管家记忆，请先处理现有记录');
      }
      throw error;
    }
  }

  async share(id: string, expectedVersion: number, user: JwtUser) {
    await this.requireMemoryEnabled(user);
    try {
      const item = await this.dataSource.transaction(async (manager) => {
        const items = manager.getRepository(AgentMemoryItem);
        const current = await this.requireOwned(manager, id, user);
        if (current.scope === 'household' && current.status === 'active') {
          return current;
        }
        if (current.status !== 'active') {
          throw new ConflictException('只有已确认的记忆可以共享给家庭');
        }
        this.assertVersion(current, expectedVersion);
        const result = await items.update(
          { id: current.id, version: expectedVersion },
          { scope: 'household', version: current.version + 1 },
        );
        if (!result.affected) {
          const raced = await items.findOneBy({ id: current.id });
          if (raced?.status === 'active' && raced.scope === 'household') {
            return raced;
          }
          this.versionConflict();
        }
        const updated = (await items.findOneBy({
          id: current.id,
        }))!;
        await this.recordEvent(
          manager,
          updated,
          'shared',
          user.memberId,
          current.scope,
        );
        return updated;
      });
      return this.present(item);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('已有同类的家庭记忆，请先处理现有记录');
      }
      throw error;
    }
  }

  async forget(id: string, expectedVersion: number, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const items = manager.getRepository(AgentMemoryItem);
      const current = await this.requireOwned(manager, id, user);
      if (['forgotten', 'expired'].includes(current.status)) {
        return { id: current.id, forgotten: true as const, status: current.status };
      }
      this.assertVersion(current, expectedVersion);
      const result = await items.update(
        { id: current.id, version: expectedVersion },
        {
          status: 'forgotten',
          contentCiphertext: null,
          contentNonce: null,
          contentVersion: null,
          version: current.version + 1,
        },
      );
      if (!result.affected) {
        const raced = await items.findOneBy({ id: current.id });
        if (raced && ['forgotten', 'expired'].includes(raced.status)) {
          return { id: raced.id, forgotten: true as const, status: raced.status };
        }
        this.versionConflict();
      }
      await this.recordEvent(
        manager,
        current,
        'forgotten',
        user.memberId,
        current.scope,
      );
      return { id: current.id, forgotten: true as const, status: 'forgotten' };
    });
  }

  async clearAll(user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const items = manager.getRepository(AgentMemoryItem);
      const rows = await items
        .createQueryBuilder('memory')
        .where('memory.householdId = :householdId', {
          householdId: user.householdId,
        })
        .andWhere('memory.ownerMemberId = :memberId', {
          memberId: user.memberId,
        })
        .andWhere('memory.scope = :scope', { scope: 'member_private' })
        .andWhere('memory.status NOT IN (:...terminal)', {
          terminal: ['forgotten', 'expired'],
        })
        .getMany();
      if (!rows.length) return { forgottenCount: 0 };
      await items
        .createQueryBuilder()
        .update()
        .set({
          status: 'forgotten',
          contentCiphertext: null,
          contentNonce: null,
          contentVersion: null,
          version: () => '"version" + 1',
        })
        .whereInIds(rows.map((item) => item.id))
        .execute();
      for (const item of rows) {
        await this.recordEvent(
          manager,
          item,
          'forgotten',
          user.memberId,
          item.scope,
        );
      }
      return { forgottenCount: rows.length };
    });
  }

  private async requireMemoryEnabled(user: JwtUser) {
    let profile = await this.profiles.findOneBy({
      householdId: user.householdId,
      memberId: user.memberId,
    });
    if (!profile) {
      try {
        profile = await this.profiles.save(
          this.profiles.create({
            householdId: user.householdId,
            memberId: user.memberId,
            enabled: true,
            assistantName: '小管家',
            responseStyle: 'balanced',
            memoryEnabled: true,
            memorySuggestionEnabled: false,
            proactiveRoutinesEnabled: false,
            version: 1,
          }),
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        profile = await this.profiles.findOneBy({
          householdId: user.householdId,
          memberId: user.memberId,
        });
      }
    }
    if (!profile?.memoryEnabled) {
      throw new ForbiddenException('你的小管家记忆当前未启用');
    }
  }

  private async requireOwned(manager: EntityManager, id: string, user: JwtUser) {
    const item = await manager.getRepository(AgentMemoryItem).findOneBy({
      id,
      householdId: user.householdId,
      ownerMemberId: user.memberId,
    });
    if (!item) throw new NotFoundException('小管家记忆不存在');
    return item;
  }

  private async recordEvent(
    manager: EntityManager,
    item: AgentMemoryItem,
    operation: AgentMemoryEventOperation,
    actorMemberId: string,
    fromScope: AgentMemoryScope | null,
    source?: { sourceType: string; sourceId: string | null },
  ) {
    const events = manager.getRepository(AgentMemoryEvent);
    await events.save(
      events.create({
        householdId: item.householdId,
        memoryItemId: item.id,
        actorMemberId,
        operation,
        fromScope,
        toScope: item.scope,
        sourceType: source?.sourceType ?? item.sourceType,
        sourceId: source?.sourceId ?? item.sourceId,
      }),
    );
  }

  private validContent(value: string) {
    const content = value.trim();
    if (!content || content.length > 2_000) {
      throw new BadRequestException('记忆正文长度必须在 1 到 2000 字符之间');
    }
    return content;
  }

  private assertMemoryKey(value: string) {
    if (!AGENT_MEMORY_KEYS.includes(value as AgentMemoryKey)) {
      throw new BadRequestException('不支持的记忆分类键');
    }
  }

  private assertVersion(item: AgentMemoryItem, expectedVersion: number) {
    if (item.version !== expectedVersion) this.versionConflict();
  }

  private versionConflict(): never {
    throw new ConflictException('小管家记忆已被其他操作更新，请刷新后重试');
  }

  private async present(item: AgentMemoryItem) {
    let content: string | null = null;
    if (
      ['candidate', 'active'].includes(item.status) &&
      item.contentCiphertext &&
      item.contentNonce
    ) {
      try {
        content = decryptAgentMemoryContent(
          item.contentCiphertext,
          item.contentNonce,
          item.householdId,
          item.ownerMemberId,
          item.id,
        );
        if (content == null) {
          throw new Error('Agent memory data key is unavailable');
        }
      } catch {
        throw new ServiceUnavailableException('小管家记忆暂时无法读取');
      }
    }
    return {
      id: item.id,
      ownerMemberId: item.ownerMemberId,
      scope: item.scope,
      kind: item.kind,
      category: item.category,
      memoryKey: item.memoryKey,
      content,
      status: item.status,
      confidenceSource: item.confidenceSource,
      confirmedByMemberId: item.confirmedByMemberId,
      validFrom: item.validFrom,
      expiresAt: item.expiresAt,
      source: {
        type: item.sourceType,
        id: item.sourceId,
        conversationId: item.sourceConversationId,
        messageId: item.sourceMessageId,
      },
      visibility: item.scope,
      untrustedContent: true,
      version: item.version,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
