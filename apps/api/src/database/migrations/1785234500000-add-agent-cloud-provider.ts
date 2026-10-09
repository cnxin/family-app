import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * J4.3 云端档配置（docs/j4-agent-plan.md §3）：服务商、地址、模型、加密存的 key、「测一下」的结果、
 * 第 2 档对谁开放（默认只对管理员）；agent_runs 记档位与是否脱敏。
 * 老家庭升级后：runtimeKind 不变，新列为空，tier2Scope = admins；老 run 的 tier 留空。
 */
export class AddAgentCloudProvider1785234500000 implements MigrationInterface {
  name = 'AddAgentCloudProvider1785234500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "providerKind" character varying(16)`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "providerBaseUrl" character varying(300)`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "providerModel" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "providerKeyEncrypted" text`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "providerCheckedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "providerCheckOk" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "tier2Scope" character varying(8) NOT NULL DEFAULT 'admins'`);
    await queryRunner.query(
      `ALTER TABLE "agent_settings" ADD CONSTRAINT "CHK_agent_settings_provider_kind" CHECK ("providerKind" IS NULL OR "providerKind" IN ('deepseek', 'qwen', 'zhipu', 'kimi', 'custom'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_settings" ADD CONSTRAINT "CHK_agent_settings_tier2_scope" CHECK ("tier2Scope" IN ('admins', 'all'))`,
    );
    await queryRunner.query(`ALTER TABLE "agent_runs" ADD "tier" smallint`);
    await queryRunner.query(`ALTER TABLE "agent_runs" ADD "redacted" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ADD CONSTRAINT "CHK_agent_runs_tier" CHECK ("tier" IS NULL OR "tier" BETWEEN 0 AND 2)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP CONSTRAINT "CHK_agent_runs_tier"`);
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "redacted"`);
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "tier"`);
    await queryRunner.query(`ALTER TABLE "agent_settings" DROP CONSTRAINT "CHK_agent_settings_tier2_scope"`);
    await queryRunner.query(`ALTER TABLE "agent_settings" DROP CONSTRAINT "CHK_agent_settings_provider_kind"`);
    for (const column of ['tier2Scope', 'providerCheckOk', 'providerCheckedAt', 'providerKeyEncrypted', 'providerModel', 'providerBaseUrl', 'providerKind']) {
      await queryRunner.query(`ALTER TABLE "agent_settings" DROP COLUMN "${column}"`);
    }
  }
}
