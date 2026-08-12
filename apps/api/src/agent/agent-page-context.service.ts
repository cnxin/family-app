import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetsService } from '../assets/assets.module';
import { JwtUser } from '../auth/jwt.guard';
import { Dish } from '../entities';
import { KnowledgeService } from '../knowledge/knowledge.module';
import { PollsService } from '../polls/polls.module';
import { TravelService } from '../travel/travel.module';
import {
  AgentPageContextCandidate,
  AgentPageEntityType,
  AgentResolvedPageContext,
} from './agent.types';

const MAX_PAGE_CONTEXT_BYTES = 500;
const MAX_CONTEXT_VALUE_BYTES = 180;

function safeText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateUtf8(value: string, maxBytes: number) {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function boundedText(value: string) {
  return truncateUtf8(safeText(value), MAX_CONTEXT_VALUE_BYTES);
}

@Injectable()
export class AgentPageContextService {
  constructor(
    @InjectRepository(Dish)
    private readonly dishes: Repository<Dish>,
    private readonly assets: AssetsService,
    private readonly knowledge: KnowledgeService,
    private readonly travel: TravelService,
    private readonly polls: PollsService,
  ) {}

  async resolve(
    candidate: AgentPageContextCandidate | undefined,
    user: JwtUser,
  ): Promise<AgentResolvedPageContext | null> {
    if (!candidate) return null;
    const route = boundedText(candidate.route);
    if (!route) return null;

    const hasEntityReference = Boolean(
      candidate.entityType || candidate.entityId,
    );
    let name: string | undefined;
    if (hasEntityReference) {
      if (!candidate.entityType || !candidate.entityId) return null;
      let resolvedName: string | null;
      try {
        resolvedName = await this.resolveEntityName(
          candidate.entityType,
          candidate.entityId,
          user,
        );
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ForbiddenException
        ) {
          return null;
        }
        throw error;
      }
      if (!resolvedName) return null;
      name = resolvedName;
    }

    const resolved: AgentResolvedPageContext = {
      route,
      ...(candidate.entityType ? { entityType: candidate.entityType } : {}),
      ...(name && candidate.entityId ? { entityId: candidate.entityId } : {}),
      ...(name ? { name: boundedText(name) } : {}),
      ...(candidate.selectedDate ? { date: candidate.selectedDate } : {}),
      untrustedContent: true,
    };
    if (Buffer.byteLength(JSON.stringify(resolved), 'utf8') > MAX_PAGE_CONTEXT_BYTES) {
      return null;
    }
    return resolved;
  }

  private async resolveEntityName(
    entityType: AgentPageEntityType,
    entityId: string,
    user: JwtUser,
  ) {
    switch (entityType) {
      case 'dish': {
        const dish = await this.dishes.findOne({
          select: { id: true, name: true },
          where: { id: entityId, householdId: user.householdId },
        });
        return dish?.name ?? null;
      }
      case 'asset':
        return (await this.assets.get(entityId, user.householdId)).name;
      case 'knowledge':
        return (await this.knowledge.detail(entityId, user)).title;
      case 'travel':
        return (await this.travel.detail(entityId, user)).title;
      case 'poll':
        return (await this.polls.get(entityId, user)).title;
    }
  }
}
