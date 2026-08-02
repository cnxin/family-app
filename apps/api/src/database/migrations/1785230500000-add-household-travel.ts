import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHouseholdTravel1785230500000 implements MigrationInterface {
  name = 'AddHouseholdTravel1785230500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "travel_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "destination" character varying(120),
        "startDate" date NOT NULL,
        "endDate" date NOT NULL,
        "note" character varying(1000),
        "status" character varying(16) NOT NULL DEFAULT 'planned',
        "version" integer NOT NULL DEFAULT 1,
        "createdById" uuid NOT NULL,
        "updatedById" uuid NOT NULL,
        "completedById" uuid,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "archivedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_travel_plans" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_travel_plans_dates" CHECK ("endDate" >= "startDate"),
        CONSTRAINT "CHK_travel_plans_status" CHECK ("status" IN ('planned', 'completed', 'cancelled')),
        CONSTRAINT "CHK_travel_plans_version" CHECK ("version" >= 1),
        CONSTRAINT "CHK_travel_plans_completion" CHECK (("status" = 'completed' AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL) OR ("status" <> 'completed' AND "completedAt" IS NULL AND "completedById" IS NULL)),
        CONSTRAINT "FK_travel_plans_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_travel_plans_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_travel_plans_updated_by" FOREIGN KEY ("updatedById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_travel_plans_completed_by" FOREIGN KEY ("completedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_travel_plans_household_dates" ON "travel_plans" ("householdId", "startDate", "endDate")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_travel_plans_household_status" ON "travel_plans" ("householdId", "archivedAt", "status", "startDate")`,
    );

    await queryRunner.query(`
      CREATE TABLE "travel_packing_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "description" character varying(500),
        "version" integer NOT NULL DEFAULT 1,
        "createdById" uuid NOT NULL,
        "updatedById" uuid NOT NULL,
        "archivedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_travel_packing_templates" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_travel_packing_templates_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_travel_packing_templates_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_travel_packing_templates_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_travel_packing_templates_updated_by" FOREIGN KEY ("updatedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_travel_templates_household_active" ON "travel_packing_templates" ("householdId", "archivedAt", "updatedAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "travel_packing_template_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "templateId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "category" character varying(24) NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_travel_packing_template_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_travel_template_items_category" CHECK ("category" IN ('documents', 'clothing', 'toiletries', 'electronics', 'supplies', 'other')),
        CONSTRAINT "CHK_travel_template_items_quantity" CHECK ("quantity" BETWEEN 1 AND 99),
        CONSTRAINT "CHK_travel_template_items_sort_order" CHECK ("sortOrder" >= 0),
        CONSTRAINT "FK_travel_template_items_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_travel_template_items_template" FOREIGN KEY ("templateId") REFERENCES "travel_packing_templates"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_travel_template_items_template_order" ON "travel_packing_template_items" ("templateId", "sortOrder", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "travel_template_applications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "planId" uuid NOT NULL,
        "templateId" uuid NOT NULL,
        "templateVersion" integer NOT NULL,
        "appliedById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_travel_template_applications" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_travel_template_applications_plan_template" UNIQUE ("planId", "templateId"),
        CONSTRAINT "CHK_travel_template_applications_version" CHECK ("templateVersion" >= 1),
        CONSTRAINT "FK_travel_template_applications_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_travel_template_applications_plan" FOREIGN KEY ("planId") REFERENCES "travel_plans"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_travel_template_applications_template" FOREIGN KEY ("templateId") REFERENCES "travel_packing_templates"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_travel_template_applications_applied_by" FOREIGN KEY ("appliedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "travel_checklist_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "planId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "category" character varying(24) NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "note" character varying(500),
        "sortOrder" integer NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "version" integer NOT NULL DEFAULT 1,
        "assignedMemberId" uuid,
        "completedById" uuid,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "createdById" uuid NOT NULL,
        "updatedById" uuid NOT NULL,
        "templateApplicationId" uuid,
        "sourceTemplateItemId" uuid,
        "archivedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_travel_checklist_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_travel_checklist_items_category" CHECK ("category" IN ('documents', 'clothing', 'toiletries', 'electronics', 'supplies', 'other')),
        CONSTRAINT "CHK_travel_checklist_items_quantity" CHECK ("quantity" BETWEEN 1 AND 99),
        CONSTRAINT "CHK_travel_checklist_items_sort_order" CHECK ("sortOrder" >= 0),
        CONSTRAINT "CHK_travel_checklist_items_status" CHECK ("status" IN ('pending', 'completed', 'skipped')),
        CONSTRAINT "CHK_travel_checklist_items_version" CHECK ("version" >= 1),
        CONSTRAINT "CHK_travel_checklist_items_completion" CHECK (("status" = 'completed' AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL) OR ("status" <> 'completed' AND "completedAt" IS NULL AND "completedById" IS NULL)),
        CONSTRAINT "FK_travel_checklist_items_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_travel_checklist_items_plan" FOREIGN KEY ("planId") REFERENCES "travel_plans"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_travel_checklist_items_assigned" FOREIGN KEY ("assignedMemberId") REFERENCES "members"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_travel_checklist_items_completed_by" FOREIGN KEY ("completedById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_travel_checklist_items_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_travel_checklist_items_updated_by" FOREIGN KEY ("updatedById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_travel_checklist_items_application" FOREIGN KEY ("templateApplicationId") REFERENCES "travel_template_applications"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_travel_checklist_items_source_template_item" FOREIGN KEY ("sourceTemplateItemId") REFERENCES "travel_packing_template_items"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_travel_checklist_items_plan_status" ON "travel_checklist_items" ("planId", "archivedAt", "status", "sortOrder")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_travel_checklist_items_assignee" ON "travel_checklist_items" ("householdId", "assignedMemberId", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "travel_operations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "operation" character varying(40) NOT NULL,
        "targetType" character varying(20) NOT NULL,
        "targetId" uuid NOT NULL,
        "planId" uuid,
        "actorId" uuid NOT NULL,
        "actorName" character varying(64) NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "requestFingerprint" character varying(64) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_travel_operations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_travel_operations_household_idempotency" UNIQUE ("householdId", "idempotencyKey"),
        CONSTRAINT "CHK_travel_operations_target_type" CHECK ("targetType" IN ('plan', 'item', 'template', 'application')),
        CONSTRAINT "CHK_travel_operations_metadata" CHECK (jsonb_typeof("metadata") = 'object'),
        CONSTRAINT "FK_travel_operations_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_travel_operations_actor" FOREIGN KEY ("actorId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_travel_operations_plan_created" ON "travel_operations" ("planId", "createdAt")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION prevent_travel_operation_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'travel operations are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_travel_operations_immutable"
      BEFORE UPDATE OR DELETE ON "travel_operations"
      FOR EACH ROW EXECUTE FUNCTION prevent_travel_operation_mutation()
    `);

    await queryRunner.query(
      `ALTER TABLE "reminders" DROP CONSTRAINT "CHK_reminders_source_module"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reminders" ADD CONSTRAINT "CHK_reminders_source_module" CHECK ("sourceModule" IN ('menu', 'task', 'calendar', 'poll', 'maintenance', 'travel'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "household_activity_logs" DROP CONSTRAINT "CHK_household_activity_logs_module"`,
    );
    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      ADD CONSTRAINT "CHK_household_activity_logs_module"
      CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'knowledge', 'travel', 'system'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "household_activity_logs" DROP CONSTRAINT "CHK_household_activity_logs_module"`,
    );
    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      ADD CONSTRAINT "CHK_household_activity_logs_module"
      CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'knowledge', 'system'))
    `);
    await queryRunner.query(
      `ALTER TABLE "reminders" DROP CONSTRAINT "CHK_reminders_source_module"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reminders" ADD CONSTRAINT "CHK_reminders_source_module" CHECK ("sourceModule" IN ('menu', 'task', 'calendar', 'poll', 'maintenance'))`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_travel_operations_immutable" ON "travel_operations"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "travel_operations"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_travel_operation_mutation()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "travel_checklist_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "travel_template_applications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "travel_packing_template_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "travel_packing_templates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "travel_plans"`);
  }
}
