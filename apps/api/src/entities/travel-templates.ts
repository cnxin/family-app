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
import { TravelPlan } from './travel';

export type TravelChecklistCategory =
  | 'documents'
  | 'clothing'
  | 'toiletries'
  | 'electronics'
  | 'supplies'
  | 'other';

@Entity('travel_packing_templates')
@Check('CHK_travel_packing_templates_version', `"version" >= 1`)
@Index('IDX_travel_templates_household_active', [
  'householdId',
  'archivedAt',
  'updatedAt',
])
export class TravelPackingTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_packing_templates_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_travel_packing_templates_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_travel_packing_templates_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @OneToMany(() => TravelPackingTemplateItem, (item) => item.template)
  items: TravelPackingTemplateItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('travel_packing_template_items')
@Check(
  'CHK_travel_template_items_category',
  `"category" IN ('documents', 'clothing', 'toiletries', 'electronics', 'supplies', 'other')`,
)
@Check('CHK_travel_template_items_quantity', `"quantity" BETWEEN 1 AND 99`)
@Check('CHK_travel_template_items_sort_order', `"sortOrder" >= 0`)
@Index('IDX_travel_template_items_template_order', [
  'templateId',
  'sortOrder',
  'createdAt',
])
export class TravelPackingTemplateItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_template_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => TravelPackingTemplate, (template) => template.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'templateId',
    foreignKeyConstraintName: 'FK_travel_template_items_template',
  })
  template: TravelPackingTemplate;

  @Column('uuid')
  templateId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 24 })
  category: TravelChecklistCategory;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('travel_template_applications')
@Unique('UQ_travel_template_applications_plan_template', [
  'planId',
  'templateId',
])
@Check('CHK_travel_template_applications_version', `"templateVersion" >= 1`)
export class TravelTemplateApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_template_applications_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => TravelPlan, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'planId',
    foreignKeyConstraintName: 'FK_travel_template_applications_plan',
  })
  plan: TravelPlan;

  @Column('uuid')
  planId: string;

  @ManyToOne(() => TravelPackingTemplate, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'templateId',
    foreignKeyConstraintName: 'FK_travel_template_applications_template',
  })
  template: TravelPackingTemplate;

  @Column('uuid')
  templateId: string;

  @Column({ type: 'int' })
  templateVersion: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'appliedById',
    foreignKeyConstraintName: 'FK_travel_template_applications_applied_by',
  })
  appliedBy: Member;

  @Column('uuid')
  appliedById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
