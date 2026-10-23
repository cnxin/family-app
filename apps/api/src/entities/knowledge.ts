import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Household, Member } from './household';

export type KnowledgeArticleCategory =
  | 'procedure'
  | 'appliance'
  | 'contact'
  | 'home'
  | 'other';

export type KnowledgeRevisionChangeType =
  | 'create'
  | 'update'
  | 'archive'
  | 'restore'
  | 'restore_revision';

@Entity('knowledge_articles')
@Check(
  'CHK_knowledge_articles_category',
  `"category" IN ('procedure', 'appliance', 'contact', 'home', 'other')`,
)
@Check('CHK_knowledge_articles_version', `"version" >= 1`)
@Check('CHK_knowledge_articles_tags', `jsonb_typeof("tags") = 'array'`)
@Index('IDX_knowledge_articles_household_active', [
  'householdId',
  'archivedAt',
  'isPinned',
  'updatedAt',
])
@Index('IDX_knowledge_articles_household_category', [
  'householdId',
  'category',
  'updatedAt',
])
export class KnowledgeArticle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_knowledge_articles_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 24 })
  category: KnowledgeArticleCategory;

  @Column({ type: 'varchar', length: 500, nullable: true })
  summary: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  referenceUrl: string | null;

  @Column({ type: 'jsonb', default: [] })
  tags: string[];

  @Column({ default: false })
  isPinned: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_knowledge_articles_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_knowledge_articles_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('knowledge_article_revisions')
@Unique('UQ_knowledge_revisions_article_version', ['articleId', 'version'])
@Unique('UQ_knowledge_revisions_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Check(
  'CHK_knowledge_revisions_change_type',
  `"changeType" IN ('create', 'update', 'archive', 'restore', 'restore_revision')`,
)
@Check(
  'CHK_knowledge_revisions_category',
  `"category" IN ('procedure', 'appliance', 'contact', 'home', 'other')`,
)
@Check('CHK_knowledge_revisions_version', `"version" >= 1`)
@Check('CHK_knowledge_revisions_tags', `jsonb_typeof("tags") = 'array'`)
@Index('IDX_knowledge_revisions_article_created', [
  'articleId',
  'createdAt',
])
export class KnowledgeArticleRevision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_knowledge_revisions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => KnowledgeArticle, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'articleId',
    foreignKeyConstraintName: 'FK_knowledge_revisions_article',
  })
  article: KnowledgeArticle;

  @Column('uuid')
  articleId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 24 })
  changeType: KnowledgeRevisionChangeType;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 24 })
  category: KnowledgeArticleCategory;

  @Column({ type: 'varchar', length: 500, nullable: true })
  summary: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  referenceUrl: string | null;

  @Column({ type: 'jsonb', default: [] })
  tags: string[];

  @Column({ default: false })
  isPinned: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'changedById',
    foreignKeyConstraintName: 'FK_knowledge_revisions_changed_by',
  })
  changedBy: Member;

  @Column('uuid')
  changedById: string;

  @Column({ type: 'varchar', length: 64 })
  changedByName: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
