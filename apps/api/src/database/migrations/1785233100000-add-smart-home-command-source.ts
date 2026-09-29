import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * H3 E5：控制审计记来源——家里人手按的（manual）还是 E4 联动按的（link，带是哪条联动）。
 * 设置页「最近的操作」按来源筛；E3（HA → 小管家）不发控制命令，它的记录在 smart_home_events。
 * 回填：E4 执行时用运行记录的 id 当 requestId，所以历史上联动按的那几条对得上，其余都是手按的。
 */
export class AddSmartHomeCommandSource1785233100000 implements MigrationInterface {
  name = 'AddSmartHomeCommandSource1785233100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smart_home_commands"
        ADD "source" character varying(16) NOT NULL DEFAULT 'manual',
        ADD "linkId" uuid,
        ADD CONSTRAINT "CHK_smart_home_commands_source" CHECK ("source" IN ('manual', 'link')),
        ADD CONSTRAINT "FK_smart_home_commands_link"
          FOREIGN KEY ("linkId") REFERENCES "smart_home_links"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "smart_home_commands" c
         SET "source" = 'link', "linkId" = r."linkId"
        FROM "smart_home_link_runs" r
       WHERE r."id" = c."requestId" AND r."householdId" = c."householdId"
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_smart_home_commands_household_source_created" ON "smart_home_commands" ("householdId", "source", "createdAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_smart_home_commands_household_source_created"`);
    await queryRunner.query(`
      ALTER TABLE "smart_home_commands"
        DROP CONSTRAINT "FK_smart_home_commands_link",
        DROP CONSTRAINT "CHK_smart_home_commands_source",
        DROP COLUMN "linkId",
        DROP COLUMN "source"
    `);
  }
}
