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
import { Notification } from './notifications';

export type ReminderSourceModule =
  | 'menu'
  | 'task'
  | 'calendar'
  | 'poll'
  | 'maintenance'
  | 'travel';

export type ReminderStatus = 'scheduled' | 'sent' | 'cancelled';

@Entity('reminders')
@Check(
  'CHK_reminders_source_module',
  `"sourceModule" IN ('menu', 'task', 'calendar', 'poll', 'maintenance', 'travel')`,
)
@Check(
  'CHK_reminders_status',
  `"status" IN ('scheduled', 'sent', 'cancelled')`,
)
@Check(
  'CHK_reminders_occurrence_date',
  `("sourceModule" = 'task' AND "occurrenceDate" IS NOT NULL) OR ("sourceModule" <> 'task' AND "occurrenceDate" IS NULL)`,
)
@Index('IDX_reminders_household_status', ['householdId', 'status', 'remindAt'])
@Index('IDX_reminders_due', ['status', 'remindAt'])
export class Reminder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_reminders_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar' })
  sourceModule: ReminderSourceModule;

  @Column('uuid')
  sourceId: string;

  @Column({ type: 'date', nullable: true })
  occurrenceDate: string | null;

  @Column({ type: 'timestamptz' })
  remindAt: Date;

  @Column({ type: 'varchar', default: 'scheduled' })
  status: ReminderStatus;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_reminders_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => ReminderRecipient, (recipient) => recipient.reminder)
  recipients: ReminderRecipient[];

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  cancelReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('reminder_recipients')
@Unique('UQ_reminder_recipients_reminder_member', ['reminderId', 'memberId'])
@Index('IDX_reminder_recipients_pending', ['reminderId', 'deliveredAt'])
export class ReminderRecipient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_reminder_recipients_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Reminder, (reminder) => reminder.recipients, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'reminderId',
    foreignKeyConstraintName: 'FK_reminder_recipients_reminder',
  })
  reminder: Reminder;

  @Column('uuid')
  reminderId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_reminder_recipients_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @ManyToOne(() => Notification, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'notificationId',
    foreignKeyConstraintName: 'FK_reminder_recipients_notification',
  })
  notification: Notification | null;

  @Column({ type: 'uuid', nullable: true })
  notificationId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
