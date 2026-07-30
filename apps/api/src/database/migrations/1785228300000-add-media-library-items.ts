import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaLibraryItems1785228300000 implements MigrationInterface {
  name = 'AddMediaLibraryItems1785228300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "media_library_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "mediaTitleId" uuid,
        "provider" varchar(32) NOT NULL,
        "connectorKey" varchar(128) NOT NULL,
        "libraryItemId" varchar(180) NOT NULL,
        "mediaType" varchar(16) NOT NULL,
        "title" varchar(180) NOT NULL,
        "originalTitle" varchar(180),
        "year" integer,
        "overview" varchar(5000),
        "posterUrl" varchar(2000),
        "externalRefs" jsonb NOT NULL DEFAULT '[]',
        "playbackUrl" varchar(4000),
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "lastSeenAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_library_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_media_library_items_provider" CHECK ("provider" IN ('plex', 'emby')),
        CONSTRAINT "CHK_media_library_items_type" CHECK ("mediaType" IN ('movie', 'series')),
        CONSTRAINT "UQ_media_library_items_connector_item" UNIQUE ("householdId", "connectorKey", "libraryItemId"),
        CONSTRAINT "FK_media_library_items_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_media_library_items_media_title" FOREIGN KEY ("mediaTitleId") REFERENCES "media_titles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_media_library_items_household_title"
      ON "media_library_items" ("householdId", "title")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_media_library_items_media_title"
      ON "media_library_items" ("mediaTitleId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "media_library_items"');
  }
}
