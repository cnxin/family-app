import { MigrationInterface, QueryRunner } from 'typeorm';

/** H3 E4：小管家 → HA 的联动规则与运行记录（(规则, 那一次发生) 唯一，即幂等键）。 */
export class AddSmartHomeLinks1785232900000 implements MigrationInterface {
  name = 'AddSmartHomeLinks1785232900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "smart_home_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "name" character varying(40) NOT NULL,
        "trigger" character varying(24) NOT NULL,
        "keyword" character varying(40) NOT NULL,
        "offsetMinutes" integer NOT NULL DEFAULT 0,
        "targetEntityId" character varying(255) NOT NULL,
        "action" character varying(32) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_home_links" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_smart_home_links_trigger" CHECK ("trigger" IN ('task_done', 'calendar_before')),
        CONSTRAINT "CHK_smart_home_links_offset" CHECK ("offsetMinutes" >= 0 AND "offsetMinutes" <= 720),
        CONSTRAINT "FK_smart_home_links_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_smart_home_links_created_by"
          FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_smart_home_links_household" ON "smart_home_links" ("householdId")`);
    await queryRunner.query(`
      CREATE TABLE "smart_home_link_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "linkId" uuid NOT NULL,
        "occurrenceKey" character varying(200) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "message" character varying(300),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_smart_home_link_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_smart_home_link_runs_link_occurrence" UNIQUE ("linkId", "occurrenceKey"),
        CONSTRAINT "CHK_smart_home_link_runs_status" CHECK ("status" IN ('pending', 'succeeded', 'failed')),
        CONSTRAINT "FK_smart_home_link_runs_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_smart_home_link_runs_link"
          FOREIGN KEY ("linkId") REFERENCES "smart_home_links"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_smart_home_link_runs_household_created" ON "smart_home_link_runs" ("householdId", "createdAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "smart_home_link_runs"');
    await queryRunner.query('DROP TABLE IF EXISTS "smart_home_links"');
  }
}
