import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase K1 账单导入（docs/finance-plan.md §2.2、§2.3）。
 * - finance_imports：一次上传一个批次。先预览再入库：解析结果放 preview（jsonb），确认或放弃后清空；预览 30 分钟过期。
 *   原文件只在内存里解析，不落盘。通用 CSV 的列对应放 columnMapping。确认后 processedExternalIds 记下这一批所有单号
 *   （导了的和当时选了不导的），同一份账单再导一次时整份标「以前导过」。
 * - finance_merchant_rules：家里人在预览里改过的「商户 → 分类」，下次导入自动用；按归一化后的商户名 + 收支唯一。
 * 导入的流水本身就是 finance_transactions（sourceType = 'import'，externalId = 单号），K3 已建好单号去重的部分唯一索引。
 */
export class AddFinanceImports1785234000000 implements MigrationInterface {
  name = 'AddFinanceImports1785234000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finance_imports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "source" character varying(16) NOT NULL,
        "fileName" character varying(255) NOT NULL,
        "accountId" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'previewing',
        "totalRows" integer NOT NULL DEFAULT 0,
        "importedRows" integer NOT NULL DEFAULT 0,
        "skippedRows" integer NOT NULL DEFAULT 0,
        "duplicateRows" integer NOT NULL DEFAULT 0,
        "rangeFrom" date,
        "rangeTo" date,
        "columnMapping" jsonb,
        "preview" jsonb,
        "processedExternalIds" jsonb NOT NULL DEFAULT '[]',
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "committedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_finance_imports" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_finance_imports_source" CHECK ("source" IN ('alipay', 'wechat', 'csv')),
        CONSTRAINT "CHK_finance_imports_status" CHECK ("status" IN ('previewing', 'committed', 'discarded')),
        CONSTRAINT "CHK_finance_imports_counts" CHECK ("totalRows" >= 0 AND "importedRows" >= 0 AND "skippedRows" >= 0 AND "duplicateRows" >= 0),
        CONSTRAINT "FK_finance_imports_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_imports_account" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_imports_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_imports_household_created" ON "finance_imports" ("householdId", "createdAt")`,
    );
    await queryRunner.query(`
      CREATE TABLE "finance_merchant_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "pattern" character varying(120) NOT NULL,
        "kind" character varying(16) NOT NULL,
        "categoryId" uuid NOT NULL,
        "hits" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_merchant_rules" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_finance_merchant_rules_household_pattern_kind" UNIQUE ("householdId", "pattern", "kind"),
        CONSTRAINT "CHK_finance_merchant_rules_kind" CHECK ("kind" IN ('expense', 'income')),
        CONSTRAINT "CHK_finance_merchant_rules_hits" CHECK ("hits" >= 0),
        CONSTRAINT "FK_finance_merchant_rules_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_merchant_rules_category" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE RESTRICT
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "finance_merchant_rules"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_imports_household_created"`);
    await queryRunner.query(`DROP TABLE "finance_imports"`);
  }
}
