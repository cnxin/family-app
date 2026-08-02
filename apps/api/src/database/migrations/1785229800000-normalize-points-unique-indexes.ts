import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizePointsUniqueIndexes1785229800000
  implements MigrationInterface
{
  name = 'NormalizePointsUniqueIndexes1785229800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.normalize(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // This compatibility migration does not change the logical schema.
    await this.normalize(queryRunner);
  }

  private async normalize(queryRunner: QueryRunner) {
    await queryRunner.query(
      `ALTER TABLE "points_ledger" DROP CONSTRAINT IF EXISTS "FK_points_ledger_reverses"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" DROP CONSTRAINT IF EXISTS "FK_reward_redemptions_debit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" DROP CONSTRAINT IF EXISTS "FK_reward_redemptions_restore"`,
    );

    for (const [table, constraint] of [
      ['points_ledger', 'UQ_points_ledger_household_idempotency'],
      ['points_ledger', 'UQ_points_ledger_reversal'],
      [
        'reward_redemptions',
        'UQ_reward_redemptions_household_request_key',
      ],
      [
        'reward_redemptions',
        'UQ_reward_redemptions_household_resolution_key',
      ],
      [
        'reward_redemptions',
        'UQ_reward_redemptions_household_reversal_key',
      ],
      ['reward_redemptions', 'UQ_reward_redemptions_debit_ledger'],
      ['reward_redemptions', 'UQ_reward_redemptions_restore_ledger'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`,
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_points_ledger_household_idempotency" ON "points_ledger" ("householdId", "idempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_points_ledger_reversal" ON "points_ledger" ("reversesLedgerId") WHERE "reversesLedgerId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_reward_redemptions_household_request_key" ON "reward_redemptions" ("householdId", "requestIdempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_reward_redemptions_household_resolution_key" ON "reward_redemptions" ("householdId", "resolutionIdempotencyKey") WHERE "resolutionIdempotencyKey" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_reward_redemptions_household_reversal_key" ON "reward_redemptions" ("householdId", "reversalIdempotencyKey") WHERE "reversalIdempotencyKey" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_reward_redemptions_debit_ledger" ON "reward_redemptions" ("debitLedgerId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_reward_redemptions_restore_ledger" ON "reward_redemptions" ("restoreLedgerId") WHERE "restoreLedgerId" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "points_ledger" ADD CONSTRAINT "FK_points_ledger_reverses" FOREIGN KEY ("reversesLedgerId") REFERENCES "points_ledger"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" ADD CONSTRAINT "FK_reward_redemptions_debit" FOREIGN KEY ("debitLedgerId") REFERENCES "points_ledger"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" ADD CONSTRAINT "FK_reward_redemptions_restore" FOREIGN KEY ("restoreLedgerId") REFERENCES "points_ledger"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
