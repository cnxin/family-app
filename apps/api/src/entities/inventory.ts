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
import { InventoryBatchMovement } from './inventory-ledger';
import { StorageLocation } from './locations';
import { Ingredient } from './recipes';

export type InventoryCategory =
  | '调料'
  | '主食'
  | '饮料'
  | '零食'
  | '日用品'
  | '药品'
  | '其他';

export type InventoryBatchSourceType = 'manual' | 'shopping_item';

@Entity('inventory_items')
@Unique('UQ_inventory_household_name', ['householdId', 'name'])
@Index('IDX_inventory_household', ['householdId'])
@Index('UQ_inventory_household_ingredient_unit', ['householdId', 'ingredientId', 'unit'], {
  unique: true,
  where: '"ingredientId" IS NOT NULL',
})
@Index('IDX_inventory_items_default_location', ['defaultLocationId'])
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_inventory_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Ingredient, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'ingredientId',
    foreignKeyConstraintName: 'FK_inventory_items_ingredient',
  })
  ingredient: Ingredient | null;

  @Column({ type: 'uuid', nullable: true })
  ingredientId: string | null;

  @Column()
  name: string;

  @Column({ type: 'varchar', default: '其他' })
  category: InventoryCategory;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  quantity: string;

  @Column({ type: 'varchar', default: '份' })
  unit: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  lowStockThreshold: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  restockQuantity: string;

  /** I1：默认位置（新批次没指定位置时用它；没分批的库存就算放在这儿） */
  @ManyToOne(() => StorageLocation, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'defaultLocationId', foreignKeyConstraintName: 'FK_inventory_items_default_location' })
  defaultLocation: StorageLocation | null;

  @Column({ type: 'uuid', nullable: true })
  defaultLocationId: string | null;

  @OneToMany(() => InventoryBatch, (batch) => batch.inventoryItem)
  batches: InventoryBatch[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('inventory_batches')
@Check(
  'CHK_inventory_batches_quantity',
  `"quantity" >= 0 AND "quantity" <= 99999999.99`,
)
@Check(
  'CHK_inventory_batches_source',
  `"sourceType" IN ('manual', 'shopping_item')`,
)
@Check('CHK_inventory_batches_version', `"version" > 0`)
@Check(
  'CHK_inventory_batches_dates',
  `"productionDate" IS NULL OR "expiresOn" IS NULL OR "expiresOn" >= "productionDate"`,
)
@Index(
  'UQ_inventory_batches_household_source',
  ['householdId', 'sourceType', 'sourceId'],
  { unique: true },
)
@Index('IDX_inventory_batches_household_expiry', ['householdId', 'expiresOn'], {
  where: '"quantity" > 0',
})
@Index('IDX_inventory_batches_item_received', [
  'inventoryItemId',
  'receivedOn',
  'createdAt',
])
@Index('IDX_inventory_batches_location', ['locationId'])
export class InventoryBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_inventory_batches_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => InventoryItem, (item) => item.batches, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'inventoryItemId',
    foreignKeyConstraintName: 'FK_inventory_batches_item',
  })
  inventoryItem: InventoryItem;

  @Column('uuid')
  inventoryItemId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantity: string;

  @Column({ type: 'date' })
  receivedOn: string;

  @Column({ type: 'date', nullable: true })
  productionDate: string | null;

  @Column({ type: 'date', nullable: true })
  expiresOn: string | null;

  @Column({ type: 'date', nullable: true })
  openedOn: string | null;

  @Column({ type: 'varchar', length: 32 })
  sourceType: InventoryBatchSourceType;

  @Column('uuid')
  sourceId: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  /** I1：这一批上次放在哪（「上次放在」，不是真相）；没指定时取物品的默认位置 */
  @ManyToOne(() => StorageLocation, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'locationId', foreignKeyConstraintName: 'FK_inventory_batches_location' })
  location: StorageLocation | null;

  @Column({ type: 'uuid', nullable: true })
  locationId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  locationUpdatedAt: Date | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_inventory_batches_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => InventoryBatchMovement, (movement) => movement.batch)
  movements: InventoryBatchMovement[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
