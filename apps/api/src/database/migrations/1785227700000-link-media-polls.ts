import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkMediaPolls1785227700000 implements MigrationInterface {
  name = 'LinkMediaPolls1785227700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_polls_active_media_source"
      ON "polls" ("householdId", "sourceModule", "sourceId")
      WHERE "sourceModule" = 'media' AND "isArchived" = false AND "status" = 'open'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_polls_active_media_source"');
  }
}
