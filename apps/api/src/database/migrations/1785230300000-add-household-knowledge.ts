import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHouseholdKnowledge1785230300000 implements MigrationInterface {
  name = 'AddHouseholdKnowledge1785230300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "knowledge_articles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "category" character varying(24) NOT NULL,
        "summary" character varying(500),
        "content" text NOT NULL,
        "referenceUrl" character varying(2000),
        "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "isPinned" boolean NOT NULL DEFAULT false,
        "version" integer NOT NULL DEFAULT 1,
        "createdById" uuid NOT NULL,
        "updatedById" uuid NOT NULL,
        "archivedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_articles" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_knowledge_articles_category" CHECK ("category" IN ('procedure', 'appliance', 'contact', 'home', 'other')),
        CONSTRAINT "CHK_knowledge_articles_version" CHECK ("version" >= 1),
        CONSTRAINT "CHK_knowledge_articles_tags" CHECK (jsonb_typeof("tags") = 'array'),
        CONSTRAINT "FK_knowledge_articles_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_knowledge_articles_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_knowledge_articles_updated_by" FOREIGN KEY ("updatedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_articles_household_active" ON "knowledge_articles" ("householdId", "archivedAt", "isPinned", "updatedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_articles_household_category" ON "knowledge_articles" ("householdId", "category", "updatedAt")`,
    );
    await queryRunner.query(`
      CREATE TABLE "knowledge_article_revisions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "articleId" uuid NOT NULL,
        "version" integer NOT NULL,
        "changeType" character varying(24) NOT NULL,
        "title" character varying(120) NOT NULL,
        "category" character varying(24) NOT NULL,
        "summary" character varying(500),
        "content" text NOT NULL,
        "referenceUrl" character varying(2000),
        "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "isPinned" boolean NOT NULL DEFAULT false,
        "archivedAt" TIMESTAMP WITH TIME ZONE,
        "changedById" uuid NOT NULL,
        "changedByName" character varying(64) NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "requestFingerprint" character varying(64) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_article_revisions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_knowledge_revisions_article_version" UNIQUE ("articleId", "version"),
        CONSTRAINT "UQ_knowledge_revisions_household_idempotency" UNIQUE ("householdId", "idempotencyKey"),
        CONSTRAINT "CHK_knowledge_revisions_change_type" CHECK ("changeType" IN ('create', 'update', 'archive', 'restore', 'restore_revision')),
        CONSTRAINT "CHK_knowledge_revisions_category" CHECK ("category" IN ('procedure', 'appliance', 'contact', 'home', 'other')),
        CONSTRAINT "CHK_knowledge_revisions_version" CHECK ("version" >= 1),
        CONSTRAINT "CHK_knowledge_revisions_tags" CHECK (jsonb_typeof("tags") = 'array'),
        CONSTRAINT "FK_knowledge_revisions_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_knowledge_revisions_article" FOREIGN KEY ("articleId") REFERENCES "knowledge_articles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_knowledge_revisions_changed_by" FOREIGN KEY ("changedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_revisions_article_created" ON "knowledge_article_revisions" ("articleId", "createdAt")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION prevent_knowledge_revision_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'knowledge article revisions are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_knowledge_revisions_immutable"
      BEFORE UPDATE OR DELETE ON "knowledge_article_revisions"
      FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_revision_mutation()
    `);

    await queryRunner.query(
      `ALTER TABLE "household_activity_logs" DROP CONSTRAINT "CHK_household_activity_logs_module"`,
    );
    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      ADD CONSTRAINT "CHK_household_activity_logs_module"
      CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'knowledge', 'system'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "household_activity_logs" DROP CONSTRAINT "CHK_household_activity_logs_module"`,
    );
    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      ADD CONSTRAINT "CHK_household_activity_logs_module"
      CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'system'))
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_knowledge_revisions_immutable" ON "knowledge_article_revisions"`,
    );
    await queryRunner.query(`DROP TABLE "knowledge_article_revisions"`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS prevent_knowledge_revision_mutation()`,
    );
    await queryRunner.query(`DROP TABLE "knowledge_articles"`);
  }
}
