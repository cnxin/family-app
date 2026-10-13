import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  KnowledgeArticle,
  KnowledgeArticleRevision,
  KnowledgeRevisionChangeType,
} from '../entities';
import { rawFingerprint as fingerprint } from '../common/fingerprint';
import { isHouseholdManager, normalizedRequiredText, normalizedText } from '@family/shared';
import {
  KnowledgeListQueryDto,
  CreateKnowledgeArticleDto,
  UpdateKnowledgeArticleDto,
  KnowledgeVersionOperationDto,
} from './knowledge.dto';

function normalizedTags(values?: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const tag = value.trim();
    const key = tag.toLocaleLowerCase('zh-CN');
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeArticle)
    private readonly articles: Repository<KnowledgeArticle>,
    @InjectRepository(KnowledgeArticleRevision)
    private readonly revisions: Repository<KnowledgeArticleRevision>,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: KnowledgeListQueryDto, user: JwtUser) {
    const status = query.status ?? 'active';
    const builder = this.articles
      .createQueryBuilder('article')
      .leftJoinAndSelect('article.createdBy', 'createdBy')
      .leftJoinAndSelect('article.updatedBy', 'updatedBy')
      .where('article.householdId = :householdId', {
        householdId: user.householdId,
      });

    if (status === 'active') builder.andWhere('article.archivedAt IS NULL');
    if (status === 'archived') builder.andWhere('article.archivedAt IS NOT NULL');
    if (query.category) {
      builder.andWhere('article.category = :category', {
        category: query.category,
      });
    }
    const q = normalizedText(query.q);
    if (q) {
      builder.andWhere(
        '(article.title ILIKE :q OR article.summary ILIKE :q OR article.content ILIKE :q)',
        { q: `%${q}%` },
      );
    }
    const tag = normalizedText(query.tag);
    if (tag) {
      builder.andWhere('article.tags @> CAST(:tag AS jsonb)', {
        tag: JSON.stringify([tag]),
      });
    }

    const articles = await builder
      .orderBy('article.isPinned', 'DESC')
      .addOrderBy('article.updatedAt', 'DESC')
      .take(query.limit ?? 100)
      .getMany();
    return articles.map((article) => this.articleResponse(article, user));
  }

  async detail(id: string, user: JwtUser) {
    return this.articleResponse(await this.requireArticle(id, user.householdId), user);
  }

  async listRevisions(id: string, user: JwtUser) {
    await this.requireArticle(id, user.householdId);
    const revisions = await this.revisions.find({
      where: { articleId: id, householdId: user.householdId },
      order: { version: 'DESC' },
      take: 100,
    });
    return revisions.map((revision) => this.revisionResponse(revision));
  }

  async create(dto: CreateKnowledgeArticleDto, user: JwtUser) {
    if (dto.isPinned && !isHouseholdManager(user)) {
      throw new ForbiddenException('只有家庭管理员可以置顶知识文章');
    }
    const payload = {
      title: normalizedRequiredText(dto.title, '标题'),
      category: dto.category,
      summary: normalizedText(dto.summary),
      content: normalizedRequiredText(dto.content, '正文'),
      referenceUrl: normalizedText(dto.referenceUrl),
      tags: normalizedTags(dto.tags),
      isPinned: dto.isPinned ?? false,
    };
    const idempotencyKey = normalizedRequiredText(
      dto.idempotencyKey,
      '幂等键',
    );
    const requestFingerprint = fingerprint({ operation: 'create', ...payload });
    const existing = await this.findIdempotent(
      idempotencyKey,
      requestFingerprint,
      user,
    );
    if (existing) return this.articleResponse(existing, user);

    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findIdempotent(
          idempotencyKey,
          requestFingerprint,
          user,
          manager,
        );
        if (duplicate) return duplicate.id;

        const articleRepository = manager.getRepository(KnowledgeArticle);
        const article = await articleRepository.save(
          articleRepository.create({
            householdId: user.householdId,
            ...payload,
            version: 1,
            createdById: user.memberId,
            updatedById: user.memberId,
            archivedAt: null,
          }),
        );
        await this.saveRevision(
          manager,
          article,
          'create',
          idempotencyKey,
          requestFingerprint,
          user,
        );
        await recordActivity(manager, user, {
          module: 'knowledge',
          action: 'knowledge_article_created',
          summary: `${user.name}创建了知识文章「${article.title}」`,
          targetPath: '/knowledge',
          metadata: { articleId: article.id, version: article.version },
        });
        return article.id;
      });
      return this.detail(id, user);
    } catch (error) {
      return this.resolveIdempotencyRace(
        error,
        idempotencyKey,
        requestFingerprint,
        user,
      );
    }
  }

  async update(id: string, dto: UpdateKnowledgeArticleDto, user: JwtUser) {
    const fields = {
      ...(dto.title !== undefined
        ? { title: normalizedRequiredText(dto.title, '标题') }
        : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.summary !== undefined
        ? { summary: normalizedText(dto.summary) }
        : {}),
      ...(dto.content !== undefined
        ? { content: normalizedRequiredText(dto.content, '正文') }
        : {}),
      ...(dto.referenceUrl !== undefined
        ? { referenceUrl: normalizedText(dto.referenceUrl) }
        : {}),
      ...(dto.tags !== undefined ? { tags: normalizedTags(dto.tags) } : {}),
      ...(dto.isPinned !== undefined ? { isPinned: dto.isPinned } : {}),
    };
    if (!Object.keys(fields).length) {
      throw new BadRequestException('至少提供一个需要更新的字段');
    }
    return this.mutate(
      id,
      dto,
      'update',
      { operation: 'update', articleId: id, ...fields },
      user,
      (article) => {
        if (article.archivedAt) {
          throw new ConflictException('已归档文章需要先恢复再编辑');
        }
        if (dto.isPinned !== undefined && !isHouseholdManager(user)) {
          throw new ForbiddenException('只有家庭管理员可以调整置顶状态');
        }
        Object.assign(article, fields);
      },
      '更新',
    );
  }

  archive(id: string, dto: KnowledgeVersionOperationDto, user: JwtUser) {
    return this.mutate(
      id,
      dto,
      'archive',
      { operation: 'archive', articleId: id },
      user,
      (article) => {
        if (article.archivedAt) throw new ConflictException('文章已经归档');
        article.archivedAt = new Date();
        article.isPinned = false;
      },
      '归档',
    );
  }

  restore(id: string, dto: KnowledgeVersionOperationDto, user: JwtUser) {
    return this.mutate(
      id,
      dto,
      'restore',
      { operation: 'restore', articleId: id },
      user,
      (article) => {
        if (!article.archivedAt) throw new ConflictException('文章当前未归档');
        article.archivedAt = null;
      },
      '恢复',
    );
  }

  async restoreRevision(
    id: string,
    versionValue: string,
    dto: KnowledgeVersionOperationDto,
    user: JwtUser,
  ) {
    const targetVersion = Number(versionValue);
    if (!Number.isInteger(targetVersion) || targetVersion < 1) {
      throw new BadRequestException('历史版本必须是正整数');
    }
    return this.mutate(
      id,
      dto,
      'restore_revision',
      { operation: 'restore_revision', articleId: id, targetVersion },
      user,
      async (article, manager) => {
        if (article.archivedAt) {
          throw new ConflictException('已归档文章需要先恢复再还原历史版本');
        }
        const target = await manager
          .getRepository(KnowledgeArticleRevision)
          .findOneBy({
            articleId: id,
            householdId: user.householdId,
            version: targetVersion,
          });
        if (!target) throw new NotFoundException('知识文章历史版本不存在');
        article.title = target.title;
        article.category = target.category;
        article.summary = target.summary;
        article.content = target.content;
        article.referenceUrl = target.referenceUrl;
        article.tags = target.tags;
      },
      `还原到 v${targetVersion}`,
    );
  }

  private async mutate(
    id: string,
    dto: KnowledgeVersionOperationDto,
    changeType: KnowledgeRevisionChangeType,
    fingerprintPayload: Record<string, unknown>,
    user: JwtUser,
    apply: (
      article: KnowledgeArticle,
      manager: EntityManager,
    ) => void | Promise<void>,
    actionLabel: string,
  ) {
    const idempotencyKey = normalizedRequiredText(
      dto.idempotencyKey,
      '幂等键',
    );
    const requestFingerprint = fingerprint({
      ...fingerprintPayload,
      expectedVersion: dto.expectedVersion,
    });
    const existing = await this.findIdempotent(
      idempotencyKey,
      requestFingerprint,
      user,
    );
    if (existing) return this.articleResponse(existing, user);

    try {
      const articleId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findIdempotent(
          idempotencyKey,
          requestFingerprint,
          user,
          manager,
        );
        if (duplicate) return duplicate.id;

        const article = await manager
          .getRepository(KnowledgeArticle)
          .createQueryBuilder('article')
          .setLock('pessimistic_write')
          .where('article.id = :id AND article.householdId = :householdId', {
            id,
            householdId: user.householdId,
          })
          .getOne();
        if (!article) throw new NotFoundException('知识文章不存在');
        this.assertCanManage(article, user);
        if (article.version !== dto.expectedVersion) {
          throw new ConflictException(
            `文章已更新，请刷新后重试（当前 v${article.version}）`,
          );
        }

        await apply(article, manager);
        article.version += 1;
        article.updatedById = user.memberId;
        const saved = await manager.getRepository(KnowledgeArticle).save(article);
        await this.saveRevision(
          manager,
          saved,
          changeType,
          idempotencyKey,
          requestFingerprint,
          user,
        );
        await recordActivity(manager, user, {
          module: 'knowledge',
          action: `knowledge_article_${changeType}`,
          summary: `${user.name}${actionLabel}了知识文章「${saved.title}」`,
          targetPath: '/knowledge',
          metadata: { articleId: saved.id, version: saved.version },
        });
        return saved.id;
      });
      return this.detail(articleId, user);
    } catch (error) {
      return this.resolveIdempotencyRace(
        error,
        idempotencyKey,
        requestFingerprint,
        user,
      );
    }
  }

  private async saveRevision(
    manager: EntityManager,
    article: KnowledgeArticle,
    changeType: KnowledgeRevisionChangeType,
    idempotencyKey: string,
    requestFingerprint: string,
    user: JwtUser,
  ) {
    const repository = manager.getRepository(KnowledgeArticleRevision);
    await repository.save(
      repository.create({
        householdId: article.householdId,
        articleId: article.id,
        version: article.version,
        changeType,
        title: article.title,
        category: article.category,
        summary: article.summary,
        content: article.content,
        referenceUrl: article.referenceUrl,
        tags: article.tags,
        isPinned: article.isPinned,
        archivedAt: article.archivedAt,
        changedById: user.memberId,
        changedByName: user.name,
        idempotencyKey,
        requestFingerprint,
      }),
    );
  }

  private async findIdempotent(
    idempotencyKey: string,
    requestFingerprint: string,
    user: JwtUser,
    manager?: EntityManager,
  ) {
    const revision = await (manager?.getRepository(KnowledgeArticleRevision) ??
      this.revisions
    ).findOneBy({
      householdId: user.householdId,
      idempotencyKey,
    });
    if (!revision) return null;
    if (revision.requestFingerprint !== requestFingerprint) {
      throw new ConflictException('幂等键已用于不同的知识库操作');
    }
    const article = await (manager?.getRepository(KnowledgeArticle) ??
      this.articles
    ).findOneBy({
      id: revision.articleId,
      householdId: user.householdId,
    });
    if (!article) throw new NotFoundException('知识文章不存在');
    return article;
  }

  private async resolveIdempotencyRace(
    error: unknown,
    idempotencyKey: string,
    requestFingerprint: string,
    user: JwtUser,
  ) {
    const code =
      (error as { driverError?: { code?: string } })?.driverError?.code ??
      (error as { code?: string })?.code;
    if (code === '23505') {
      const existing = await this.findIdempotent(
        idempotencyKey,
        requestFingerprint,
        user,
      );
      if (existing) return this.articleResponse(existing, user);
    }
    throw error;
  }

  private requireArticle(id: string, householdId: string) {
    return this.articles.findOne({
      where: { id, householdId },
    }).then((article) => {
      if (!article) throw new NotFoundException('知识文章不存在');
      return article;
    });
  }

  private assertCanManage(article: KnowledgeArticle, user: JwtUser) {
    if (!isHouseholdManager(user) && article.createdById !== user.memberId) {
      throw new ForbiddenException('只能维护自己创建的知识文章');
    }
  }

  private articleResponse(article: KnowledgeArticle, user: JwtUser) {
    return {
      id: article.id,
      title: article.title,
      category: article.category,
      summary: article.summary,
      content: article.content,
      referenceUrl: article.referenceUrl,
      tags: article.tags,
      isPinned: article.isPinned,
      version: article.version,
      createdBy: {
        id: article.createdBy.id,
        name: article.createdBy.name,
        avatarEmoji: article.createdBy.avatarEmoji,
      },
      updatedBy: {
        id: article.updatedBy.id,
        name: article.updatedBy.name,
        avatarEmoji: article.updatedBy.avatarEmoji,
      },
      archivedAt: article.archivedAt,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      canEdit: isHouseholdManager(user) || article.createdById === user.memberId,
      canPin: isHouseholdManager(user),
    };
  }

  private revisionResponse(revision: KnowledgeArticleRevision) {
    return {
      id: revision.id,
      version: revision.version,
      changeType: revision.changeType,
      title: revision.title,
      category: revision.category,
      summary: revision.summary,
      content: revision.content,
      referenceUrl: revision.referenceUrl,
      tags: revision.tags,
      isPinned: revision.isPinned,
      archivedAt: revision.archivedAt,
      changedBy: {
        id: revision.changedBy.id,
        name: revision.changedByName,
        avatarEmoji: revision.changedBy.avatarEmoji,
      },
      createdAt: revision.createdAt,
    };
  }
}
