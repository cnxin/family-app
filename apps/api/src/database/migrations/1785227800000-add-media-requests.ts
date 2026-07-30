import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaRequests1785227800000 implements MigrationInterface {
  name = 'AddMediaRequests1785227800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "media_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "householdMediaId" uuid NOT NULL,
        "connectorKey" character varying(128) NOT NULL,
        "season" integer NOT NULL DEFAULT 0,
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "externalRequestId" character varying(180),
        "message" character varying(1000),
        "requestedById" uuid NOT NULL,
        "cancelledById" uuid,
        "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_requests" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_media_requests_status" CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
        CONSTRAINT "CHK_media_requests_season" CHECK ("season" >= 0 AND "season" <= 999),
        CONSTRAINT "FK_media_requests_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_media_requests_household_media" FOREIGN KEY ("householdMediaId")
          REFERENCES "household_media"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_media_requests_requested_by" FOREIGN KEY ("requestedById")
          REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_media_requests_cancelled_by" FOREIGN KEY ("cancelledById")
          REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_media_requests_household_status"
      ON "media_requests" ("householdId", "status", "updatedAt")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_media_requests_active_scope"
      ON "media_requests" ("householdId", "householdMediaId", "connectorKey", "season")
      WHERE "status" IN ('pending', 'processing')
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_media_requests_connector_external"
      ON "media_requests" ("connectorKey", "externalRequestId")
      WHERE "externalRequestId" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "media_requests"');
  }
}
