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

export type NotificationModule =
  | 'menu'
  | 'task'
  | 'poll'
  | 'calendar'
  | 'reminder'
  | 'media'
  | 'guest'
  | 'points'
  | 'agent'
  | 'system';

export type NotificationChannelKind = 'webhook' | 'ntfy';

export type NotificationDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'retry_scheduled'
  | 'sent'
  | 'failed';

export type NotificationDeliveryAttemptStatus = 'sent' | 'failed';

@Entity('notifications')
@Check(
  'CHK_notifications_module',
  `"module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'guest', 'points', 'agent', 'system')`,
)
@Index('IDX_notifications_recipient_read', ['recipientId', 'readAt', 'createdAt'])
@Index('IDX_notifications_household_source', ['householdId', 'module', 'sourceId'])
@Index('IDX_notifications_external_route', ['createdAt'], {
  where: '"externalRoutedAt" IS NULL',
})
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_notifications_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'recipientId',
    foreignKeyConstraintName: 'FK_notifications_recipient',
  })
  recipient: Member;

  @Column('uuid')
  recipientId: string;

  @Column({ type: 'varchar' })
  module: NotificationModule;

  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 500 })
  targetPath: string;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  externalRoutedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('notification_channels')
@Check('CHK_notification_channels_kind', `"kind" IN ('webhook', 'ntfy')`)
@Check(
  'CHK_notification_channels_test_status',
  `"lastTestStatus" IS NULL OR "lastTestStatus" IN ('success', 'failed')`,
)
@Unique('UQ_notification_channels_household_name', ['householdId', 'name'])
@Index('IDX_notification_channels_household_enabled', [
  'householdId',
  'isEnabled',
  'createdAt',
])
export class NotificationChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_notification_channels_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 24 })
  kind: NotificationChannelKind;

  @Column({ type: 'text', select: false })
  endpointEncrypted: string;

  @Column({ type: 'varchar', length: 255 })
  endpointHint: string;

  @Column({ type: 'text', nullable: true, select: false })
  credentialEncrypted: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  credentialHint: string | null;

  @Column({ default: true })
  isEnabled: boolean;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_notification_channels_created_by',
  })
  createdBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastTestedAt: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  lastTestStatus: 'success' | 'failed' | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  lastTestError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('member_notification_preferences')
@Unique('UQ_member_notification_preferences_member_channel', [
  'memberId',
  'channelId',
])
@Index('IDX_member_notification_preferences_route', [
  'householdId',
  'memberId',
  'isEnabled',
])
export class MemberNotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_member_notification_preferences_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_member_notification_preferences_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @ManyToOne(() => NotificationChannel, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'channelId',
    foreignKeyConstraintName: 'FK_member_notification_preferences_channel',
  })
  channel: NotificationChannel;

  @Column('uuid')
  channelId: string;

  @Column({ default: false })
  isEnabled: boolean;

  @Column({ type: 'jsonb', default: [] })
  modules: NotificationModule[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('notification_deliveries')
@Check(
  'CHK_notification_deliveries_status',
  `"status" IN ('pending', 'processing', 'retry_scheduled', 'sent', 'failed')`,
)
@Check(
  'CHK_notification_deliveries_attempts',
  `"attemptCount" >= 0 AND "maxAttempts" >= 1`,
)
@Check(
  'CHK_notification_deliveries_channel_kind',
  `"channelKind" IN ('webhook', 'ntfy')`,
)
@Unique('UQ_notification_deliveries_notification_channel', [
  'notificationId',
  'channelId',
])
@Index('IDX_notification_deliveries_household_history', [
  'householdId',
  'recipientId',
  'createdAt',
])
@Index('IDX_notification_deliveries_dispatch', ['nextAttemptAt', 'createdAt'], {
  where: `"status" IN ('pending', 'retry_scheduled')`,
})
export class NotificationDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_notification_deliveries_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Notification, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'notificationId',
    foreignKeyConstraintName: 'FK_notification_deliveries_notification',
  })
  notification: Notification;

  @Column('uuid')
  notificationId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'recipientId',
    foreignKeyConstraintName: 'FK_notification_deliveries_recipient',
  })
  recipient: Member;

  @Column('uuid')
  recipientId: string;

  @ManyToOne(() => NotificationChannel, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'channelId',
    foreignKeyConstraintName: 'FK_notification_deliveries_channel',
  })
  channel: NotificationChannel | null;

  @Column({ type: 'uuid', nullable: true })
  channelId: string | null;

  @Column({ type: 'varchar', length: 120 })
  channelName: string;

  @Column({ type: 'varchar', length: 24 })
  channelKind: NotificationChannelKind;

  @Column({ type: 'varchar', length: 255 })
  endpointHint: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: NotificationDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'int', default: 4 })
  maxAttempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  lastError: string | null;

  @OneToMany(
    () => NotificationDeliveryAttempt,
    (attempt) => attempt.delivery,
  )
  attempts: NotificationDeliveryAttempt[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('notification_delivery_attempts')
@Check(
  'CHK_notification_delivery_attempts_status',
  `"status" IN ('sent', 'failed')`,
)
@Check(
  'CHK_notification_delivery_attempts_number',
  `"attemptNumber" >= 1`,
)
@Unique('UQ_notification_delivery_attempts_number', [
  'deliveryId',
  'attemptNumber',
])
@Index('IDX_notification_delivery_attempts_delivery_created', [
  'deliveryId',
  'createdAt',
])
export class NotificationDeliveryAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => NotificationDelivery, (delivery) => delivery.attempts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'deliveryId',
    foreignKeyConstraintName: 'FK_notification_delivery_attempts_delivery',
  })
  delivery: NotificationDelivery;

  @Column('uuid')
  deliveryId: string;

  @Column({ type: 'int' })
  attemptNumber: number;

  @Column({ type: 'varchar', length: 16 })
  status: NotificationDeliveryAttemptStatus;

  @Column({ type: 'int', nullable: true })
  httpStatus: number | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  errorCode: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  errorMessage: string | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz' })
  finishedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
