import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestMealRequests1785229000000 implements MigrationInterface {
  name = 'AddGuestMealRequests1785229000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "guest_invitations" ADD "allowsMealRequests" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`
      CREATE TABLE "guest_meal_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "visitId" uuid NOT NULL,
        "invitationId" uuid NOT NULL,
        "mealDate" date NOT NULL,
        "mealType" varchar NOT NULL,
        "dishName" varchar(120) NOT NULL,
        "note" varchar(300),
        "status" varchar NOT NULL DEFAULT 'pending',
        "reviewNote" varchar(200),
        "reviewedById" uuid,
        "reviewedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guest_meal_requests" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_guest_meal_requests_status" CHECK ("status" IN ('pending', 'accepted', 'rejected')),
        CONSTRAINT "UQ_guest_meal_requests_invitation_meal" UNIQUE ("invitationId", "mealDate", "mealType"),
        CONSTRAINT "FK_guest_meal_requests_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guest_meal_requests_visit" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guest_meal_requests_invitation" FOREIGN KEY ("invitationId") REFERENCES "guest_invitations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guest_meal_requests_reviewed_by" FOREIGN KEY ("reviewedById") REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_guest_meal_requests_household_visit" ON "guest_meal_requests" ("householdId", "visitId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "guest_meal_requests"`);
    await queryRunner.query(`ALTER TABLE "guest_invitations" DROP COLUMN IF EXISTS "allowsMealRequests"`);
  }
}
