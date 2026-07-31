import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkGuestMealRequestsToMenu1785229100000 implements MigrationInterface {
  name = 'LinkGuestMealRequestsToMenu1785229100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "guest_meal_requests" DROP CONSTRAINT "UQ_guest_meal_requests_invitation_meal"`);
    await queryRunner.query(`ALTER TABLE "guest_meal_requests" ADD "menuItemId" uuid`);
    await queryRunner.query(`ALTER TABLE "guest_meal_requests" ADD CONSTRAINT "FK_guest_meal_requests_menu_item" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE SET NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_guest_meal_requests_invitation_menu_item" ON "guest_meal_requests" ("invitationId", "menuItemId") WHERE "menuItemId" IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_guest_meal_requests_invitation_menu_item"`);
    await queryRunner.query(`ALTER TABLE "guest_meal_requests" DROP CONSTRAINT IF EXISTS "FK_guest_meal_requests_menu_item"`);
    await queryRunner.query(`ALTER TABLE "guest_meal_requests" DROP COLUMN IF EXISTS "menuItemId"`);
    await queryRunner.query(`ALTER TABLE "guest_meal_requests" ADD CONSTRAINT "UQ_guest_meal_requests_invitation_meal" UNIQUE ("invitationId", "mealDate", "mealType")`);
  }
}
