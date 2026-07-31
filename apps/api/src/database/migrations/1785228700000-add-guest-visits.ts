import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestVisits1785228700000 implements MigrationInterface {
  name = 'AddGuestVisits1785228700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "guests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "name" varchar(64) NOT NULL,
        "avatarEmoji" varchar(16) NOT NULL DEFAULT '👋',
        "note" varchar(240),
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_guests_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_guests_household_name" ON "guests" ("householdId", "name")`);

    await queryRunner.query(`
      CREATE TABLE "visits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "title" varchar(120) NOT NULL,
        "startsAt" timestamptz NOT NULL,
        "endsAt" timestamptz,
        "note" varchar(1000),
        "status" varchar NOT NULL DEFAULT 'scheduled',
        "hostMemberId" uuid NOT NULL,
        "createdById" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_visits" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_visits_status" CHECK ("status" IN ('scheduled', 'cancelled', 'completed')),
        CONSTRAINT "FK_visits_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_visits_host_member" FOREIGN KEY ("hostMemberId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_visits_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_visits_household_start" ON "visits" ("householdId", "startsAt")`);

    await queryRunner.query(`
      CREATE TABLE "visit_guests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "visitId" uuid NOT NULL,
        "guestId" uuid NOT NULL,
        "isAttending" boolean,
        "respondedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_visit_guests" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_visit_guests_visit_guest" UNIQUE ("visitId", "guestId"),
        CONSTRAINT "FK_visit_guests_visit" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_visit_guests_guest" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_visit_guests_guest" ON "visit_guests" ("guestId")`);

    await queryRunner.query(`
      CREATE TABLE "guest_invitations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "visitId" uuid NOT NULL,
        "guestId" uuid NOT NULL,
        "tokenHash" varchar(64) NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz,
        "acceptedAt" timestamptz,
        "createdById" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guest_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_guest_invitations_visit" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guest_invitations_guest" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_guest_invitations_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_guest_invitations_token_hash" ON "guest_invitations" ("tokenHash")`);
    await queryRunner.query(`CREATE INDEX "IDX_guest_invitations_visit_guest" ON "guest_invitations" ("visitId", "guestId")`);

    await queryRunner.query(`ALTER TABLE "household_activity_logs" DROP CONSTRAINT "CHK_household_activity_logs_module"`);
    await queryRunner.query(`ALTER TABLE "household_activity_logs" ADD CONSTRAINT "CHK_household_activity_logs_module" CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'system'))`);
    await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "CHK_notifications_module"`);
    await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "CHK_notifications_module" CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'guest', 'system'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "CHK_notifications_module"`);
    await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "CHK_notifications_module" CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'system'))`);
    await queryRunner.query(`ALTER TABLE "household_activity_logs" DROP CONSTRAINT IF EXISTS "CHK_household_activity_logs_module"`);
    await queryRunner.query(`ALTER TABLE "household_activity_logs" ADD CONSTRAINT "CHK_household_activity_logs_module" CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'system'))`);
    await queryRunner.query('DROP TABLE IF EXISTS "guest_invitations"');
    await queryRunner.query('DROP TABLE IF EXISTS "visit_guests"');
    await queryRunner.query('DROP TABLE IF EXISTS "visits"');
    await queryRunner.query('DROP TABLE IF EXISTS "guests"');
  }
}
