import { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_SOURCE_TYPES = ['manual', 'agent', 'shopping_item', 'asset', 'media_subscription', 'finance_transaction'];
const NEW_SOURCE_TYPES = [...OLD_SOURCE_TYPES, 'import', 'recurring', 'screenshot'];
const list = (values: string[]) => values.map((value) => `'${value}'`).join(', ');

/**
 * Phase K3 周期账单（docs/finance-plan.md §2.4）与流水的三列（§2.1）。
 * - finance_recurring：房租、物业费、会员、工资……下次日期由 anchorOn + cadence 推进；autoPost 到期自动落流水，
 *   否则到期前 3 天进留意，有人点「已付」才落。落的流水 sourceType = 'recurring'、idempotencyKey = recurring:<id>:<那一期>。
 * - finance_transactions 加 externalId（K1 导入的交易单号，非空时按家庭 + 来源唯一）、merchant、attachmentPath（K2 截图），
 *   来源 CHECK 加 import / recurring / screenshot。都可空、不回填，老流水不受影响。
 */
export class AddFinanceRecurring1785233800000 implements MigrationInterface {
  name = 'AddFinanceRecurring1785233800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finance_recurring" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "type" character varying(16) NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "accountId" uuid NOT NULL,
        "categoryId" uuid NOT NULL,
        "cadence" character varying(16) NOT NULL,
        "anchorOn" date NOT NULL,
        "nextDueOn" date NOT NULL,
        "autoPost" boolean NOT NULL DEFAULT false,
        "lastPostedOn" date,
        "isActive" boolean NOT NULL DEFAULT true,
        "version" integer NOT NULL DEFAULT 1,
        "createdById" uuid NOT NULL,
        "updatedById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_recurring" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_finance_recurring_type" CHECK ("type" IN ('expense', 'income')),
        CONSTRAINT "CHK_finance_recurring_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_finance_recurring_cadence" CHECK ("cadence" IN ('weekly', 'monthly', 'quarterly', 'yearly')),
        CONSTRAINT "CHK_finance_recurring_next_due" CHECK ("nextDueOn" >= "anchorOn"),
        CONSTRAINT "CHK_finance_recurring_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_finance_recurring_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_recurring_account" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_recurring_category" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_recurring_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_recurring_updated_by" FOREIGN KEY ("updatedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_recurring_household_due" ON "finance_recurring" ("householdId", "isActive", "nextDueOn")`,
    );

    await queryRunner.query(`ALTER TABLE "finance_transactions" ADD "externalId" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "finance_transactions" ADD "merchant" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "finance_transactions" ADD "attachmentPath" character varying(255)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_finance_transactions_household_external" ON "finance_transactions" ("householdId", "sourceType", "externalId") WHERE "externalId" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "finance_transactions" DROP CONSTRAINT "CHK_finance_transactions_source_type"`);
    await queryRunner.query(
      `ALTER TABLE "finance_transactions" ADD CONSTRAINT "CHK_finance_transactions_source_type" CHECK ("sourceType" IN (${list(NEW_SOURCE_TYPES)}))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finance_transactions" DROP CONSTRAINT "CHK_finance_transactions_source_type"`);
    await queryRunner.query(
      `ALTER TABLE "finance_transactions" ADD CONSTRAINT "CHK_finance_transactions_source_type" CHECK ("sourceType" IN (${list(OLD_SOURCE_TYPES)}))`,
    );
    await queryRunner.query(`DROP INDEX "UQ_finance_transactions_household_external"`);
    for (const column of ['attachmentPath', 'merchant', 'externalId']) {
      await queryRunner.query(`ALTER TABLE "finance_transactions" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`DROP INDEX "IDX_finance_recurring_household_due"`);
    await queryRunner.query(`DROP TABLE "finance_recurring"`);
  }
}
