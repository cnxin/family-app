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
import { InventoryItem } from './inventory';
import { StorageLocation } from './locations';

export type AssetCategory =
  | 'appliance'
  | 'furniture'
  | 'electronics'
  | 'tool'
  | 'subscription'
  | 'other';

export type AssetRenewalIntervalMonths = 1 | 3 | 6 | 12;

export type AssetStatus = 'active' | 'retired';

export type AssetDocumentType = 'receipt' | 'manual' | 'warranty' | 'other';

export interface MaintenanceConsumableSnapshot {
  consumableId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: string;
  consumed: boolean;
  quantityBefore: number | null;
  quantityAfter: number | null;
  transactionId: string | null;
}

@Entity('home_assets')
@Check(
  'CHK_home_assets_category',
  `"category" IN ('appliance', 'furniture', 'electronics', 'tool', 'subscription', 'other')`,
)
@Check('CHK_home_assets_status', `"status" IN ('active', 'retired')`)
@Check(
  'CHK_home_assets_purchase_price',
  `"purchasePrice" IS NULL OR "purchasePrice" >= 0`,
)
@Check(
  'CHK_home_assets_warranty_dates',
  `"purchaseDate" IS NULL OR "warrantyExpiresOn" IS NULL OR "warrantyExpiresOn" >= "purchaseDate"`,
)
@Check(
  'CHK_home_assets_renewal_interval',
  `"renewalIntervalMonths" IS NULL OR "renewalIntervalMonths" IN (1, 3, 6, 12)`,
)
@Check('CHK_home_assets_renewal_price', `"renewalPrice" IS NULL OR "renewalPrice" >= 0`)
@Index('IDX_home_assets_household_status', ['householdId', 'status'])
@Index('IDX_home_assets_household_category', ['householdId', 'category'])
@Index('IDX_home_assets_location', ['locationId'])
export class HomeAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_home_assets_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 24 })
  category: AssetCategory;

  @Column({ type: 'varchar', length: 80, nullable: true })
  location: string | null;

  /** I1：位置字典里的位置；有它时不再显示上面的旧文本（旧文本留着，「整理到位置」后清空） */
  @ManyToOne(() => StorageLocation, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'locationId', foreignKeyConstraintName: 'FK_home_assets_location' })
  storageLocation: StorageLocation | null;

  @Column({ type: 'uuid', nullable: true })
  locationId: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  serialNumber: string | null;

  @Column({ type: 'date', nullable: true })
  purchaseDate: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  purchasePrice: string | null;

  @Column({ type: 'date', nullable: true })
  warrantyExpiresOn: string | null;

  @Column({ type: 'date', nullable: true })
  renewsOn: string | null;

  @Column({ type: 'smallint', nullable: true })
  renewalIntervalMonths: AssetRenewalIntervalMonths | null;

  /** K 收尾：订阅每次续费多少钱；空时按购买价格算（财务「固定支出」里的资产续费月均） */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  renewalPrice: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: AssetStatus;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_home_assets_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => AssetDocument, (document) => document.asset)
  documents: AssetDocument[];

  @OneToMany(() => MaintenancePlan, (plan) => plan.asset)
  maintenancePlans: MaintenancePlan[];

  @OneToMany(() => MaintenanceRecord, (record) => record.asset)
  maintenanceRecords: MaintenanceRecord[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('asset_documents')
@Check(
  'CHK_asset_documents_type',
  `"type" IN ('receipt', 'manual', 'warranty', 'other')`,
)
@Index('IDX_asset_documents_asset_created', ['assetId', 'createdAt'])
export class AssetDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_asset_documents_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HomeAsset, (asset) => asset.documents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'assetId',
    foreignKeyConstraintName: 'FK_asset_documents_asset',
  })
  asset: HomeAsset;

  @Column('uuid')
  assetId: string;

  @Column({ type: 'varchar', length: 24 })
  type: AssetDocumentType;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 2000 })
  url: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_asset_documents_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('maintenance_plans')
