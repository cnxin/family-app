import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMembersAndActivity1785227500000 implements MigrationInterface {
  name = 'AddMembersAndActivity1785227500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "members"
      ADD COLUMN "disabledAt" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_members_household_status"
      ON "members" ("householdId", "disabledAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "household_activity_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "actorId" uuid,
        "actorName" character varying(64) NOT NULL,
        "subjectMemberId" uuid,
        "module" character varying(32) NOT NULL,
        "action" character varying(64) NOT NULL,
        "summary" character varying(180) NOT NULL,
        "detail" character varying(500),
        "targetPath" character varying(300),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_household_activity_logs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_household_activity_logs_module"
          CHECK ("module" IN (
            'member', 'invitation', 'menu', 'calendar', 'task', 'poll',
            'reminder', 'shopping', 'inventory', 'recipe', 'system'
          )),
        CONSTRAINT "FK_household_activity_logs_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_household_activity_logs_actor" FOREIGN KEY ("actorId")
          REFERENCES "members"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_household_activity_logs_subject" FOREIGN KEY ("subjectMemberId")
          REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_household_activity_logs_household_created"
      ON "household_activity_logs" ("householdId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_household_activity_logs_subject"
      ON "household_activity_logs" ("subjectMemberId", "createdAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "household_activity_logs"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_members_household_status"');
    await queryRunner.query('ALTER TABLE "members" DROP COLUMN "disabledAt"');
  }
}
