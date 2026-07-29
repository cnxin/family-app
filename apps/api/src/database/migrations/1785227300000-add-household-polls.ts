import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHouseholdPolls1785227300000 implements MigrationInterface {
  name = 'AddHouseholdPolls1785227300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "CHK_notifications_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "CHK_notifications_module"
      CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'system'))
    `);

    await queryRunner.query(`
      CREATE TABLE "polls" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "description" character varying(1000),
        "category" character varying NOT NULL DEFAULT 'general',
        "voteMode" character varying NOT NULL DEFAULT 'single',
        "maxChoices" integer NOT NULL DEFAULT 1,
        "closesAt" TIMESTAMP WITH TIME ZONE,
        "status" character varying NOT NULL DEFAULT 'open',
        "sourceModule" character varying(40),
        "sourceId" uuid,
        "isArchived" boolean NOT NULL DEFAULT false,
        "createdById" uuid NOT NULL,
        "closedById" uuid,
        "closedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_polls" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_polls_category"
          CHECK ("category" IN ('general', 'meal', 'activity', 'movie', 'shopping')),
        CONSTRAINT "CHK_polls_vote_mode"
          CHECK ("voteMode" IN ('single', 'multiple')),
        CONSTRAINT "CHK_polls_status"
          CHECK ("status" IN ('open', 'closed')),
        CONSTRAINT "CHK_polls_max_choices"
          CHECK (("voteMode" = 'single' AND "maxChoices" = 1)
            OR ("voteMode" = 'multiple' AND "maxChoices" >= 1 AND "maxChoices" <= 12)),
        CONSTRAINT "CHK_polls_source_pair"
          CHECK (("sourceModule" IS NULL AND "sourceId" IS NULL)
            OR ("sourceModule" IS NOT NULL AND "sourceId" IS NOT NULL)),
        CONSTRAINT "FK_polls_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_polls_created_by" FOREIGN KEY ("createdById")
          REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_polls_closed_by" FOREIGN KEY ("closedById")
          REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_polls_household_active"
      ON "polls" ("householdId", "isArchived", "status", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "poll_options" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "pollId" uuid NOT NULL,
        "label" character varying(120) NOT NULL,
        "description" character varying(500),
        "sortOrder" integer NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_poll_options" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_poll_options_poll_order" UNIQUE ("pollId", "sortOrder"),
        CONSTRAINT "FK_poll_options_poll" FOREIGN KEY ("pollId")
          REFERENCES "polls"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_poll_options_poll" ON "poll_options" ("pollId")
    `);

    await queryRunner.query(`
      CREATE TABLE "poll_votes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "pollId" uuid NOT NULL,
        "optionId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_poll_votes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_poll_votes_poll_option_member"
          UNIQUE ("pollId", "optionId", "memberId"),
        CONSTRAINT "FK_poll_votes_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_poll_votes_poll" FOREIGN KEY ("pollId")
          REFERENCES "polls"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_poll_votes_option" FOREIGN KEY ("optionId")
          REFERENCES "poll_options"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_poll_votes_member" FOREIGN KEY ("memberId")
          REFERENCES "members"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_poll_votes_household_poll"
      ON "poll_votes" ("householdId", "pollId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_poll_votes_member_poll"
      ON "poll_votes" ("memberId", "pollId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "poll_votes"');
    await queryRunner.query('DROP TABLE IF EXISTS "poll_options"');
    await queryRunner.query('DROP TABLE IF EXISTS "polls"');
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "CHK_notifications_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "CHK_notifications_module"
      CHECK ("module" IN ('menu', 'task', 'calendar', 'system'))
    `);
  }
}
