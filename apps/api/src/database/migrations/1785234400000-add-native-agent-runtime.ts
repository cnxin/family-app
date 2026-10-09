import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * J4.2 小管家自带的循环（NativeAgentRuntime）：运行方式多一个 'native'。'hermes' 保留到 J4.6 下线时再删。
 * 老家庭升级后 runtimeKind 不变。
 */
export class AddNativeAgentRuntime1785234400000 implements MigrationInterface {
  name = 'AddNativeAgentRuntime1785234400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['agent_settings', 'agent_runs']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "CHK_${table}_runtime_kind"`);
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "CHK_${table}_runtime_kind" CHECK ("runtimeKind" IN ('fake', 'hermes', 'native'))`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['agent_settings', 'agent_runs']) {
      await queryRunner.query(`UPDATE "${table}" SET "runtimeKind" = 'fake' WHERE "runtimeKind" = 'native'`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "CHK_${table}_runtime_kind"`);
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "CHK_${table}_runtime_kind" CHECK ("runtimeKind" IN ('fake', 'hermes'))`,
      );
    }
  }
}
