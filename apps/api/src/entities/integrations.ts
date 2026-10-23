import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Household } from './household';
import { MediaRequest } from './media';
import { ViewingSession } from './media-library';

/** 媒体连接器的三种；integrations 表里另有 'home_assistant'（H3，见 smart-home/）。 */
export type IntegrationKind = 'plex' | 'emby' | 'moviepilot';

export type IntegrationEventStatus = 'processed' | 'ignored' | 'failed';

@Entity('integrations')
@Unique('UQ_integrations_household_kind', ['householdId', 'kind'])
@Index('IDX_integrations_household', ['householdId'])
@Index('UQ_integrations_household_primary_library', ['householdId'], {
  unique: true,
  where: `"isPrimary" = true AND "kind" IN ('plex', 'emby')`,
})
export class Integration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_integrations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 48 })
  kind: IntegrationKind | 'home_assistant';

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  baseUrl: string | null;

  @Column({ default: false })
  isPrimary: boolean;

  @Column({ type: 'jsonb', default: [] })
  capabilities: string[];

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  webhookSecretHash: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  webhookSourceIp: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  webhookUpdatedAt: Date | null;

  @OneToOne(() => IntegrationSecret, (secret) => secret.integration)
  secret: IntegrationSecret | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('integration_secrets')
@Unique('UQ_integration_secrets_integration', ['integrationId'])
export class IntegrationSecret {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Integration, (integration) => integration.secret, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'integrationId',
    foreignKeyConstraintName: 'FK_integration_secrets_integration',
  })
  integration: Integration;

  @Column('uuid')
  integrationId: string;

  @Column({ type: 'text', select: false })
  credentialEncrypted: string;

  @Column({ type: 'varchar', length: 16 })
  credentialHint: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('integration_events')
@Check(
  'CHK_integration_events_status',
  `"status" IN ('processed', 'ignored', 'failed')`,
)
@Unique('UQ_integration_events_idempotency', [
  'integrationId',
  'idempotencyKey',
])
@Index('IDX_integration_events_household_received', [
  'householdId',
  'receivedAt',
])
export class IntegrationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_integration_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'integrationId',
    foreignKeyConstraintName: 'FK_integration_events_integration',
  })
  integration: Integration;

  @Column('uuid')
  integrationId: string;

  @Column({ type: 'varchar', length: 48 })
  provider: IntegrationKind;

  @Column({ type: 'varchar', length: 80 })
  eventType: string;

  @Column({ type: 'varchar', length: 64 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 24 })
  status: IntegrationEventStatus;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error: string | null;

  @ManyToOne(() => MediaRequest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaRequestId',
    foreignKeyConstraintName: 'FK_integration_events_media_request',
  })
  mediaRequest: MediaRequest | null;

  @Column({ type: 'uuid', nullable: true })
  mediaRequestId: string | null;

  @ManyToOne(() => ViewingSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'viewingSessionId',
    foreignKeyConstraintName: 'FK_integration_events_viewing_session',
  })
  viewingSession: ViewingSession | null;

  @Column({ type: 'uuid', nullable: true })
  viewingSessionId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
