import { MigrationInterface, QueryRunner } from 'typeorm';

/** H3 E2：智能家居控制审计。(householdId, requestId) 唯一，即幂等键：同一次点击重发只执行一次。 */
export class AddSmartHomeCommands1785232700000 implements MigrationInterface {
  name = 'AddSmartHomeCommands1785232700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "smart_home_commands" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "requestId" uuid NOT NULL,
        "entityId" character varying(255) NOT NULL,
        "action" character varying(32) NOT NULL,
        "service" character varying(80) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "message" character varying(300),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_smart_home_commands" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_smart_home_commands_household_request" UNIQUE ("householdId", "requestId"),
        CONSTRAINT "CHK_smart_home_commands_status" CHECK ("status" IN ('pending', 'succeeded', 'failed')),
        CONSTRAINT "FK_smart_home_commands_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_smart_home_commands_member"
          FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_smart_home_commands_household_created"
      ON "smart_home_commands" ("householdId", "createdAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "smart_home_commands"');
  }
}
