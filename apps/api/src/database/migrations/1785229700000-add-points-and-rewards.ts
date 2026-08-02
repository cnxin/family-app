import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPointsAndRewards1785229700000 implements MigrationInterface {
  name = 'AddPointsAndRewards1785229700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "points_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "balance" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_points_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_points_accounts_household_member" UNIQUE ("householdId", "memberId"),
        CONSTRAINT "CHK_points_accounts_balance" CHECK ("balance" >= 0),
        CONSTRAINT "FK_points_accounts_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_points_accounts_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_points_accounts_household_balance" ON "points_accounts" ("householdId", "balance")`,
    );

    await queryRunner.query(`
      CREATE TABLE "points_ledger" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "accountId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "type" character varying(24) NOT NULL,
        "pointsBefore" integer NOT NULL,
        "delta" integer NOT NULL,
        "pointsAfter" integer NOT NULL,
        "actorId" uuid NOT NULL,
        "actorName" character varying(80) NOT NULL,
        "sourceType" character varying(32) NOT NULL,
        "sourceId" character varying(180) NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "note" character varying(500),
        "reversesLedgerId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_points_ledger" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_points_ledger_type" CHECK ("type" IN ('award', 'adjustment', 'redemption', 'reversal')),
        CONSTRAINT "CHK_points_ledger_source_type" CHECK ("sourceType" IN ('manual', 'task', 'reward_redemption', 'points_ledger')),
        CONSTRAINT "CHK_points_ledger_quantities" CHECK ("pointsBefore" >= 0 AND "pointsAfter" >= 0 AND "delta" <> 0 AND "pointsAfter" = "pointsBefore" + "delta"),
        CONSTRAINT "CHK_points_ledger_reversal" CHECK (("type" = 'reversal' AND "reversesLedgerId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversesLedgerId" IS NULL)),
        CONSTRAINT "FK_points_ledger_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_points_ledger_account" FOREIGN KEY ("accountId") REFERENCES "points_accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_points_ledger_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_points_ledger_actor" FOREIGN KEY ("actorId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_points_ledger_reverses" FOREIGN KEY ("reversesLedgerId") REFERENCES "points_ledger"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_points_ledger_household_idempotency" ON "points_ledger" ("householdId", "idempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_points_ledger_reversal" ON "points_ledger" ("reversesLedgerId") WHERE "reversesLedgerId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_points_ledger_household_created" ON "points_ledger" ("householdId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_points_ledger_member_created" ON "points_ledger" ("memberId", "createdAt")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION prevent_points_ledger_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'points ledger is immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_points_ledger_immutable"
      BEFORE UPDATE OR DELETE ON "points_ledger"
      FOR EACH ROW EXECUTE FUNCTION prevent_points_ledger_mutation()
    `);

    await queryRunner.query(`
      CREATE TABLE "rewards" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "description" character varying(1000),
        "cost" integer NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rewards" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_rewards_household_name" UNIQUE ("householdId", "name"),
        CONSTRAINT "CHK_rewards_cost" CHECK ("cost" >= 1 AND "cost" <= 1000000),
        CONSTRAINT "FK_rewards_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_rewards_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_rewards_household_active" ON "rewards" ("householdId", "isActive", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "reward_redemptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "rewardId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "rewardName" character varying(120) NOT NULL,
        "cost" integer NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "requestNote" character varying(500),
        "requestIdempotencyKey" character varying(180) NOT NULL,
        "debitLedgerId" uuid NOT NULL,
        "handledById" uuid,
        "handledAt" TIMESTAMP WITH TIME ZONE,
        "decisionNote" character varying(500),
        "resolutionIdempotencyKey" character varying(180),
        "restoreLedgerId" uuid,
        "reversedById" uuid,
        "reversedAt" TIMESTAMP WITH TIME ZONE,
        "reversalNote" character varying(500),
        "reversalIdempotencyKey" character varying(180),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reward_redemptions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_reward_redemptions_cost" CHECK ("cost" >= 1),
        CONSTRAINT "CHK_reward_redemptions_status" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled', 'reversed')),
        CONSTRAINT "FK_reward_redemptions_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reward_redemptions_reward" FOREIGN KEY ("rewardId") REFERENCES "rewards"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reward_redemptions_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reward_redemptions_debit" FOREIGN KEY ("debitLedgerId") REFERENCES "points_ledger"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reward_redemptions_handled_by" FOREIGN KEY ("handledById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reward_redemptions_restore" FOREIGN KEY ("restoreLedgerId") REFERENCES "points_ledger"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reward_redemptions_reversed_by" FOREIGN KEY ("reversedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reward_redemptions_household_request_key" ON "reward_redemptions" ("householdId", "requestIdempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reward_redemptions_household_resolution_key" ON "reward_redemptions" ("householdId", "resolutionIdempotencyKey") WHERE "resolutionIdempotencyKey" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reward_redemptions_household_reversal_key" ON "reward_redemptions" ("householdId", "reversalIdempotencyKey") WHERE "reversalIdempotencyKey" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reward_redemptions_debit_ledger" ON "reward_redemptions" ("debitLedgerId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reward_redemptions_restore_ledger" ON "reward_redemptions" ("restoreLedgerId") WHERE "restoreLedgerId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reward_redemptions_household_status" ON "reward_redemptions" ("householdId", "status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reward_redemptions_member_created" ON "reward_redemptions" ("memberId", "createdAt")`,
    );

    await queryRunner.query(`ALTER TABLE "household_tasks" ADD "rewardPoints" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "household_tasks" ADD CONSTRAINT "CHK_household_tasks_reward_points" CHECK ("rewardPoints" >= 0 AND "rewardPoints" <= 10000)`);
    await queryRunner.query(`ALTER TABLE "household_task_instances" ADD "pointsLedgerId" uuid`);
    await queryRunner.query(`ALTER TABLE "household_task_instances" ADD "pointsAwardVersion" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "household_task_instances" ADD CONSTRAINT "CHK_household_task_instances_points_version" CHECK ("pointsAwardVersion" >= 0)`);
    await queryRunner.query(`ALTER TABLE "household_task_instances" ADD CONSTRAINT "FK_household_task_instances_points_ledger" FOREIGN KEY ("pointsLedgerId") REFERENCES "points_ledger"("id") ON DELETE RESTRICT`);

    await queryRunner.query(`ALTER TABLE "household_activity_logs" DROP CONSTRAINT "CHK_household_activity_logs_module"`);
    await queryRunner.query(`ALTER TABLE "household_activity_logs" ADD CONSTRAINT "CHK_household_activity_logs_module" CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'system'))`);
    await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "CHK_notifications_module"`);
    await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "CHK_notifications_module" CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'guest', 'points', 'system'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "CHK_notifications_module"`);
    await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "CHK_notifications_module" CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'guest', 'system'))`);
    await queryRunner.query(`ALTER TABLE "household_activity_logs" DROP CONSTRAINT "CHK_household_activity_logs_module"`);
    await queryRunner.query(`ALTER TABLE "household_activity_logs" ADD CONSTRAINT "CHK_household_activity_logs_module" CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'system'))`);
    await queryRunner.query(`ALTER TABLE "household_task_instances" DROP CONSTRAINT "FK_household_task_instances_points_ledger"`);
    await queryRunner.query(`ALTER TABLE "household_task_instances" DROP CONSTRAINT "CHK_household_task_instances_points_version"`);
    await queryRunner.query(`ALTER TABLE "household_task_instances" DROP COLUMN "pointsAwardVersion"`);
    await queryRunner.query(`ALTER TABLE "household_task_instances" DROP COLUMN "pointsLedgerId"`);
    await queryRunner.query(`ALTER TABLE "household_tasks" DROP CONSTRAINT "CHK_household_tasks_reward_points"`);
    await queryRunner.query(`ALTER TABLE "household_tasks" DROP COLUMN "rewardPoints"`);
    await queryRunner.query(`DROP TABLE "reward_redemptions"`);
    await queryRunner.query(`DROP TABLE "rewards"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_points_ledger_immutable" ON "points_ledger"`);
    await queryRunner.query(`DROP TABLE "points_ledger"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_points_ledger_mutation()`);
    await queryRunner.query(`DROP TABLE "points_accounts"`);
  }
}
