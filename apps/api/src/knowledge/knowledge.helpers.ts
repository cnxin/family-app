import { ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  KnowledgeArticle,
  KnowledgeArticleRevision,
  KnowledgeRevisionChangeType,
} from '../entities';
import { isHouseholdManager } from '@family/shared';

export function normalizedTags(values?: string[]) {
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

export async function saveRevision(
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

export function articleResponse(article: KnowledgeArticle, user: JwtUser) {
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

export function revisionResponse(revision: KnowledgeArticleRevision) {
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

export function assertCanManage(article: KnowledgeArticle, user: JwtUser) {
  if (!isHouseholdManager(user) && article.createdById !== user.memberId) {
    throw new ForbiddenException('只能维护自己创建的知识文章');
  }
}
