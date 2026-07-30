import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaMetadataSources1785227900000
  implements MigrationInterface
{
  name = 'AddMediaMetadataSources1785227900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "media_external_refs"
      DROP CONSTRAINT "CHK_media_external_refs_provider"
    `);
    await queryRunner.query(`
      ALTER TABLE "media_external_refs"
      ADD CONSTRAINT "CHK_media_external_refs_provider"
      CHECK ("provider" IN ('tmdb', 'imdb', 'douban', 'bangumi', 'plex', 'emby', 'moviepilot'))
    `);
    await queryRunner.query(`
      ALTER TABLE "media_external_refs"
      DROP CONSTRAINT "CHK_media_external_refs_scope"
    `);
    await queryRunner.query(`
      ALTER TABLE "media_external_refs"
      ADD CONSTRAINT "CHK_media_external_refs_scope"
      CHECK (
        ("provider" IN ('tmdb', 'imdb', 'douban', 'bangumi') AND "connectorKey" IS NULL) OR
        ("provider" IN ('plex', 'emby', 'moviepilot') AND "connectorKey" IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_media_external_refs_douban_id"
      ON "media_external_refs" ("provider", "externalId")
      WHERE "provider" = 'douban'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_media_external_refs_bangumi_id"
      ON "media_external_refs" ("provider", "externalId")
      WHERE "provider" = 'bangumi'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_media_external_refs_bangumi_id"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_media_external_refs_douban_id"',
    );
    await queryRunner.query(`
      ALTER TABLE "media_external_refs"
      DROP CONSTRAINT "CHK_media_external_refs_scope"
    `);
    await queryRunner.query(`
      ALTER TABLE "media_external_refs"
      ADD CONSTRAINT "CHK_media_external_refs_scope"
      CHECK (
        ("provider" IN ('tmdb', 'imdb') AND "connectorKey" IS NULL) OR
        ("provider" IN ('plex', 'emby', 'moviepilot') AND "connectorKey" IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "media_external_refs"
      DROP CONSTRAINT "CHK_media_external_refs_provider"
    `);
    await queryRunner.query(`
      ALTER TABLE "media_external_refs"
      ADD CONSTRAINT "CHK_media_external_refs_provider"
      CHECK ("provider" IN ('tmdb', 'imdb', 'plex', 'emby', 'moviepilot'))
    `);
  }
}
