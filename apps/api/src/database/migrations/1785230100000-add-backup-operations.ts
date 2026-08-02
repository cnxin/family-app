import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBackupOperations1785230100000 implements MigrationInterface {
  name = 'AddBackupOperations1785230100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "backup_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "scheduleEnabled" boolean NOT NULL DEFAULT false,
        "frequency" character varying(16) NOT NULL DEFAULT 'daily',
        "weeklyDay" smallint,
        "scheduledHour" smallint NOT NULL DEFAULT 3,
        "scheduledMinute" smallint NOT NULL DEFAULT 0,
        "retentionDays" integer NOT NULL DEFAULT 30,
        "retentionCount" integer NOT NULL DEFAULT 14,
        "capacityWarningPercent" smallint NOT NULL DEFAULT 80,
        "capacityCriticalPercent" smallint NOT NULL DEFAULT 90,
        "restoreDrillEnabled" boolean NOT NULL DEFAULT false,
        "restoreDrillDay" smallint NOT NULL DEFAULT 1,
        "restoreDrillHour" smallint NOT NULL DEFAULT 4,
        "nextBackupAt" TIMESTAMP WITH TIME ZONE,
        "nextRestoreDrillAt" TIMESTAMP WITH TIME ZONE,
        "lastStorageCheckedAt" TIMESTAMP WITH TIME ZONE,
        "storageTotalBytes" bigint,
        "storageAvailableBytes" bigint,
        "storageUsedBytes" bigint,
        "capacityStatus" character varying(16) NOT NULL DEFAULT 'unknown',
        "capacityNotifiedStatus" character varying(16),
        "capacityAlertedAt" TIMESTAMP WITH TIME ZONE,
        "workerLastSeenAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_backup_policies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_backup_policies_household" UNIQUE ("householdId"),
        CONSTRAINT "CHK_backup_policies_frequency" CHECK ("frequency" IN ('daily', 'weekly')),
        CONSTRAINT "CHK_backup_policies_schedule" CHECK ("scheduledHour" BETWEEN 0 AND 23 AND "scheduledMinute" BETWEEN 0 AND 59 AND ("weeklyDay" IS NULL OR "weeklyDay" BETWEEN 0 AND 6)),
        CONSTRAINT "CHK_backup_policies_retention" CHECK ("retentionDays" BETWEEN 1 AND 3650 AND "retentionCount" BETWEEN 1 AND 365),
        CONSTRAINT "CHK_backup_policies_capacity_thresholds" CHECK ("capacityWarningPercent" BETWEEN 1 AND 98 AND "capacityCriticalPercent" BETWEEN 2 AND 99 AND "capacityWarningPercent" < "capacityCriticalPercent"),
        CONSTRAINT "CHK_backup_policies_restore_schedule" CHECK ("restoreDrillDay" BETWEEN 1 AND 28 AND "restoreDrillHour" BETWEEN 0 AND 23),
        CONSTRAINT "CHK_backup_policies_capacity_status" CHECK ("capacityStatus" IN ('unknown', 'ok', 'warning', 'critical') AND ("capacityNotifiedStatus" IS NULL OR "capacityNotifiedStatus" IN ('warning', 'critical'))),
        CONSTRAINT "FK_backup_policies_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "backup_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "kind" character varying(24) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'queued',
        "trigger" character varying(16) NOT NULL,
        "sourceBackupRunId" uuid,
        "requestedById" uuid,
        "idempotencyKey" character varying(180) NOT NULL,
        "scheduledFor" TIMESTAMP WITH TIME ZONE,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "heartbeatAt" TIMESTAMP WITH TIME ZONE,
        "backupLabel" character varying(120),
        "databaseBytes" bigint,
        "uploadsBytes" bigint,
        "totalBytes" bigint,
        "checksumVerified" boolean,
        "restoredMigrationCount" integer,
        "retentionDeletedCount" integer NOT NULL DEFAULT 0,
        "retained" boolean NOT NULL DEFAULT true,
        "purgedAt" TIMESTAMP WITH TIME ZONE,
        "errorCode" character varying(64),
        "errorMessage" character varying(300),
        "resultSummary" character varying(300),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_backup_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_backup_runs_household_idempotency" UNIQUE ("householdId", "idempotencyKey"),
        CONSTRAINT "CHK_backup_runs_kind" CHECK ("kind" IN ('backup', 'restore_drill', 'capacity_check')),
        CONSTRAINT "CHK_backup_runs_status" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        CONSTRAINT "CHK_backup_runs_trigger" CHECK ("trigger" IN ('manual', 'scheduled')),
        CONSTRAINT "CHK_backup_runs_source" CHECK (("kind" = 'restore_drill' AND "sourceBackupRunId" IS NOT NULL) OR ("kind" <> 'restore_drill' AND "sourceBackupRunId" IS NULL)),
        CONSTRAINT "CHK_backup_runs_sizes" CHECK (("databaseBytes" IS NULL OR "databaseBytes" >= 0) AND ("uploadsBytes" IS NULL OR "uploadsBytes" >= 0) AND ("totalBytes" IS NULL OR "totalBytes" >= 0) AND ("restoredMigrationCount" IS NULL OR "restoredMigrationCount" >= 0) AND "retentionDeletedCount" >= 0),
        CONSTRAINT "FK_backup_runs_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_backup_runs_source" FOREIGN KEY ("sourceBackupRunId") REFERENCES "backup_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_backup_runs_requested_by" FOREIGN KEY ("requestedById") REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_backup_runs_queue" ON "backup_runs" ("status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_backup_runs_household_history" ON "backup_runs" ("householdId", "createdAt" DESC)`,
    );
    await queryRunner.query(`
      INSERT INTO "backup_policies" ("householdId")
      SELECT "id" FROM "households"
      ON CONFLICT ("householdId") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "backup_runs"`);
    await queryRunner.query(`DROP TABLE "backup_policies"`);
  }
}
