import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMaintenanceConsumables1785229900000
  implements MigrationInterface
{
  name = 'AddMaintenanceConsumables1785229900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "maintenance_consumables" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "planId" uuid NOT NULL,
        "inventoryItemId" uuid NOT NULL,
        "quantity" numeric(10,2) NOT NULL,
        "unit" character varying(16) NOT NULL,
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_maintenance_consumables" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_maintenance_consumables_plan_inventory" UNIQUE ("planId", "inventoryItemId"),
        CONSTRAINT "CHK_maintenance_consumables_quantity" CHECK ("quantity" > 0 AND "quantity" <= 99999999.99),
        CONSTRAINT "FK_maintenance_consumables_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_maintenance_consumables_plan" FOREIGN KEY ("planId") REFERENCES "maintenance_plans"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_maintenance_consumables_inventory_item" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_maintenance_consumables_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_maintenance_consumables_household_plan" ON "maintenance_consumables" ("householdId", "planId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_maintenance_consumables_inventory_item" ON "maintenance_consumables" ("inventoryItemId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "maintenance_records" ADD "consumablesSnapshot" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance_records" ADD "inventoryOperationId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_maintenance_records_inventory_operation" ON "maintenance_records" ("inventoryOperationId") WHERE "inventoryOperationId" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "shopping_items" ADD "inventoryItemId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" ADD "maintenanceConsumableId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" ADD CONSTRAINT "FK_shopping_items_inventory_item" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" ADD CONSTRAINT "FK_shopping_items_maintenance_consumable" FOREIGN KEY ("maintenanceConsumableId") REFERENCES "maintenance_consumables"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shopping_items_inventory_item" ON "shopping_items" ("inventoryItemId") WHERE "inventoryItemId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shopping_maintenance_date_link" ON "shopping_items" ("householdId", "date", "maintenanceConsumableId") WHERE "source" = 'maintenance' AND "maintenanceConsumableId" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "inventory_transactions" DROP CONSTRAINT "CHK_inventory_transactions_source_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_transactions" ADD CONSTRAINT "CHK_inventory_transactions_source_type" CHECK ("sourceType" IN ('shopping_item', 'menu', 'maintenance_record', 'inventory_item', 'manual_adjustment', 'inventory_transaction'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_transactions" DROP CONSTRAINT "CHK_inventory_transactions_source_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_transactions" ADD CONSTRAINT "CHK_inventory_transactions_source_type" CHECK ("sourceType" IN ('shopping_item', 'menu', 'inventory_item', 'manual_adjustment', 'inventory_transaction'))`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_shopping_maintenance_date_link"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_shopping_items_inventory_item"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" DROP CONSTRAINT "FK_shopping_items_maintenance_consumable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" DROP CONSTRAINT "FK_shopping_items_inventory_item"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" DROP COLUMN "maintenanceConsumableId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" DROP COLUMN "inventoryItemId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_maintenance_records_inventory_operation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance_records" DROP COLUMN "inventoryOperationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance_records" DROP COLUMN "consumablesSnapshot"`,
    );
    await queryRunner.query(`DROP TABLE "maintenance_consumables"`);
  }
}
