import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * J4 第四批：小管家补 5 个只读工具（提醒、投票、积分、访客、智能家居）。
 * 默认启用；已有设置只在「原来就是全套默认只读工具」时补上（管理员手动关过工具的家庭不动），照 AddAgentLocationTools 的做法。
 * 新家庭由 AgentService.ensureSettings 按 contracts 的 AGENT_READ_TOOLS 建，自动带上。
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
  'find_item',
  'list_location_contents',
];
const ADDED = ['get_reminders', 'get_polls', 'get_points_summary', 'get_upcoming_visits', 'get_device_status'];
const json = (value: unknown) => JSON.stringify(value).replace(/'/g, "''");

export class AddAgentBatch4ReadTools1785234600000 implements MigrationInterface {
  name = 'AddAgentBatch4ReadTools1785234600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json([...PREVIOUS_READ_TOOLS, ...ADDED])}'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "readToolsEnabled" = "readToolsEnabled" || '${json(ADDED)}'::jsonb
      WHERE "readToolsEnabled" @> '${json(PREVIOUS_READ_TOOLS)}'::jsonb
        AND NOT ("readToolsEnabled" ?| ARRAY[${ADDED.map((tool) => `'${tool}'`).join(', ')}])
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "readToolsEnabled" = "readToolsEnabled" ${ADDED.map((tool) => `- '${tool}'`).join(' ')}
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json(PREVIOUS_READ_TOOLS)}'::jsonb
    `);
  }
}
