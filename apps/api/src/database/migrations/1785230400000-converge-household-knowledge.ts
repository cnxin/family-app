import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvergeHouseholdKnowledge1785230400000
  implements MigrationInterface
{
  name = 'ConvergeHouseholdKnowledge1785230400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "knowledge_article_revisions"
      ADD COLUMN IF NOT EXISTS "requestFingerprint" character varying(64)
    `);
    await queryRunner.query(`
      UPDATE "knowledge_article_revisions"
      SET "requestFingerprint" = md5("id"::text || "idempotencyKey") || md5("idempotencyKey" || "id"::text)
      WHERE "requestFingerprint" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "knowledge_article_revisions"
      ALTER COLUMN "requestFingerprint" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "knowledge_article_revisions"
      ALTER COLUMN "createdAt" SET DEFAULT now()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "knowledge_article_revisions"
      ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp()
    `);
  }
}
