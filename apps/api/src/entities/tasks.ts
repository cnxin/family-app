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
import { PointsLedger } from './points';

export type TaskRecurrence = 'once' | 'daily' | 'weekly' | 'monthly';

export type TaskInstanceStatus = 'pending' | 'done' | 'skipped';

@Entity('household_tasks')
@Check(
  'CHK_household_tasks_recurrence',
  `"recurrence" IN ('once', 'daily', 'weekly', 'monthly')`,
)
@Check(
  'CHK_household_tasks_interval',
  `"repeatInterval" >= 1 AND "repeatInterval" <= 365`,
)
@Check(
  'CHK_household_tasks_date_range',
  `"endsOn" IS NULL OR "endsOn" >= "startsOn"`,
)
@Check(
  'CHK_household_tasks_reward_points',
  `"rewardPoints" >= 0 AND "rewardPoints" <= 10000`,
)
@Index('IDX_household_tasks_household_active', [
  'householdId',
  'isArchived',
  'startsOn',
])
export class HouseholdTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_tasks_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'date' })
  startsOn: string;

  @Column({ type: 'varchar', default: 'once' })
  recurrence: TaskRecurrence;

  @Column({ type: 'int', default: 1 })
  repeatInterval: number;

  @Column({ type: 'date', nullable: true })
  endsOn: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_household_tasks_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'defaultAssigneeId',
    foreignKeyConstraintName: 'FK_household_tasks_default_assignee',
  })
  defaultAssignee: Member | null;

  @Column({ type: 'uuid', nullable: true })
  defaultAssigneeId: string | null;

  @Column({ type: 'int', default: 0 })
  rewardPoints: number;

  @Column({ default: false })
  isArchived: boolean;

  @OneToMany(() => HouseholdTaskInstance, (instance) => instance.task)
  instances: HouseholdTaskInstance[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('household_task_instances')
@Check(
  'CHK_household_task_instances_status',
  `"status" IN ('pending', 'done', 'skipped')`,
)
@Check(
  'CHK_household_task_instances_points_version',
  `"pointsAwardVersion" >= 0`,
)
@Unique('UQ_household_task_instances_task_date', ['taskId', 'dueDate'])
@Index('IDX_household_task_instances_household_date', [
  'householdId',
  'dueDate',
  'status',
])
export class HouseholdTaskInstance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_task_instances_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HouseholdTask, (task) => task.instances, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'taskId',
    foreignKeyConstraintName: 'FK_household_task_instances_task',
  })
  task: HouseholdTask;

  @Column('uuid')
  taskId: string;

  @Column({ type: 'date' })
  dueDate: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'assigneeId',
    foreignKeyConstraintName: 'FK_household_task_instances_assignee',
  })
  assignee: Member | null;

  @Column({ type: 'uuid', nullable: true })
  assigneeId: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: TaskInstanceStatus;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'resolvedById',
    foreignKeyConstraintName: 'FK_household_task_instances_resolved_by',
  })
  resolvedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @ManyToOne(() => PointsLedger, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'pointsLedgerId',
    foreignKeyConstraintName: 'FK_household_task_instances_points_ledger',
  })
  pointsLedger: object | null;

  @Column({ type: 'uuid', nullable: true })
  pointsLedgerId: string | null;

  @Column({ type: 'int', default: 0 })
  pointsAwardVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
