import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFamilyMemories1785230600000 implements MigrationInterface {
  name = 'AddFamilyMemories1785230600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "family_memories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "happenedOn" date NOT NULL,
        "category" character varying(24) NOT NULL,
        "story" text,
        "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "sourceModule" character varying(24),
        "sourceId" uuid,
        "version" integer NOT NULL DEFAULT 1,
        "createdById" uuid NOT NULL,
        "updatedById" uuid NOT NULL,
        "archivedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_family_memories" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_family_memories_category" CHECK ("category" IN ('daily', 'celebration', 'travel', 'meal', 'visit', 'milestone', 'other')),
        CONSTRAINT "CHK_family_memories_version" CHECK ("version" >= 1),
        CONSTRAINT "CHK_family_memories_tags" CHECK (jsonb_typeof("tags") = 'array'),
        CONSTRAINT "CHK_family_memories_source" CHECK (("sourceModule" IS NULL AND "sourceId" IS NULL) OR ("sourceModule" IN ('calendar', 'travel', 'menu', 'media', 'visit') AND "sourceId" IS NOT NULL)),
        CONSTRAINT "FK_family_memories_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_family_memories_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_family_memories_updated_by" FOREIGN KEY ("updatedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_family_memories_household_date"
      ON "family_memories" ("householdId", "archivedAt", "happenedOn")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_family_memories_household_category"
      ON "family_memories" ("householdId", "category", "happenedOn")
    `);

    await queryRunner.query(`
      CREATE TABLE "family_memory_photos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memoryId" uuid NOT NULL,
        "caption" character varying(240),
        "storageKey" character varying(180) NOT NULL,
        "mimeType" character varying(64) NOT NULL,
        "sizeBytes" integer NOT NULL,
        "createdById" uuid NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "requestFingerprint" character varying(64) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_family_memory_photos" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_family_memory_photos_size" CHECK ("sizeBytes" BETWEEN 1 AND 10485760),
        CONSTRAINT "UQ_family_memory_photos_household_idempotency" UNIQUE ("householdId", "idempotencyKey"),
        CONSTRAINT "FK_family_memory_photos_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_family_memory_photos_memory" FOREIGN KEY ("memoryId") REFERENCES "family_memories"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_family_memory_photos_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_family_memory_photos_memory_created"
      ON "family_memory_photos" ("memoryId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "family_memory_operations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memoryId" uuid NOT NULL,
        "operation" character varying(24) NOT NULL,
        "resultVersion" integer NOT NULL,
        "actorId" uuid NOT NULL,
        "actorName" character varying(64) NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "requestFingerprint" character varying(64) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_family_memory_operations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_family_memory_operations_type" CHECK ("operation" IN ('create', 'update', 'archive', 'restore')),
        CONSTRAINT "CHK_family_memory_operations_version" CHECK ("resultVersion" >= 1),
        CONSTRAINT "UQ_family_memory_operations_household_idempotency" UNIQUE ("householdId", "idempotencyKey"),
        CONSTRAINT "FK_family_memory_operations_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_family_memory_operations_memory" FOREIGN KEY ("memoryId") REFERENCES "family_memories"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_family_memory_operations_actor" FOREIGN KEY ("actorId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_family_memory_operations_memory_created"
      ON "family_memory_operations" ("memoryId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE FUNCTION "reject_family_memory_operation_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'family memory operations are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_family_memory_operations_immutable"
      BEFORE UPDATE OR DELETE ON "family_memory_operations"
      FOR EACH ROW EXECUTE FUNCTION "reject_family_memory_operation_mutation"()
    `);

    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      DROP CONSTRAINT "CHK_household_activity_logs_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      ADD CONSTRAINT "CHK_household_activity_logs_module"
      CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'knowledge', 'memory', 'travel', 'system'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      DROP CONSTRAINT "CHK_household_activity_logs_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      ADD CONSTRAINT "CHK_household_activity_logs_module"
      CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'knowledge', 'travel', 'system'))
    `);
    await queryRunner.query('DROP TRIGGER "TRG_family_memory_operations_immutable" ON "family_memory_operations"');
    await queryRunner.query('DROP FUNCTION "reject_family_memory_operation_mutation"');
    await queryRunner.query('DROP TABLE "family_memory_operations"');
    await queryRunner.query('DROP TABLE "family_memory_photos"');
    await queryRunner.query('DROP TABLE "family_memories"');
  }
}
