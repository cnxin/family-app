import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaWatchlist1785227600000 implements MigrationInterface {
  name = 'AddMediaWatchlist1785227600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "media_titles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" character varying(16) NOT NULL,
        "title" character varying(180) NOT NULL,
        "originalTitle" character varying(180),
        "year" integer,
        "overview" character varying(5000),
        "posterUrl" character varying(2000),
        "dedupeKey" character varying(500) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_titles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_media_titles_dedupe_key" UNIQUE ("dedupeKey"),
        CONSTRAINT "CHK_media_titles_type" CHECK ("type" IN ('movie', 'series')),
        CONSTRAINT "CHK_media_titles_year" CHECK ("year" IS NULL OR ("year" >= 1878 AND "year" <= 2199))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "media_external_refs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "mediaTitleId" uuid NOT NULL,
        "provider" character varying(32) NOT NULL,
        "mediaType" character varying(16) NOT NULL,
        "externalId" character varying(180) NOT NULL,
        "connectorKey" character varying(128),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_external_refs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_media_external_refs_provider" CHECK ("provider" IN ('tmdb', 'imdb', 'plex', 'emby', 'moviepilot')),
        CONSTRAINT "CHK_media_external_refs_type" CHECK ("mediaType" IN ('movie', 'series')),
        CONSTRAINT "CHK_media_external_refs_scope" CHECK (
          ("provider" IN ('tmdb', 'imdb') AND "connectorKey" IS NULL) OR
          ("provider" IN ('plex', 'emby', 'moviepilot') AND "connectorKey" IS NOT NULL)
        ),
        CONSTRAINT "FK_media_external_refs_title" FOREIGN KEY ("mediaTitleId")
          REFERENCES "media_titles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_media_external_refs_title"
      ON "media_external_refs" ("mediaTitleId")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_media_external_refs_tmdb_type_id"
      ON "media_external_refs" ("provider", "mediaType", "externalId")
      WHERE "provider" = 'tmdb'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_media_external_refs_imdb_id"
      ON "media_external_refs" ("provider", "externalId")
      WHERE "provider" = 'imdb'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_media_external_refs_connector_id"
      ON "media_external_refs" ("provider", "connectorKey", "externalId")
      WHERE "provider" IN ('plex', 'emby', 'moviepilot')
    `);

    await queryRunner.query(`
      CREATE TABLE "household_media" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "mediaTitleId" uuid NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'watchlist',
        "scheduledFor" date,
        "note" character varying(1000),
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_household_media" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_household_media_household_title" UNIQUE ("householdId", "mediaTitleId"),
        CONSTRAINT "CHK_household_media_status" CHECK ("status" IN ('watchlist', 'voting', 'scheduled', 'watching', 'completed', 'dropped')),
        CONSTRAINT "CHK_household_media_schedule" CHECK ("status" <> 'scheduled' OR "scheduledFor" IS NOT NULL),
        CONSTRAINT "FK_household_media_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_household_media_title" FOREIGN KEY ("mediaTitleId")
          REFERENCES "media_titles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_household_media_created_by" FOREIGN KEY ("createdById")
          REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_household_media_household_status"
      ON "household_media" ("householdId", "status", "updatedAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_household_media_household_schedule"
      ON "household_media" ("householdId", "scheduledFor")
      WHERE "scheduledFor" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      DROP CONSTRAINT "CHK_household_activity_logs_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      ADD CONSTRAINT "CHK_household_activity_logs_module"
      CHECK ("module" IN (
        'member', 'invitation', 'menu', 'calendar', 'task', 'poll',
        'reminder', 'shopping', 'inventory', 'recipe', 'media', 'system'
      ))
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
      CHECK ("module" IN (
        'member', 'invitation', 'menu', 'calendar', 'task', 'poll',
        'reminder', 'shopping', 'inventory', 'recipe', 'system'
      ))
    `);
    await queryRunner.query('DROP TABLE IF EXISTS "household_media"');
    await queryRunner.query('DROP TABLE IF EXISTS "media_external_refs"');
    await queryRunner.query('DROP TABLE IF EXISTS "media_titles"');
  }
}
