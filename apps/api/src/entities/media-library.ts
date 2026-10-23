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
import { Integration } from './integrations';
import { MediaType, MediaTitle } from './media';

export type ViewingSessionStatus =
  | 'active'
  | 'paused'
  | 'stopped'
  | 'completed';

export type MediaLibraryProviderKind = 'plex' | 'emby';

@Entity('media_user_mappings')
@Check(
  'CHK_media_user_mappings_provider',
  `"provider" IN ('plex', 'emby')`,
)
@Unique('UQ_media_user_mappings_external', [
  'householdId',
  'connectorKey',
  'serverId',
  'externalUserId',
])
@Unique('UQ_media_user_mappings_member', [
  'householdId',
  'connectorKey',
  'serverId',
  'memberId',
])
@Index('IDX_media_user_mappings_household_provider', [
  'householdId',
  'provider',
])
export class MediaUserMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_media_user_mappings_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaLibraryProviderKind;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @Column({ type: 'varchar', length: 180 })
  serverId: string;

  @Column({ type: 'varchar', length: 180 })
  externalUserId: string;

  @Column({ type: 'varchar', length: 180 })
  externalUserName: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_media_user_mappings_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('media_library_items')
@Check(
  'CHK_media_library_items_provider',
  `"provider" IN ('plex', 'emby')`,
)
@Check(
  'CHK_media_library_items_type',
  `"mediaType" IN ('movie', 'series')`,
)
@Unique('UQ_media_library_items_connector_item', [
  'householdId',
  'connectorKey',
  'libraryItemId',
])
@Index('IDX_media_library_items_household_title', [
  'householdId',
  'title',
])
@Index('IDX_media_library_items_media_title', ['mediaTitleId'])
export class MediaLibraryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_media_library_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => MediaTitle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_media_library_items_media_title',
  })
  mediaTitle: MediaTitle | null;

  @Column({ type: 'uuid', nullable: true })
  mediaTitleId: string | null;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaLibraryProviderKind;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @Column({ type: 'varchar', length: 180 })
  libraryItemId: string;

  @Column({ type: 'varchar', length: 16 })
  mediaType: MediaType;

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

  @Column({ type: 'jsonb', default: [] })
  externalRefs: {
    provider: 'tmdb' | 'imdb';
    mediaType: MediaType;
    externalId: string;
  }[];

  @Column({ type: 'varchar', length: 4000, nullable: true })
  playbackUrl: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('viewing_sessions')
@Check(
  'CHK_viewing_sessions_provider',
  `"provider" IN ('plex', 'emby')`,
)
@Check(
  'CHK_viewing_sessions_media_type',
  `"mediaType" IN ('movie', 'series')`,
)
@Check(
  'CHK_viewing_sessions_status',
  `"status" IN ('active', 'paused', 'stopped', 'completed')`,
)
@Unique('UQ_viewing_sessions_external', [
  'integrationId',
  'serverId',
  'externalSessionId',
])
@Index('IDX_viewing_sessions_household_last_event', [
  'householdId',
  'lastEventAt',
])
@Index('IDX_viewing_sessions_playback_key', [
  'integrationId',
  'serverId',
  'playbackKey',
  'lastEventAt',
])
export class ViewingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_viewing_sessions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Integration, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'integrationId',
    foreignKeyConstraintName: 'FK_viewing_sessions_integration',
  })
  integration: Integration | null;

  @Column({ type: 'uuid', nullable: true })
  integrationId: string | null;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaLibraryProviderKind;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @Column({ type: 'varchar', length: 180 })
  serverId: string;

  @Column({ type: 'varchar', length: 180 })
  externalSessionId: string;

  @Column({ type: 'varchar', length: 64 })
  playbackKey: string;

  @ManyToOne(() => MediaLibraryItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaLibraryItemId',
    foreignKeyConstraintName: 'FK_viewing_sessions_library_item',
  })
  mediaLibraryItem: MediaLibraryItem | null;

  @Column({ type: 'uuid', nullable: true })
  mediaLibraryItemId: string | null;

  @ManyToOne(() => MediaTitle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_viewing_sessions_media_title',
  })
  mediaTitle: MediaTitle | null;

  @Column({ type: 'uuid', nullable: true })
  mediaTitleId: string | null;

  @Column({ type: 'varchar', length: 180 })
  libraryItemId: string;

  @Column({ type: 'varchar', length: 180 })
  contentItemId: string;

  @Column({ type: 'varchar', length: 16 })
  mediaType: MediaType;

  @Column({ type: 'varchar', length: 240 })
  title: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  deviceName: string | null;

  @Column({ type: 'varchar', length: 24 })
  status: ViewingSessionStatus;

  @Column({ type: 'int', default: 0 })
  positionMs: number;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'timestamptz' })
  lastEventAt: Date;

  @OneToMany(() => ViewingParticipant, (participant) => participant.session)
  participants: ViewingParticipant[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('viewing_participants')
@Index('UQ_viewing_participants_session_member', ['sessionId', 'memberId'], {
  unique: true,
  where: `"memberId" IS NOT NULL`,
})
@Index('IDX_viewing_participants_member_seen', ['memberId', 'lastSeenAt'])
export class ViewingParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ViewingSession, (session) => session.participants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'sessionId',
    foreignKeyConstraintName: 'FK_viewing_participants_session',
  })
  session: ViewingSession;

  @Column('uuid')
  sessionId: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_viewing_participants_member',
  })
  member: Member | null;

  @Column({ type: 'uuid', nullable: true })
  memberId: string | null;

  @Column({ type: 'varchar', length: 180 })
  memberName: string;

  @Column({ type: 'varchar', length: 180 })
  externalUserId: string;

  @Column({ type: 'varchar', length: 180 })
  externalUserName: string;

  @Column({ type: 'timestamptz' })
  joinedAt: Date;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @Column({ type: 'int', default: 0 })
  finalPositionMs: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('viewing_progress')
@Check(
  'CHK_viewing_progress_provider',
  `"provider" IN ('plex', 'emby')`,
)
@Unique('UQ_viewing_progress_member_item', [
  'householdId',
  'memberId',
  'connectorKey',
  'contentItemId',
])
@Index('IDX_viewing_progress_household_watched', [
  'householdId',
  'lastWatchedAt',
])
export class ViewingProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_viewing_progress_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_viewing_progress_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaLibraryProviderKind;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @ManyToOne(() => MediaLibraryItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaLibraryItemId',
    foreignKeyConstraintName: 'FK_viewing_progress_library_item',
  })
  mediaLibraryItem: MediaLibraryItem | null;

  @Column({ type: 'uuid', nullable: true })
  mediaLibraryItemId: string | null;

  @ManyToOne(() => MediaTitle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_viewing_progress_media_title',
  })
  mediaTitle: MediaTitle | null;

  @Column({ type: 'uuid', nullable: true })
  mediaTitleId: string | null;

  @ManyToOne(() => ViewingSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'lastViewingSessionId',
    foreignKeyConstraintName: 'FK_viewing_progress_last_session',
  })
  lastViewingSession: ViewingSession | null;

  @Column({ type: 'uuid', nullable: true })
  lastViewingSessionId: string | null;

  @Column({ type: 'varchar', length: 180 })
  contentItemId: string;

  @Column({ type: 'varchar', length: 240 })
  title: string;

  @Column({ type: 'int', default: 0 })
  positionMs: number;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ type: 'double precision', default: 0 })
  percentage: number;

  @Column({ default: false })
  completed: boolean;

  @Column({ type: 'timestamptz' })
  lastWatchedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
