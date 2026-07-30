import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaPollCandidates1785228200000 implements MigrationInterface {
  name = 'AddMediaPollCandidates1785228200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "poll_options"
      ADD COLUMN "mediaId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "poll_options"
      ADD CONSTRAINT "FK_poll_options_media" FOREIGN KEY ("mediaId")
      REFERENCES "household_media"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_poll_options_media" ON "poll_options" ("mediaId")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_poll_options_poll_media"
      ON "poll_options" ("pollId", "mediaId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_poll_options_poll_media"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_poll_options_media"');
    await queryRunner.query(
      'ALTER TABLE "poll_options" DROP CONSTRAINT IF EXISTS "FK_poll_options_media"',
    );
    await queryRunner.query('ALTER TABLE "poll_options" DROP COLUMN IF EXISTS "mediaId"');
  }
}
