import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryTransactions1785229400000 implements MigrationInterface {
  name = 'AddInventoryTransactions1785229400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inventory_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "inventoryItemId" uuid NOT NULL,
        "operationId" uuid NOT NULL,
        "type" character varying(24) NOT NULL,
        "quantityBefore" numeric(10,2) NOT NULL,
        "delta" numeric(10,2) NOT NULL,
        "quantityAfter" numeric(10,2) NOT NULL,
        "unit" character varying(16) NOT NULL,
        "actorId" uuid NOT NULL,
        "actorName" character varying(80) NOT NULL,
        "sourceType" character varying(32) NOT NULL,
        "sourceId" uuid NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "reversesTransactionId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_inventory_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_inventory_transactions_type" CHECK ("type" IN ('receipt', 'consumption', 'adjustment', 'reversal')),
        CONSTRAINT "CHK_inventory_transactions_source_type" CHECK ("sourceType" IN ('shopping_item', 'menu', 'inventory_item', 'manual_adjustment', 'inventory_transaction')),
        CONSTRAINT "CHK_inventory_transactions_quantities" CHECK (
          "quantityBefore" >= 0 AND
          "quantityAfter" >= 0 AND
          "delta" <> 0 AND
          "quantityAfter" = "quantityBefore" + "delta"
        ),
        CONSTRAINT "CHK_inventory_transactions_reversal" CHECK (
          ("type" = 'reversal' AND "reversesTransactionId" IS NOT NULL) OR
          ("type" <> 'reversal' AND "reversesTransactionId" IS NULL)
        ),
        CONSTRAINT "FK_inventory_transactions_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_transactions_item" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_transactions_actor" FOREIGN KEY ("actorId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_transactions_reverses" FOREIGN KEY ("reversesTransactionId") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_transactions_household_idempotency" ON "inventory_transactions" ("householdId", "idempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_transactions_reversal" ON "inventory_transactions" ("reversesTransactionId") WHERE "reversesTransactionId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_transactions_household_created" ON "inventory_transactions" ("householdId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_transactions_item_created" ON "inventory_transactions" ("inventoryItemId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_transactions_operation" ON "inventory_transactions" ("householdId", "operationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_transactions_source" ON "inventory_transactions" ("householdId", "sourceType", "sourceId")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION prevent_inventory_transaction_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'inventory transactions are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_inventory_transactions_immutable"
      BEFORE UPDATE OR DELETE ON "inventory_transactions"
      FOR EACH ROW EXECUTE FUNCTION prevent_inventory_transaction_mutation()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_inventory_transactions_immutable" ON "inventory_transactions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_transactions"`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS prevent_inventory_transaction_mutation()`,
    );
  }
}
