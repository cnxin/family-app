import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * K 收尾：周期账单自动记账落失败（账户 / 分类停用等）时记下原因和时间（docs/finance-plan.md §8.4）。
 * 有原因的规则调度不再重试，进管理员的留意；管理员「重试」或改动这条规则后清空。
 */
export class AddFinanceRecurringErrors1785234300000 implements MigrationInterface {
  name = 'AddFinanceRecurringErrors1785234300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finance_recurring" ADD "lastError" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "finance_recurring" ADD "lastErrorAt" TIMESTAMP WITH TIME ZONE`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finance_recurring" DROP COLUMN "lastErrorAt"`);
    await queryRunner.query(`ALTER TABLE "finance_recurring" DROP COLUMN "lastError"`);
  }
}
