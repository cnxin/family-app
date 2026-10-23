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

export type FamilyMemoryCategory =
  | 'daily'
  | 'celebration'
  | 'travel'
  | 'meal'
  | 'visit'
  | 'milestone'
  | 'other';

export type FamilyMemorySourceModule =
  | 'calendar'
  | 'travel'
  | 'menu'
  | 'media'
  | 'visit';

export type FamilyMemoryOperationType =
  | 'create'
  | 'update'
  | 'archive'
  | 'restore';

@Entity('family_memories')
@Check(
  'CHK_family_memories_category',
  `"category" IN ('daily', 'celebration', 'travel', 'meal', 'visit', 'milestone', 'other')`,
)
@Check('CHK_family_memories_version', `"version" >= 1`)
@Check('CHK_family_memories_tags', `jsonb_typeof("tags") = 'array'`)
@Check(
  'CHK_family_memories_source',
  `("sourceModule" IS NULL AND "sourceId" IS NULL) OR ("sourceModule" IN ('calendar', 'travel', 'menu', 'media', 'visit') AND "sourceId" IS NOT NULL)`,
)
@Index('IDX_family_memories_household_date', [
  'householdId',
  'archivedAt',
  'happenedOn',
])
@Index('IDX_family_memories_household_category', [
  'householdId',
  'category',
  'happenedOn',
])
export class FamilyMemory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_family_memories_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'date' })
  happenedOn: string;

  @Column({ type: 'varchar', length: 24 })
  category: FamilyMemoryCategory;

  @Column({ type: 'text', nullable: true })
  story: string | null;

  @Column({ type: 'jsonb', default: [] })
  tags: string[];

  @Column({ type: 'varchar', length: 24, nullable: true })
  sourceModule: FamilyMemorySourceModule | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_family_memories_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_family_memories_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @OneToMany(() => FamilyMemoryPhoto, (photo) => photo.memory)
  photos: FamilyMemoryPhoto[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('family_memory_photos')
@Unique('UQ_family_memory_photos_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Check('CHK_family_memory_photos_size', `"sizeBytes" BETWEEN 1 AND 10485760`)
@Index('IDX_family_memory_photos_memory_created', ['memoryId', 'createdAt'])
export class FamilyMemoryPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_family_memory_photos_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => FamilyMemory, (memory) => memory.photos, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'memoryId',
    foreignKeyConstraintName: 'FK_family_memory_photos_memory',
  })
  memory: FamilyMemory;

  @Column('uuid')
  memoryId: string;

  @Column({ type: 'varchar', length: 240, nullable: true })
  caption: string | null;

  @Column({ type: 'varchar', length: 180 })
  storageKey: string;

  @Column({ type: 'varchar', length: 64 })
  mimeType: string;

  @Column({ type: 'int' })
  sizeBytes: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_family_memory_photos_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('family_memory_operations')
@Unique('UQ_family_memory_operations_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Check(
  'CHK_family_memory_operations_type',
  `"operation" IN ('create', 'update', 'archive', 'restore')`,
)
@Check('CHK_family_memory_operations_version', `"resultVersion" >= 1`)
@Index('IDX_family_memory_operations_memory_created', [
  'memoryId',
  'createdAt',
])
export class FamilyMemoryOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_family_memory_operations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => FamilyMemory, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memoryId',
    foreignKeyConstraintName: 'FK_family_memory_operations_memory',
  })
  memory: FamilyMemory;

  @Column('uuid')
  memoryId: string;

  @Column({ type: 'varchar', length: 24 })
  operation: FamilyMemoryOperationType;

  @Column({ type: 'int' })
  resultVersion: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_family_memory_operations_actor',
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

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}
