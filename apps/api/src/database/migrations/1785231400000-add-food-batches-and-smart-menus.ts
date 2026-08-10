import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFoodBatchesAndSmartMenus1785231400000
  implements MigrationInterface
{
  name = 'AddFoodBatchesAndSmartMenus1785231400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inventory_batches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "inventoryItemId" uuid NOT NULL,
        "quantity" numeric(10,2) NOT NULL,
        "receivedOn" date NOT NULL,
        "productionDate" date,
        "expiresOn" date,
        "openedOn" date,
        "sourceType" character varying(32) NOT NULL,
        "sourceId" uuid NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_batches" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_inventory_batches_quantity" CHECK ("quantity" >= 0 AND "quantity" <= 99999999.99),
        CONSTRAINT "CHK_inventory_batches_source" CHECK ("sourceType" IN ('manual', 'shopping_item')),
        CONSTRAINT "CHK_inventory_batches_version" CHECK ("version" > 0),
        CONSTRAINT "CHK_inventory_batches_dates" CHECK ("productionDate" IS NULL OR "expiresOn" IS NULL OR "expiresOn" >= "productionDate"),
        CONSTRAINT "FK_inventory_batches_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_batches_item" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_batches_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_batches_household_source" ON "inventory_batches" ("householdId", "sourceType", "sourceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_batches_household_expiry" ON "inventory_batches" ("householdId", "expiresOn") WHERE "quantity" > 0`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_batches_item_received" ON "inventory_batches" ("inventoryItemId", "receivedOn", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "inventory_batch_movements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "batchId" uuid NOT NULL,
        "inventoryTransactionId" uuid,
        "operationId" uuid NOT NULL,
        "type" character varying(24) NOT NULL,
        "quantityBefore" numeric(10,2) NOT NULL,
        "delta" numeric(10,2) NOT NULL,
        "quantityAfter" numeric(10,2) NOT NULL,
        "actorId" uuid NOT NULL,
        "actorName" character varying(80) NOT NULL,
        "sourceType" character varying(32) NOT NULL,
        "sourceId" uuid NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "reversesMovementId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_inventory_batch_movements" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_inventory_batch_movements_type" CHECK ("type" IN ('allocation', 'receipt', 'consumption', 'adjustment', 'reversal')),
        CONSTRAINT "CHK_inventory_batch_movements_source" CHECK ("sourceType" IN ('batch_registration', 'shopping_item', 'menu', 'maintenance_record', 'manual_adjustment', 'inventory_transaction')),
        CONSTRAINT "CHK_inventory_batch_movements_quantities" CHECK (
          "quantityBefore" >= 0 AND
          "quantityAfter" >= 0 AND
          "delta" <> 0 AND
          "quantityAfter" = "quantityBefore" + "delta"
        ),
        CONSTRAINT "CHK_inventory_batch_movements_reversal" CHECK (
          ("type" = 'reversal' AND "reversesMovementId" IS NOT NULL) OR
          ("type" <> 'reversal' AND "reversesMovementId" IS NULL)
        ),
        CONSTRAINT "FK_inventory_batch_movements_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_batch_movements_batch" FOREIGN KEY ("batchId") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_batch_movements_transaction" FOREIGN KEY ("inventoryTransactionId") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_batch_movements_actor" FOREIGN KEY ("actorId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_batch_movements_reverses" FOREIGN KEY ("reversesMovementId") REFERENCES "inventory_batch_movements"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_batch_movements_household_idempotency" ON "inventory_batch_movements" ("householdId", "idempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_batch_movements_reversal" ON "inventory_batch_movements" ("reversesMovementId") WHERE "reversesMovementId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_batch_movements_batch_created" ON "inventory_batch_movements" ("batchId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_batch_movements_transaction" ON "inventory_batch_movements" ("inventoryTransactionId") WHERE "inventoryTransactionId" IS NOT NULL`,
    );
    await queryRunner.query(`
      CREATE FUNCTION prevent_inventory_batch_movement_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'inventory batch movements are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_inventory_batch_movements_immutable"
      BEFORE UPDATE OR DELETE ON "inventory_batch_movements"
      FOR EACH ROW EXECUTE FUNCTION prevent_inventory_batch_movement_mutation()
    `);

    await queryRunner.query(`
      CREATE TABLE "smart_menu_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "startsOn" date NOT NULL,
        "endsOn" date NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'draft',
        "pollId" uuid,
        "createdById" uuid NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "adoptedById" uuid,
        "adoptedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_menu_plans" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_smart_menu_plans_status" CHECK ("status" IN ('draft', 'voting', 'adopted')),
        CONSTRAINT "CHK_smart_menu_plans_dates" CHECK ("endsOn" >= "startsOn"),
        CONSTRAINT "CHK_smart_menu_plans_adopted" CHECK (("status" = 'adopted' AND "adoptedById" IS NOT NULL AND "adoptedAt" IS NOT NULL) OR ("status" <> 'adopted' AND "adoptedById" IS NULL AND "adoptedAt" IS NULL)),
        CONSTRAINT "FK_smart_menu_plans_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_smart_menu_plans_poll" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_smart_menu_plans_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_smart_menu_plans_adopted_by" FOREIGN KEY ("adoptedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_smart_menu_plans_household_idempotency" ON "smart_menu_plans" ("householdId", "idempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_smart_menu_plans_poll" ON "smart_menu_plans" ("pollId") WHERE "pollId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_smart_menu_plans_household_created" ON "smart_menu_plans" ("householdId", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "smart_menu_candidates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "planId" uuid NOT NULL,
        "dishId" uuid NOT NULL,
        "recipeVariantId" uuid NOT NULL,
        "targetDate" date NOT NULL,
        "mealType" character varying(16) NOT NULL DEFAULT 'dinner',
        "score" integer NOT NULL,
        "reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "expiringIngredients" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "pollOptionId" uuid,
        "adoptedMenuId" uuid,
        "sortOrder" integer NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_menu_candidates" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_smart_menu_candidates_meal" CHECK ("mealType" IN ('breakfast', 'lunch', 'dinner')),
        CONSTRAINT "CHK_smart_menu_candidates_order" CHECK ("sortOrder" >= 0 AND "sortOrder" < 12),
        CONSTRAINT "FK_smart_menu_candidates_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_smart_menu_candidates_plan" FOREIGN KEY ("planId") REFERENCES "smart_menu_plans"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_smart_menu_candidates_dish" FOREIGN KEY ("dishId") REFERENCES "dishes"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_smart_menu_candidates_variant" FOREIGN KEY ("recipeVariantId") REFERENCES "dish_recipe_variants"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_smart_menu_candidates_poll_option" FOREIGN KEY ("pollOptionId") REFERENCES "poll_options"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_smart_menu_candidates_adopted_menu" FOREIGN KEY ("adoptedMenuId") REFERENCES "menus"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_smart_menu_candidates_plan_order" ON "smart_menu_candidates" ("planId", "sortOrder")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_smart_menu_candidates_plan_dish" ON "smart_menu_candidates" ("planId", "dishId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_smart_menu_candidates_poll_option" ON "smart_menu_candidates" ("pollOptionId") WHERE "pollOptionId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_smart_menu_candidates_household_plan" ON "smart_menu_candidates" ("householdId", "planId", "sortOrder")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "smart_menu_candidates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "smart_menu_plans"`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_inventory_batch_movements_immutable" ON "inventory_batch_movements"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_batch_movements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_batches"`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS prevent_inventory_batch_movement_mutation()`,
    );
  }
}
