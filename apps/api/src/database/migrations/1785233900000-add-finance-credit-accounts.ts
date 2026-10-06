import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase K4 信用卡账户（docs/finance-plan.md §2.5）：账户类型加 credit，加额度 / 账单日 / 还款日三列。
 * 三列只对 credit 有意义，别的类型必须为空（CHECK）；日子是每月几号（1～31，短月按月末算）。
 * 信用卡余额为负 = 欠款；还款就是现有的转账（银行 → 信用卡），不加流水类型。老账户三列都为空，不受影响。
 */
export class AddFinanceCreditAccounts1785233900000 implements MigrationInterface {
  name = 'AddFinanceCreditAccounts1785233900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finance_accounts" DROP CONSTRAINT "CHK_finance_accounts_type"`);
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" ADD CONSTRAINT "CHK_finance_accounts_type" CHECK ("type" IN ('cash', 'bank', 'alipay', 'wechat', 'other', 'credit'))`,
    );
    await queryRunner.query(`ALTER TABLE "finance_accounts" ADD "creditLimit" numeric(14,2)`);
    await queryRunner.query(`ALTER TABLE "finance_accounts" ADD "billingDay" smallint`);
    await queryRunner.query(`ALTER TABLE "finance_accounts" ADD "dueDay" smallint`);
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" ADD CONSTRAINT "CHK_finance_accounts_credit_fields" CHECK ("type" = 'credit' OR ("creditLimit" IS NULL AND "billingDay" IS NULL AND "dueDay" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" ADD CONSTRAINT "CHK_finance_accounts_credit_limit" CHECK ("creditLimit" IS NULL OR "creditLimit" > 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" ADD CONSTRAINT "CHK_finance_accounts_billing_day" CHECK ("billingDay" IS NULL OR ("billingDay" >= 1 AND "billingDay" <= 31))`,
    );
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" ADD CONSTRAINT "CHK_finance_accounts_due_day" CHECK ("dueDay" IS NULL OR ("dueDay" >= 1 AND "dueDay" <= 31))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['CHK_finance_accounts_due_day', 'CHK_finance_accounts_billing_day', 'CHK_finance_accounts_credit_limit', 'CHK_finance_accounts_credit_fields']) {
      await queryRunner.query(`ALTER TABLE "finance_accounts" DROP CONSTRAINT "${name}"`);
    }
    for (const column of ['dueDay', 'billingDay', 'creditLimit']) {
      await queryRunner.query(`ALTER TABLE "finance_accounts" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`ALTER TABLE "finance_accounts" DROP CONSTRAINT "CHK_finance_accounts_type"`);
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" ADD CONSTRAINT "CHK_finance_accounts_type" CHECK ("type" IN ('cash', 'bank', 'alipay', 'wechat', 'other'))`,
    );
  }
}
