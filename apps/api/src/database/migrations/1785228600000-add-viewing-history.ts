import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewingHistory1785228600000 implements MigrationInterface {
  name = 'AddViewingHistory1785228600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "viewing_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "integrationId" uuid,
        "provider" varchar(32) NOT NULL,
        "connectorKey" varchar(128) NOT NULL,
        "serverId" varchar(180) NOT NULL,
        "externalSessionId" varchar(180) NOT NULL,
        "playbackKey" varchar(64) NOT NULL,
        "mediaLibraryItemId" uuid,
        "mediaTitleId" uuid,
        "libraryItemId" varchar(180) NOT NULL,
        "contentItemId" varchar(180) NOT NULL,
        "mediaType" varchar(16) NOT NULL,
        "title" varchar(240) NOT NULL,
        "deviceName" varchar(180),
        "status" varchar(24) NOT NULL,
        "positionMs" integer NOT NULL DEFAULT 0,
        "durationMs" integer,
        "startedAt" timestamptz NOT NULL,
        "endedAt" timestamptz,
        "lastEventAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_viewing_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_viewing_sessions_provider" CHECK ("provider" IN ('plex', 'emby')),
        CONSTRAINT "CHK_viewing_sessions_media_type" CHECK ("mediaType" IN ('movie', 'series')),
        CONSTRAINT "CHK_viewing_sessions_status" CHECK ("status" IN ('active', 'paused', 'stopped', 'completed')),
        CONSTRAINT "UQ_viewing_sessions_external" UNIQUE ("integrationId", "serverId", "externalSessionId"),
        CONSTRAINT "FK_viewing_sessions_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_viewing_sessions_integration" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_viewing_sessions_library_item" FOREIGN KEY ("mediaLibraryItemId") REFERENCES "media_library_items"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_viewing_sessions_media_title" FOREIGN KEY ("mediaTitleId") REFERENCES "media_titles"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_viewing_sessions_household_last_event" ON "viewing_sessions" ("householdId", "lastEventAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_viewing_sessions_playback_key" ON "viewing_sessions" ("integrationId", "serverId", "playbackKey", "lastEventAt")`);

    await queryRunner.query(`
      CREATE TABLE "viewing_participants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "memberId" uuid,
        "memberName" varchar(180) NOT NULL,
        "externalUserId" varchar(180) NOT NULL,
        "externalUserName" varchar(180) NOT NULL,
        "joinedAt" timestamptz NOT NULL,
        "lastSeenAt" timestamptz NOT NULL,
        "finalPositionMs" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_viewing_participants" PRIMARY KEY ("id"),
        CONSTRAINT "FK_viewing_participants_session" FOREIGN KEY ("sessionId") REFERENCES "viewing_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_viewing_participants_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_viewing_participants_session_member" ON "viewing_participants" ("sessionId", "memberId") WHERE "memberId" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_viewing_participants_member_seen" ON "viewing_participants" ("memberId", "lastSeenAt")`);

    await queryRunner.query(`
      CREATE TABLE "viewing_progress" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "provider" varchar(32) NOT NULL,
        "connectorKey" varchar(128) NOT NULL,
        "mediaLibraryItemId" uuid,
        "mediaTitleId" uuid,
        "lastViewingSessionId" uuid,
        "contentItemId" varchar(180) NOT NULL,
        "title" varchar(240) NOT NULL,
        "positionMs" integer NOT NULL DEFAULT 0,
        "durationMs" integer,
        "percentage" double precision NOT NULL DEFAULT 0,
        "completed" boolean NOT NULL DEFAULT false,
        "lastWatchedAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_viewing_progress" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_viewing_progress_provider" CHECK ("provider" IN ('plex', 'emby')),
        CONSTRAINT "UQ_viewing_progress_member_item" UNIQUE ("householdId", "memberId", "connectorKey", "contentItemId"),
        CONSTRAINT "FK_viewing_progress_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_viewing_progress_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_viewing_progress_library_item" FOREIGN KEY ("mediaLibraryItemId") REFERENCES "media_library_items"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_viewing_progress_media_title" FOREIGN KEY ("mediaTitleId") REFERENCES "media_titles"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_viewing_progress_last_session" FOREIGN KEY ("lastViewingSessionId") REFERENCES "viewing_sessions"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_viewing_progress_household_watched" ON "viewing_progress" ("householdId", "lastWatchedAt")`);

    await queryRunner.query(`ALTER TABLE "integration_events" ADD "viewingSessionId" uuid`);
    await queryRunner.query(`ALTER TABLE "integration_events" ADD CONSTRAINT "FK_integration_events_viewing_session" FOREIGN KEY ("viewingSessionId") REFERENCES "viewing_sessions"("id") ON DELETE SET NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integration_events" DROP CONSTRAINT IF EXISTS "FK_integration_events_viewing_session"`);
    await queryRunner.query(`ALTER TABLE "integration_events" DROP COLUMN IF EXISTS "viewingSessionId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "viewing_progress"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "viewing_participants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "viewing_sessions"`);
  }
}
