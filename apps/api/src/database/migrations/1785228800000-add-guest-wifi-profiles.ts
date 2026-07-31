import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestWifiProfiles1785228800000 implements MigrationInterface {
  name = 'AddGuestWifiProfiles1785228800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "guest_wifi_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "name" varchar(64) NOT NULL,
        "ssid" varchar(32) NOT NULL,
        "security" varchar(8) NOT NULL,
        "passwordEncrypted" text,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guest_wifi_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_guest_wifi_profiles_security" CHECK ("security" IN ('WPA', 'nopass')),
        CONSTRAINT "FK_guest_wifi_profiles_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_guest_wifi_profiles_household_active" ON "guest_wifi_profiles" ("householdId", "isActive")`);
    await queryRunner.query(`ALTER TABLE "visits" ADD "guestWifiProfileId" uuid`);
    await queryRunner.query(`ALTER TABLE "visits" ADD CONSTRAINT "FK_visits_guest_wifi_profile" FOREIGN KEY ("guestWifiProfileId") REFERENCES "guest_wifi_profiles"("id") ON DELETE SET NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "visits" DROP CONSTRAINT IF EXISTS "FK_visits_guest_wifi_profile"`);
    await queryRunner.query(`ALTER TABLE "visits" DROP COLUMN IF EXISTS "guestWifiProfileId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "guest_wifi_profiles"`);
  }
}
