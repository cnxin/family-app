import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  KnowledgeArticle,
  KnowledgeArticleCategory,
  KnowledgeArticleRevision,
  KnowledgeRevisionChangeType,
} from '../entities';

const KNOWLEDGE_CATEGORIES: KnowledgeArticleCategory[] = [
  'procedure',
  'appliance',
  'contact',
  'home',
  'other',
];

class KnowledgeListQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status?: 'active' | 'archived' | 'all';

  @IsOptional()
  @IsIn(KNOWLEDGE_CATEGORIES)
  category?: KnowledgeArticleCategory;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  tag?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

class CreateKnowledgeArticleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsIn(KNOWLEDGE_CATEGORIES)
  category: KnowledgeArticleCategory;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  content: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  referenceUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class UpdateKnowledgeArticleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsIn(KNOWLEDGE_CATEGORIES)
  category?: KnowledgeArticleCategory;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  content?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  referenceUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class KnowledgeVersionOperationDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

function normalizedText(value?: string | null) {
  return value?.trim() || null;
}

function normalizedRequiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException(`${label}不能为空`);
  return normalized;
}

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

function isAdmin(user: JwtUser) {
  return user.role === 'owner' || user.role === 'admin';
}

function fingerprint(value: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
    if (dto.isPinned && !isAdmin(user)) {
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
        if (dto.isPinned !== undefined && !isAdmin(user)) {
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
    if (!isAdmin(user) && article.createdById !== user.memberId) {
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
      canEdit: isAdmin(user) || article.createdById === user.memberId,
      canPin: isAdmin(user),
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

@Controller()
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  @Get('knowledge-articles')
  list(@Query() query: KnowledgeListQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Get('knowledge-articles/:id/revisions')
  revisions(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.listRevisions(id, user);
  }

  @Get('knowledge-articles/:id')
  detail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.detail(id, user);
  }

  @Post('knowledge-articles')
  create(@Body() dto: CreateKnowledgeArticleDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('knowledge-articles/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeArticleDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post('knowledge-articles/:id/archive')
  archive(
    @Param('id') id: string,
    @Body() dto: KnowledgeVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.archive(id, dto, user);
  }

  @Post('knowledge-articles/:id/restore')
  restore(
    @Param('id') id: string,
    @Body() dto: KnowledgeVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restore(id, dto, user);
  }

  @Post('knowledge-articles/:id/revisions/:version/restore')
  restoreRevision(
    @Param('id') id: string,
    @Param('version') version: string,
    @Body() dto: KnowledgeVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restoreRevision(id, version, dto, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeArticle, KnowledgeArticleRevision]),
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
