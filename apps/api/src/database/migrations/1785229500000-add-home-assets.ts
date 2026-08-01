import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHomeAssets1785229500000 implements MigrationInterface {
  name = 'AddHomeAssets1785229500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "home_assets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "category" character varying(24) NOT NULL,
        "location" character varying(80),
        "brand" character varying(80),
        "model" character varying(120),
        "serialNumber" character varying(120),
        "purchaseDate" date,
        "purchasePrice" numeric(12,2),
        "warrantyExpiresOn" date,
        "status" character varying(16) NOT NULL DEFAULT 'active',
        "note" character varying(1000),
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_home_assets" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_home_assets_category" CHECK ("category" IN ('appliance', 'furniture', 'electronics', 'tool', 'other')),
        CONSTRAINT "CHK_home_assets_status" CHECK ("status" IN ('active', 'retired')),
        CONSTRAINT "CHK_home_assets_purchase_price" CHECK ("purchasePrice" IS NULL OR "purchasePrice" >= 0),
        CONSTRAINT "CHK_home_assets_warranty_dates" CHECK ("purchaseDate" IS NULL OR "warrantyExpiresOn" IS NULL OR "warrantyExpiresOn" >= "purchaseDate"),
        CONSTRAINT "FK_home_assets_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_home_assets_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_home_assets_household_status" ON "home_assets" ("householdId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_home_assets_household_category" ON "home_assets" ("householdId", "category")`,
    );

    await queryRunner.query(`
      CREATE TABLE "asset_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "assetId" uuid NOT NULL,
        "type" character varying(24) NOT NULL,
        "title" character varying(120) NOT NULL,
        "url" character varying(2000) NOT NULL,
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_asset_documents" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_asset_documents_type" CHECK ("type" IN ('receipt', 'manual', 'warranty', 'other')),
        CONSTRAINT "FK_asset_documents_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_asset_documents_asset" FOREIGN KEY ("assetId") REFERENCES "home_assets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_asset_documents_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_asset_documents_asset_created" ON "asset_documents" ("assetId", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "maintenance_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "assetId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "frequencyDays" integer NOT NULL,
        "nextDueDate" date NOT NULL,
        "isEnabled" boolean NOT NULL DEFAULT true,
        "note" character varying(1000),
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_maintenance_plans" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_maintenance_plans_frequency" CHECK ("frequencyDays" >= 1 AND "frequencyDays" <= 3650),
        CONSTRAINT "UQ_maintenance_plans_asset_title" UNIQUE ("assetId", "title"),
        CONSTRAINT "FK_maintenance_plans_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_maintenance_plans_asset" FOREIGN KEY ("assetId") REFERENCES "home_assets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_maintenance_plans_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_maintenance_plans_household_due" ON "maintenance_plans" ("householdId", "isEnabled", "nextDueDate")`,
    );

    await queryRunner.query(`
      CREATE TABLE "maintenance_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "assetId" uuid NOT NULL,
        "planId" uuid NOT NULL,
        "performedById" uuid NOT NULL,
        "performedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "cost" numeric(12,2),
        "note" character varying(1000),
        "idempotencyKey" character varying(160) NOT NULL,
        "nextDueDateBefore" date NOT NULL,
        "nextDueDateAfter" date NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_maintenance_records" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_maintenance_records_cost" CHECK ("cost" IS NULL OR "cost" >= 0),
        CONSTRAINT "UQ_maintenance_records_household_idempotency" UNIQUE ("householdId", "idempotencyKey"),
        CONSTRAINT "FK_maintenance_records_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_maintenance_records_asset" FOREIGN KEY ("assetId") REFERENCES "home_assets"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_maintenance_records_plan" FOREIGN KEY ("planId") REFERENCES "maintenance_plans"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_maintenance_records_performed_by" FOREIGN KEY ("performedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_maintenance_records_asset_performed" ON "maintenance_records" ("assetId", "performedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_maintenance_records_plan_performed" ON "maintenance_records" ("planId", "performedAt")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION prevent_maintenance_record_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'maintenance records are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_maintenance_records_immutable"
      BEFORE UPDATE OR DELETE ON "maintenance_records"
      FOR EACH ROW EXECUTE FUNCTION prevent_maintenance_record_mutation()
    `);

    await queryRunner.query(
      `ALTER TABLE "reminders" DROP CONSTRAINT "CHK_reminders_source_module"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reminders" ADD CONSTRAINT "CHK_reminders_source_module" CHECK ("sourceModule" IN ('menu', 'task', 'calendar', 'poll', 'maintenance'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reminders" DROP CONSTRAINT "CHK_reminders_source_module"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reminders" ADD CONSTRAINT "CHK_reminders_source_module" CHECK ("sourceModule" IN ('menu', 'task', 'calendar', 'poll'))`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_maintenance_records_immutable" ON "maintenance_records"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_records"`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS prevent_maintenance_record_mutation()`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_plans"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "asset_documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "home_assets"`);
  }
}
