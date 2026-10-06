import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * J2 助理三档的家庭级开关与配置（docs/architecture.md §2、§6；本笔只存，不连任何模型）。
 * 第 0 档规则引擎默认开、第 1 档本地模型默认关；第 2 档（云端）的开关就是现有的 enabled，不加新列、不改语义。
 * 都有默认值：老家庭升级后行为不变。captureUtterances 关掉后 ⌘K 不再记原话（assistant_utterances）。
 */
export class AddAssistantTiers1785233700000 implements MigrationInterface {
  name = 'AddAssistantTiers1785233700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "tier0Enabled" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "tier1Enabled" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "tier1BaseUrl" character varying(300)`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "tier1Model" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "tier2DailyLimit" integer NOT NULL DEFAULT '50'`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "tier2Redact" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "agent_settings" ADD "captureUtterances" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(
      `ALTER TABLE "agent_settings" ADD CONSTRAINT "CHK_agent_settings_tier2_daily_limit" CHECK ("tier2DailyLimit" BETWEEN 1 AND 1000)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_settings" DROP CONSTRAINT "CHK_agent_settings_tier2_daily_limit"`);
    for (const column of ['captureUtterances', 'tier2Redact', 'tier2DailyLimit', 'tier1Model', 'tier1BaseUrl', 'tier1Enabled', 'tier0Enabled']) {
      await queryRunner.query(`ALTER TABLE "agent_settings" DROP COLUMN "${column}"`);
    }
  }
}