@Check(
  'CHK_maintenance_plans_frequency',
  `"frequencyDays" >= 1 AND "frequencyDays" <= 3650`,
)
@Unique('UQ_maintenance_plans_asset_title', ['assetId', 'title'])
@Index('IDX_maintenance_plans_household_due', [
  'householdId',
  'isEnabled',
  'nextDueDate',
])
export class MaintenancePlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_maintenance_plans_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HomeAsset, (asset) => asset.maintenancePlans, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'assetId',
    foreignKeyConstraintName: 'FK_maintenance_plans_asset',
  })
  asset: HomeAsset;

  @Column('uuid')
  assetId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'integer' })
  frequencyDays: number;

  @Column({ type: 'date' })
  nextDueDate: string;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_maintenance_plans_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => MaintenanceRecord, (record) => record.plan)
  records: MaintenanceRecord[];

  @OneToMany(() => MaintenanceConsumable, (consumable) => consumable.plan)
  consumables: MaintenanceConsumable[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('maintenance_records')
@Check(
  'CHK_maintenance_records_cost',
  `"cost" IS NULL OR "cost" >= 0`,
)
@Unique('UQ_maintenance_records_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Index('IDX_maintenance_records_asset_performed', ['assetId', 'performedAt'])
@Index('IDX_maintenance_records_plan_performed', ['planId', 'performedAt'])
@Index('IDX_maintenance_records_inventory_operation', ['inventoryOperationId'], {
  where: '"inventoryOperationId" IS NOT NULL',
})
export class MaintenanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_maintenance_records_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HomeAsset, (asset) => asset.maintenanceRecords, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'assetId',
    foreignKeyConstraintName: 'FK_maintenance_records_asset',
  })
  asset: HomeAsset;

  @Column('uuid')
  assetId: string;

  @ManyToOne(() => MaintenancePlan, (plan) => plan.records, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'planId',
    foreignKeyConstraintName: 'FK_maintenance_records_plan',
  })
  plan: MaintenancePlan;

  @Column('uuid')
  planId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'performedById',
    foreignKeyConstraintName: 'FK_maintenance_records_performed_by',
  })
  performedBy: Member;

  @Column('uuid')
  performedById: string;

  @Column({ type: 'timestamptz' })
  performedAt: Date;

  @Column({ type: 'date' })
  performedOn: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  cost: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 160 })
  idempotencyKey: string;

  @Column({ type: 'date' })
  nextDueDateBefore: string;

  @Column({ type: 'date' })
  nextDueDateAfter: string;

  @Column({ type: 'jsonb', default: [] })
  consumablesSnapshot: MaintenanceConsumableSnapshot[];

  @Column({ type: 'uuid', nullable: true })
  inventoryOperationId: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('maintenance_consumables')
@Check(
  'CHK_maintenance_consumables_quantity',
  `"quantity" > 0 AND "quantity" <= 99999999.99`,
)
@Unique('UQ_maintenance_consumables_plan_inventory', [
  'planId',
  'inventoryItemId',
])
@Index('IDX_maintenance_consumables_household_plan', ['householdId', 'planId'])
@Index('IDX_maintenance_consumables_inventory_item', ['inventoryItemId'])
export class MaintenanceConsumable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_maintenance_consumables_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => MaintenancePlan, (plan) => plan.consumables, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'planId',
    foreignKeyConstraintName: 'FK_maintenance_consumables_plan',
  })
  plan: MaintenancePlan;

  @Column('uuid')
  planId: string;

  @ManyToOne(() => InventoryItem, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'inventoryItemId',
    foreignKeyConstraintName: 'FK_maintenance_consumables_inventory_item',
  })
  inventoryItem: InventoryItem;

  @Column('uuid')
  inventoryItemId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantity: string;

  @Column({ type: 'varchar', length: 16 })
  unit: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_maintenance_consumables_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
