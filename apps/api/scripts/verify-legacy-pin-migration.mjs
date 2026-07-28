import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Client } = pg;
const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

await db.connect();
try {
  const result = await db.query(
    'SELECT id, "pinHash" FROM members WHERE name = $1',
    ['PIN 迁移测试成员'],
  );
  const member = result.rows[0];
  assert(member?.pinHash && member.pinHash !== '2468', '旧 PIN 不再以明文保存');
  assert(await bcrypt.compare('2468', member.pinHash), '旧 PIN 可用 bcrypt 校验');

  const oldColumn = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'members' AND column_name = 'pin'`,
  );
  assert(oldColumn.rowCount === 0, '旧 pin 列已移除');
  await db.query('DELETE FROM members WHERE id = $1', [member.id]);
} finally {
  await db.end();
}
