import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestMovieVotes1785228900000 implements MigrationInterface {
  name = 'AddGuestMovieVotes1785228900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "guest_invitations" ADD "allowsMovieVoting" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`
      CREATE TABLE "guest_poll_votes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "invitationId" uuid NOT NULL,
        "pollId" uuid NOT NULL,
        "optionId" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guest_poll_votes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_guest_poll_votes_poll_invitation_option" UNIQUE ("pollId", "invitationId", "optionId"),
        CONSTRAINT "FK_guest_poll_votes_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guest_poll_votes_invitation" FOREIGN KEY ("invitationId") REFERENCES "guest_invitations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guest_poll_votes_poll" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guest_poll_votes_option" FOREIGN KEY ("optionId") REFERENCES "poll_options"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_guest_poll_votes_household_poll" ON "guest_poll_votes" ("householdId", "pollId")`);
    await queryRunner.query(`CREATE INDEX "IDX_guest_poll_votes_invitation_poll" ON "guest_poll_votes" ("invitationId", "pollId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "guest_poll_votes"`);
    await queryRunner.query(`ALTER TABLE "guest_invitations" DROP COLUMN IF EXISTS "allowsMovieVoting"`);
  }
}
