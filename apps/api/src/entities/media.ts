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

export type MediaType = 'movie' | 'series';

export type MediaMetadataSource = 'tmdb' | 'douban' | 'bangumi';

export type MediaCredentialKind = 'token' | 'api_key';

export type MediaExternalProvider =
  | 'tmdb'
  | 'imdb'
  | 'douban'
  | 'bangumi'
  | 'plex'
  | 'emby'
  | 'moviepilot';

export type HouseholdMediaStatus =
  | 'watchlist'
  | 'voting'
  | 'scheduled'
  | 'watching'
  | 'completed'
  | 'dropped';

export type MediaRequestStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

@Entity('media_titles')
@Check('CHK_media_titles_type', `"type" IN ('movie', 'series')`)
@Check(
  'CHK_media_titles_year',
  `"year" IS NULL OR ("year" >= 1878 AND "year" <= 2199)`,
)
@Unique('UQ_media_titles_dedupe_key', ['dedupeKey'])
export class MediaTitle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  type: MediaType;

  @Column({ type: 'varchar', length: 180 })
  title: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  originalTitle: string | null;

  @Column({ type: 'int', nullable: true })
  year: number | null;

  @Column({ type: 'varchar', length: 5000, nullable: true })
  overview: string | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  posterUrl: string | null;

  @Column({ type: 'varchar', length: 500 })
  dedupeKey: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @OneToMany(() => MediaExternalRef, (externalRef) => externalRef.mediaTitle)
  externalRefs: MediaExternalRef[];

  @OneToMany(() => HouseholdMedia, (householdMedia) => householdMedia.mediaTitle)
  householdEntries: HouseholdMedia[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('media_external_refs')
@Check(
  'CHK_media_external_refs_provider',
  `"provider" IN ('tmdb', 'imdb', 'douban', 'bangumi', 'plex', 'emby', 'moviepilot')`,
)
@Check('CHK_media_external_refs_type', `"mediaType" IN ('movie', 'series')`)
@Check(
  'CHK_media_external_refs_scope',
  `("provider" IN ('tmdb', 'imdb', 'douban', 'bangumi') AND "connectorKey" IS NULL) OR ("provider" IN ('plex', 'emby', 'moviepilot') AND "connectorKey" IS NOT NULL)`,
)
@Index(
  'UQ_media_external_refs_tmdb_type_id',
  ['provider', 'mediaType', 'externalId'],
  { unique: true, where: `"provider" = 'tmdb'` },
)
@Index(
  'UQ_media_external_refs_imdb_id',
  ['provider', 'externalId'],
  { unique: true, where: `"provider" = 'imdb'` },
)
@Index(
  'UQ_media_external_refs_douban_id',
  ['provider', 'externalId'],
  { unique: true, where: `"provider" = 'douban'` },
)
@Index(
  'UQ_media_external_refs_bangumi_id',
  ['provider', 'externalId'],
  { unique: true, where: `"provider" = 'bangumi'` },
)
@Index(
  'UQ_media_external_refs_connector_id',
  ['provider', 'connectorKey', 'externalId'],
  {
    unique: true,
    where: `"provider" IN ('plex', 'emby', 'moviepilot')`,
  },
)
@Index('IDX_media_external_refs_title', ['mediaTitleId'])
export class MediaExternalRef {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MediaTitle, (title) => title.externalRefs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_media_external_refs_title',
  })
  mediaTitle: MediaTitle;

  @Column('uuid')
  mediaTitleId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaExternalProvider;

  @Column({ type: 'varchar', length: 16 })
  mediaType: MediaType;

  @Column({ type: 'varchar', length: 180 })
  externalId: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  connectorKey: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('household_media_source_configs')
@Check(
  'CHK_household_media_source_configs_provider',
  `"provider" IN ('tmdb', 'douban', 'bangumi')`,
)
@Check(
  'CHK_household_media_source_configs_credential_kind',
  `"credentialKind" IS NULL OR "credentialKind" IN ('token', 'api_key')`,
)
@Unique('UQ_household_media_source_configs_scope', [
  'householdId',
  'provider',
])
@Index('IDX_household_media_source_configs_household', ['householdId'])
export class HouseholdMediaSourceConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_media_source_configs_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 24 })
  provider: MediaMetadataSource;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  baseUrl: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  credentialKind: MediaCredentialKind | null;

  @Column({ type: 'text', nullable: true, select: false })
  credentialEncrypted: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  credentialHint: string | null;

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('household_media')
@Check(
  'CHK_household_media_status',
  `"status" IN ('watchlist', 'voting', 'scheduled', 'watching', 'completed', 'dropped')`,
)
@Check(
  'CHK_household_media_schedule',
  `"status" <> 'scheduled' OR "scheduledFor" IS NOT NULL`,
)
@Unique('UQ_household_media_household_title', ['householdId', 'mediaTitleId'])
@Index('IDX_household_media_household_status', [
  'householdId',
  'status',
  'updatedAt',
])
@Index('IDX_household_media_household_schedule', [
  'householdId',
  'scheduledFor',
])
export class HouseholdMedia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_media_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => MediaTitle, (title) => title.householdEntries, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_household_media_title',
  })
  mediaTitle: MediaTitle;

  @Column('uuid')
  mediaTitleId: string;

  @Column({ type: 'varchar', length: 24, default: 'watchlist' })
  status: HouseholdMediaStatus;

  @Column({ type: 'date', nullable: true })
  scheduledFor: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_household_media_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => MediaRequest, (request) => request.householdMedia)
  requests: MediaRequest[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('media_requests')
@Check(
  'CHK_media_requests_status',
  `"status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled')`,
)
@Check(
  'CHK_media_requests_season',
  `"season" >= 0 AND "season" <= 999`,
)
@Index('IDX_media_requests_household_status', [
  'householdId',
  'status',
  'updatedAt',
])
@Index(
  'UQ_media_requests_active_scope',
  ['householdId', 'householdMediaId', 'connectorKey', 'season'],
  {
    unique: true,
    where: `"status" IN ('pending', 'processing')`,
  },
)
@Index(
  'UQ_media_requests_connector_external',
  ['connectorKey', 'externalRequestId'],
  { unique: true, where: `"externalRequestId" IS NOT NULL` },
)
export class MediaRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_media_requests_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HouseholdMedia, (entry) => entry.requests, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'householdMediaId',
    foreignKeyConstraintName: 'FK_media_requests_household_media',
  })
  householdMedia: HouseholdMedia;

  @Column('uuid')
  householdMediaId: string;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @Column({ type: 'int', default: 0 })
  season: number;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: MediaRequestStatus;

  @Column({ type: 'varchar', length: 180, nullable: true })
  externalRequestId: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  message: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'requestedById',
    foreignKeyConstraintName: 'FK_media_requests_requested_by',
  })
  requestedBy: Member;

  @Column('uuid')
  requestedById: string;

  @ManyToOne(() => Member, {
    eager: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'cancelledById',
    foreignKeyConstraintName: 'FK_media_requests_cancelled_by',
  })
  cancelledBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
