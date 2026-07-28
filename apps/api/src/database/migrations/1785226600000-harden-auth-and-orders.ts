import { MigrationInterface, QueryRunner } from 'typeorm';
import { hashPin } from '../../common/pin';

interface LegacyPinRow {
  id: string;
  pin: string;
}

export class HardenAuthAndOrders1785226600000 implements MigrationInterface {
  name = 'HardenAuthAndOrders1785226600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "members" ADD COLUMN "pinHash" character varying',
    );

    const members = (await queryRunner.query(
      'SELECT "id", "pin" FROM "members" WHERE "pin" IS NOT NULL',
    )) as LegacyPinRow[];
    for (const member of members) {
      await queryRunner.query(
        'UPDATE "members" SET "pinHash" = $1 WHERE "id" = $2',
        [await hashPin(member.pin), member.id],
      );
    }
    await queryRunner.query('ALTER TABLE "members" DROP COLUMN "pin"');

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_menu_items_active_order"
      ON "menu_items" ("menuId", "dishId", "requestedById")
      WHERE "status" <> 'rejected'
    `);
    await queryRunner.query(`
      ALTER TABLE "menu_items"
      ADD CONSTRAINT "CHK_menu_items_status"
      CHECK ("status" IN ('pending', 'accepted', 'cooking', 'done', 'rejected'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "CHK_menu_items_status"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_menu_items_active_order"',
    );
    await queryRunner.query(
      'ALTER TABLE "members" ADD COLUMN "pin" character varying',
    );
    await queryRunner.query('ALTER TABLE "members" DROP COLUMN "pinHash"');
  }
}
