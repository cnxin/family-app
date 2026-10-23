import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MaintenanceConsumable } from './assets';
import { Household } from './household';
import { InventoryItem } from './inventory';
import { Ingredient } from './recipes';

@Entity('shopping_items')
@Index('IDX_shopping_household_date', ['householdId', 'date'])
@Index('IDX_shopping_items_inventory_item', ['inventoryItemId'], {
  where: '"inventoryItemId" IS NOT NULL',
})
@Index(
  'UQ_shopping_maintenance_date_link',
  ['householdId', 'date', 'maintenanceConsumableId'],
  {
    unique: true,
    where: '"source" = \'maintenance\' AND "maintenanceConsumableId" IS NOT NULL',
  },
)
export class ShoppingItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_shopping_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Ingredient, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'ingredientId',
    foreignKeyConstraintName: 'FK_5aaa346328d071175cc0903b902',
  })
  ingredient: Ingredient | null;

  @Column({ type: 'uuid', nullable: true })
  ingredientId: string | null;

  @Column({ type: 'varchar', nullable: true })
  customName: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  totalQty: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  requiredQty: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  availableQty: string | null;

  @Column({ type: 'varchar', nullable: true })
  unit: string | null;

  @Column({ default: false })
  checked: boolean;

  @Column({ type: 'varchar', default: 'auto' })
  source: 'auto' | 'manual' | 'maintenance';

  @ManyToOne(() => InventoryItem, {
    eager: true,
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'inventoryItemId',
    foreignKeyConstraintName: 'FK_shopping_items_inventory_item',
  })
  inventoryItem: InventoryItem | null;

  @Column({ type: 'uuid', nullable: true })
  inventoryItemId: string | null;

  @ManyToOne(() => MaintenanceConsumable, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'maintenanceConsumableId',
    foreignKeyConstraintName: 'FK_shopping_items_maintenance_consumable',
  })
  maintenanceConsumable: MaintenanceConsumable | null;

  @Column({ type: 'uuid', nullable: true })
  maintenanceConsumableId: string | null;
}
