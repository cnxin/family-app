import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Household } from './household';

export type StorageLocationKind = 'room' | 'zone' | 'container' | 'slot';

/**
 * I1 位置字典（item-location-plan §2.1）：房间 → 柜子 / 区域 → 层格，三级到顶；同一层里没归档的不重名。
 * 有物品 / 批次 / 资产引用的只能归档不能删。systemKey = 'unsorted' 是系统节点「未整理」：家人在选择器里新建的位置挂在它下面。
 * mapShape 给 I2 地图留的，I1 不写。
 */
@Entity('storage_locations')
@Check('CHK_storage_locations_kind', `"kind" IN ('room', 'zone', 'container', 'slot')`)
@Check('CHK_storage_locations_room_parent', `("kind" = 'room') = ("parentId" IS NULL)`)
@Check('CHK_storage_locations_system', `"systemKey" IS NULL OR ("systemKey" = 'unsorted' AND "kind" = 'room')`)
@Index('IDX_storage_locations_household_parent', ['householdId', 'parentId'])
@Index('UQ_storage_locations_root_name', ['householdId', 'name'], {
  unique: true,
  where: '"parentId" IS NULL AND "archivedAt" IS NULL',
})
@Index('UQ_storage_locations_child_name', ['householdId', 'parentId', 'name'], {
  unique: true,
  where: '"parentId" IS NOT NULL AND "archivedAt" IS NULL',
})
@Index('UQ_storage_locations_system', ['householdId', 'systemKey'], {
  unique: true,
  where: '"systemKey" IS NOT NULL',
})
export class StorageLocation {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_storage_locations' })
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_storage_locations_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => StorageLocation, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parentId', foreignKeyConstraintName: 'FK_storage_locations_parent' })
  parent: StorageLocation | null;

  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'varchar', length: 16 })
  kind: StorageLocationKind;

  @Column({ type: 'varchar', length: 40 })
  name: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  icon: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'jsonb', nullable: true })
  mapShape: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  systemKey: 'unsorted' | null;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** I2 家庭地图（item-location-plan §2.2）：一家一张，形状在 storage_locations.mapShape。 */
@Entity('household_maps')
@Check('CHK_household_maps_viewbox', `"viewBoxWidth" = 1000 AND "viewBoxHeight" BETWEEN 100 AND 4000`)
@Index('UQ_household_maps_active', ['householdId'], { unique: true, where: '"isActive"' })
export class HouseholdMap {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_household_maps' })
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_household_maps_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 40, default: '家' })
  title: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int' })
  viewBoxWidth: number;

  @Column({ type: 'int' })
  viewBoxHeight: number;

  /** uploads/.private/maps/<householdId>/ 下的文件名 */
  @Column({ type: 'varchar', length: 80, nullable: true })
  backgroundFile: string | null;

  /** 装饰类家具（地图编辑器 v2 §3）：[{ id, kind, roomId, x, y, w, h, rotation }] */
  @Column({ type: 'jsonb', default: [] })
  decorations: Record<string, unknown>[];

  @Column({ type: 'int', default: 0 })
  decorationsVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
