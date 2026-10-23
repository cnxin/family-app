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
} from 'typeorm';
import { Household, Member } from './household';
import { InventoryItem, InventoryBatch } from './inventory';

export type InventoryTransactionType =
  | 'receipt'
  | 'consumption'
  | 'adjustment'
  | 'reversal';

export type InventoryTransactionSourceType =
  | 'shopping_item'
  | 'menu'
  | 'maintenance_record'
  | 'inventory_item'
  | 'manual_adjustment'
  | 'inventory_transaction';

export type InventoryBatchMovementType =
  | 'allocation'
  | 'receipt'
  | 'consumption'
  | 'adjustment'
  | 'reversal';

export type InventoryBatchMovementSourceType =
  | 'batch_registration'
  | 'shopping_item'
  | 'menu'
  | 'maintenance_record'
  | 'manual_adjustment'
  | 'inventory_transaction';

@Entity('inventory_transactions')
@Check(
  'CHK_inventory_transactions_type',
  `"type" IN ('receipt', 'consumption', 'adjustment', 'reversal')`,
)
@Check(
  'CHK_inventory_transactions_source_type',
  `"sourceType" IN ('shopping_item', 'menu', 'maintenance_record', 'inventory_item', 'manual_adjustment', 'inventory_transaction')`,
)
@Check(
  'CHK_inventory_transactions_quantities',
  `"quantityBefore" >= 0 AND "quantityAfter" >= 0 AND "delta" <> 0 AND "quantityAfter" = "quantityBefore" + "delta"`,
)
@Check(
  'CHK_inventory_transactions_reversal',
  `("type" = 'reversal' AND "reversesTransactionId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversesTransactionId" IS NULL)`,
)
@Index(
  'UQ_inventory_transactions_household_idempotency',
  ['householdId', 'idempotencyKey'],
  { unique: true },
)
@Index('IDX_inventory_transactions_household_created', [
  'householdId',
  'createdAt',
])
@Index('IDX_inventory_transactions_item_created', [
  'inventoryItemId',
  'createdAt',
])
@Index('IDX_inventory_transactions_operation', ['householdId', 'operationId'])
@Index('IDX_inventory_transactions_source', [
  'householdId',
  'sourceType',
  'sourceId',
])
@Index(
  'UQ_inventory_transactions_reversal',
  ['reversesTransactionId'],
  { unique: true, where: '"reversesTransactionId" IS NOT NULL' },
)
export class InventoryTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_inventory_transactions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => InventoryItem, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'inventoryItemId',
    foreignKeyConstraintName: 'FK_inventory_transactions_item',
  })
  inventoryItem: InventoryItem;

  @Column('uuid')
  inventoryItemId: string;

  @Column('uuid')
  operationId: string;

  @Column({ type: 'varchar', length: 24 })
  type: InventoryTransactionType;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantityBefore: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  delta: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantityAfter: string;

  @Column({ type: 'varchar', length: 16 })
  unit: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_inventory_transactions_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 80 })
  actorName: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType: InventoryTransactionSourceType;

  @Column('uuid')
  sourceId: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @ManyToOne(() => InventoryTransaction, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'reversesTransactionId',
    foreignKeyConstraintName: 'FK_inventory_transactions_reverses',
  })
  reversesTransaction: InventoryTransaction | null;

  @Column({ type: 'uuid', nullable: true })
  reversesTransactionId: string | null;

  @OneToMany(
    () => InventoryBatchMovement,
    (movement) => movement.inventoryTransaction,
  )
  batchMovements: InventoryBatchMovement[];

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('inventory_batch_movements')
@Check(
  'CHK_inventory_batch_movements_type',
  `"type" IN ('allocation', 'receipt', 'consumption', 'adjustment', 'reversal')`,
)
@Check(
  'CHK_inventory_batch_movements_source',
  `"sourceType" IN ('batch_registration', 'shopping_item', 'menu', 'maintenance_record', 'manual_adjustment', 'inventory_transaction')`,
)
@Check(
  'CHK_inventory_batch_movements_quantities',
  `"quantityBefore" >= 0 AND "quantityAfter" >= 0 AND "delta" <> 0 AND "quantityAfter" = "quantityBefore" + "delta"`,
)
@Check(
  'CHK_inventory_batch_movements_reversal',
  `("type" = 'reversal' AND "reversesMovementId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversesMovementId" IS NULL)`,
)
@Index(
  'UQ_inventory_batch_movements_household_idempotency',
  ['householdId', 'idempotencyKey'],
  { unique: true },
)
@Index('IDX_inventory_batch_movements_batch_created', [
  'batchId',
  'createdAt',
])
@Index(
  'IDX_inventory_batch_movements_transaction',
  ['inventoryTransactionId'],
  { where: '"inventoryTransactionId" IS NOT NULL' },
)
@Index('UQ_inventory_batch_movements_reversal', ['reversesMovementId'], {
  unique: true,
  where: '"reversesMovementId" IS NOT NULL',
})
export class InventoryBatchMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => InventoryBatch, (batch) => batch.movements, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'batchId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_batch',
  })
  batch: InventoryBatch;

  @Column('uuid')
  batchId: string;

  @ManyToOne(
    () => InventoryTransaction,
    (transaction) => transaction.batchMovements,
    { nullable: true, onDelete: 'RESTRICT' },
  )
  @JoinColumn({
    name: 'inventoryTransactionId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_transaction',
  })
  inventoryTransaction: InventoryTransaction | null;

  @Column({ type: 'uuid', nullable: true })
  inventoryTransactionId: string | null;

  @Column('uuid')
  operationId: string;

  @Column({ type: 'varchar', length: 24 })
  type: InventoryBatchMovementType;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantityBefore: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  delta: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantityAfter: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 80 })
  actorName: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType: InventoryBatchMovementSourceType;

  @Column('uuid')
  sourceId: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @ManyToOne(() => InventoryBatchMovement, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'reversesMovementId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_reverses',
  })
  reversesMovement: InventoryBatchMovement | null;

  @Column({ type: 'uuid', nullable: true })
  reversesMovementId: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}
