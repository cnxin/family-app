import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I3 找东西：小管家只读工具 find_item / list_location_contents（item-location-plan §3 I3）。
 * 默认启用；已有设置只在「原来就是全套默认只读工具」时补上（管理员手动关过工具的家庭不动），照 AddFamilyFinance 的做法。
 */
const PREVIOUS_READ_TOOLS = [
  'get_today_summary',
  'get_calendar',
  'get_tasks',
  'get_shopping_list',
  'get_meal_plan',
  'get_inventory_alerts',
  'search_knowledge',
  'get_travel_checklist',
  'get_watch_candidates',
  'get_recent_memories',
  'get_member_tasks',
  'get_family_schedule',
  'get_inventory_summary',
  'search_recipes',
  'get_dish_plan',
  'get_weather',
  'get_member_profile',
  'get_finance_summary',
];
const ADDED = ['find_item', 'list_location_contents'];
const json = (value: unknown) => JSON.stringify(value).replace(/'/g, "''");

export class AddAgentLocationTools1785233400000 implements MigrationInterface {
  name = 'AddAgentLocationTools1785233400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json([...PREVIOUS_READ_TOOLS, ...ADDED])}'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "readToolsEnabled" = "readToolsEnabled" || '${json(ADDED)}'::jsonb
      WHERE "readToolsEnabled" @> '${json(PREVIOUS_READ_TOOLS)}'::jsonb
        AND NOT ("readToolsEnabled" ?| ARRAY['find_item', 'list_location_contents'])
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "readToolsEnabled" = "readToolsEnabled" - 'find_item' - 'list_location_contents'
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json(PREVIOUS_READ_TOOLS)}'::jsonb
    `);
  }
}
