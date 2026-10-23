import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Household, Member } from './household';
import {
  TravelChecklistCategory,
  TravelPackingTemplateItem,
  TravelTemplateApplication,
} from './travel-templates';

export type TravelPlanStatus = 'planned' | 'completed' | 'cancelled';

export type TravelChecklistStatus = 'pending' | 'completed' | 'skipped';

@Entity('travel_plans')
@Check('CHK_travel_plans_dates', `"endDate" >= "startDate"`)
@Check(
  'CHK_travel_plans_status',
  `"status" IN ('planned', 'completed', 'cancelled')`,
)
@Check('CHK_travel_plans_version', `"version" >= 1`)
@Check(
  'CHK_travel_plans_completion',
  `("status" = 'completed' AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL) OR ("status" <> 'completed' AND "completedAt" IS NULL AND "completedById" IS NULL)`,
)
@Index('IDX_travel_plans_household_dates', [
  'householdId',
  'startDate',
  'endDate',
])
@Index('IDX_travel_plans_household_status', [
  'householdId',
  'archivedAt',
  'status',
  'startDate',
])
export class TravelPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_plans_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  destination: string | null;

  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  endDate: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 16, default: 'planned' })
  status: TravelPlanStatus;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_travel_plans_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_travel_plans_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'completedById',
    foreignKeyConstraintName: 'FK_travel_plans_completed_by',
  })
  completedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  completedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @OneToMany(() => TravelChecklistItem, (item) => item.plan)
  items: TravelChecklistItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('travel_checklist_items')
@Check(
  'CHK_travel_checklist_items_category',
  `"category" IN ('documents', 'clothing', 'toiletries', 'electronics', 'supplies', 'other')`,
)
@Check('CHK_travel_checklist_items_quantity', `"quantity" BETWEEN 1 AND 99`)
@Check('CHK_travel_checklist_items_sort_order', `"sortOrder" >= 0`)
@Check(
  'CHK_travel_checklist_items_status',
  `"status" IN ('pending', 'completed', 'skipped')`,
)
@Check('CHK_travel_checklist_items_version', `"version" >= 1`)
@Check(
  'CHK_travel_checklist_items_completion',
  `("status" = 'completed' AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL) OR ("status" <> 'completed' AND "completedAt" IS NULL AND "completedById" IS NULL)`,
)
@Index('IDX_travel_checklist_items_plan_status', [
  'planId',
  'archivedAt',
  'status',
  'sortOrder',
])
@Index('IDX_travel_checklist_items_assignee', [
  'householdId',
  'assignedMemberId',
  'status',
])
export class TravelChecklistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => TravelPlan, (plan) => plan.items, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'planId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_plan',
  })
  plan: TravelPlan;

  @Column('uuid')
  planId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 24 })
  category: TravelChecklistCategory;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: TravelChecklistStatus;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'assignedMemberId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_assigned',
  })
  assignedMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  assignedMemberId: string | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'completedById',
    foreignKeyConstraintName: 'FK_travel_checklist_items_completed_by',
  })
  completedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  completedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_travel_checklist_items_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_travel_checklist_items_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @ManyToOne(() => TravelTemplateApplication, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'templateApplicationId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_application',
  })
  templateApplication: TravelTemplateApplication | null;

  @Column({ type: 'uuid', nullable: true })
  templateApplicationId: string | null;

  @ManyToOne(() => TravelPackingTemplateItem, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'sourceTemplateItemId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_source_template_item',
  })
  sourceTemplateItem: TravelPackingTemplateItem | null;

  @Column({ type: 'uuid', nullable: true })
  sourceTemplateItemId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('travel_operations')
@Unique('UQ_travel_operations_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Check(
  'CHK_travel_operations_target_type',
  `"targetType" IN ('plan', 'item', 'template', 'application')`,
)
@Check('CHK_travel_operations_metadata', `jsonb_typeof("metadata") = 'object'`)
@Index('IDX_travel_operations_plan_created', ['planId', 'createdAt'])
export class TravelOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_operations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 40 })
  operation: string;

  @Column({ type: 'varchar', length: 20 })
  targetType: 'plan' | 'item' | 'template' | 'application';

  @Column('uuid')
  targetId: string;

  @Column({ type: 'uuid', nullable: true })
  planId: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_travel_operations_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 64 })
  actorName: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}
