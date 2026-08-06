import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentMemberProfiles1785231600000
  implements MigrationInterface
{
  name = 'AddAgentMemberProfiles1785231600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_member_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "assistantName" character varying(32) NOT NULL DEFAULT '小管家',
        "responseStyle" character varying(16) NOT NULL DEFAULT 'balanced',
        "memoryEnabled" boolean NOT NULL DEFAULT true,
        "memorySuggestionEnabled" boolean NOT NULL DEFAULT false,
        "proactiveRoutinesEnabled" boolean NOT NULL DEFAULT false,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_member_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_member_profiles_household_member" UNIQUE ("householdId", "memberId"),
        CONSTRAINT "CHK_agent_member_profiles_response_style" CHECK ("responseStyle" IN ('concise', 'balanced', 'detailed')),
        CONSTRAINT "CHK_agent_member_profiles_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_agent_member_profiles_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_member_profiles_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      INSERT INTO "agent_member_profiles" (
        "householdId", "memberId", "enabled"
      )
      SELECT member."householdId", member."id", member."disabledAt" IS NULL
      FROM "members" AS member
    `);

    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD "agentProfileId" uuid`,
    );
    await queryRunner.query(`
      UPDATE "agent_conversations" AS conversation
      SET "agentProfileId" = profile."id"
      FROM "agent_member_profiles" AS profile
      WHERE profile."householdId" = conversation."householdId"
        AND profile."memberId" = conversation."createdByMemberId"
    `);
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ALTER COLUMN "agentProfileId" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "agent_conversations"
      ADD CONSTRAINT "FK_agent_conversations_profile"
      FOREIGN KEY ("agentProfileId") REFERENCES "agent_member_profiles"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`ALTER TABLE "agent_runs" ADD "agentProfileId" uuid`);
    await queryRunner.query(`
      UPDATE "agent_runs" AS run
      SET "agentProfileId" = profile."id"
      FROM "agent_member_profiles" AS profile
      WHERE profile."householdId" = run."householdId"
        AND profile."memberId" = run."requestedByMemberId"
    `);
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ALTER COLUMN "agentProfileId" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "agent_runs"
      ADD CONSTRAINT "FK_agent_runs_profile"
      FOREIGN KEY ("agentProfileId") REFERENCES "agent_member_profiles"("id") ON DELETE RESTRICT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_runs" DROP CONSTRAINT "FK_agent_runs_profile"`,
    );
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "agentProfileId"`);
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP CONSTRAINT "FK_agent_conversations_profile"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP COLUMN "agentProfileId"`,
    );
    await queryRunner.query(`DROP TABLE "agent_member_profiles"`);
  }
}
