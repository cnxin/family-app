import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase K5 流水编辑与批量整理（docs/finance-plan.md §3-K5）。账本仍不改过去的分录：
 * - 改金额 / 账户 / 收支方向 = 冲销原笔 + 按新值另记一笔，原笔 supersededById 指向新笔（一笔只能被替代一次）；
 * - 删除 = 冲销原笔 + 记下 deletedAt。
 * 被替代 / 删除的原笔和它们的冲销笔默认不在列表里。改名称、分类、备注、日期、商户是原地改，不动这两列。
 *
 * 账本触发器随之从「流水一律不许改」放宽成只许改上面这几列：金额、类型、账户（分录）、记账人、来源、幂等键等一律不许改，
 * 流水和分录都不许删，分录完全不许改；撤销笔、已删除、已被替代的笔不许再改；单号只许清空（改金额时挪到新笔上）。
 */
const GUARD = `
  CREATE FUNCTION "guard_finance_transaction_update"()
  RETURNS trigger AS $$
  BEGIN
    IF TG_OP = 'DELETE'
       OR OLD.type = 'reversal' OR OLD."deletedAt" IS NOT NULL OR OLD."supersededById" IS NOT NULL
       OR NEW.id IS DISTINCT FROM OLD.id OR NEW."householdId" IS DISTINCT FROM OLD."householdId"
       OR NEW.type IS DISTINCT FROM OLD.type OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW."actorId" IS DISTINCT FROM OLD."actorId" OR NEW."actorName" IS DISTINCT FROM OLD."actorName"
       OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType" OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
       OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
       OR NEW."reversalOfId" IS DISTINCT FROM OLD."reversalOfId"
       OR NEW."attachmentPath" IS DISTINCT FROM OLD."attachmentPath"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
       OR (NEW."externalId" IS DISTINCT FROM OLD."externalId" AND NEW."externalId" IS NOT NULL) THEN
      RAISE EXCEPTION 'finance ledger is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql
`;
export class AddFinanceTransactionEdits1785234100000 implements MigrationInterface {
  name = 'AddFinanceTransactionEdits1785234100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finance_transactions" ADD "supersededById" uuid`);
    await queryRunner.query(`ALTER TABLE "finance_transactions" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`
      ALTER TABLE "finance_transactions"
        ADD CONSTRAINT "FK_finance_transactions_superseded_by"
        FOREIGN KEY ("supersededById") REFERENCES "finance_transactions"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "finance_transactions"
        ADD CONSTRAINT "CHK_finance_transactions_hidden"
        CHECK (("supersededById" IS NULL OR "deletedAt" IS NULL) AND ("type" <> 'reversal' OR ("supersededById" IS NULL AND "deletedAt" IS NULL)))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_transactions_superseded_by"
        ON "finance_transactions" ("supersededById") WHERE "supersededById" IS NOT NULL
    `);
    await queryRunner.query(`DROP TRIGGER "TRG_finance_transactions_immutable" ON "finance_transactions"`);
    await queryRunner.query(GUARD);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_finance_transactions_guarded"
      BEFORE UPDATE OR DELETE ON "finance_transactions"
      FOR EACH ROW EXECUTE FUNCTION "guard_finance_transaction_update"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "TRG_finance_transactions_guarded" ON "finance_transactions"`);
    await queryRunner.query(`DROP FUNCTION "guard_finance_transaction_update"`);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_finance_transactions_immutable"
      BEFORE UPDATE OR DELETE ON "finance_transactions"
      FOR EACH ROW EXECUTE FUNCTION "reject_finance_ledger_mutation"()
    `);
    await queryRunner.query(`DROP INDEX "UQ_finance_transactions_superseded_by"`);
    await queryRunner.query(`ALTER TABLE "finance_transactions" DROP CONSTRAINT "CHK_finance_transactions_hidden"`);
    await queryRunner.query(`ALTER TABLE "finance_transactions" DROP CONSTRAINT "FK_finance_transactions_superseded_by"`);
    await queryRunner.query(`ALTER TABLE "finance_transactions" DROP COLUMN "deletedAt"`);
    await queryRunner.query(`ALTER TABLE "finance_transactions" DROP COLUMN "supersededById"`);
  }
}
