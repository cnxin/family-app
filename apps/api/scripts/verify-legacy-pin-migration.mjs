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
    `SELECT member.id, member."accountId", account."passwordHash"
     FROM members member
     JOIN accounts account ON account.id = member."accountId"
     WHERE member.name = $1`,
    ['PIN 迁移测试成员'],
  );
  const member = result.rows[0];
  assert(
    member?.passwordHash && member.passwordHash !== '2468',
    '旧 PIN 已迁入账号且不再以明文保存',
  );
  assert(
    await bcrypt.compare('2468', member.passwordHash),
    '迁移后的账号密码可用 bcrypt 校验',
  );

  const oldColumn = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'members' AND column_name = 'pin'`,
  );
  assert(oldColumn.rowCount === 0, '旧 pin 列已移除');
  const memberPinHashColumn = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'members'
       AND column_name = 'pinHash'`,
  );
  assert(memberPinHashColumn.rowCount === 0, '成员档案不再保存登录凭据');
  await db.query('DELETE FROM agent_member_profiles WHERE "memberId" = $1', [
    member.id,
  ]);
  await db.query('DELETE FROM members WHERE id = $1', [member.id]);
  await db.query('DELETE FROM accounts WHERE id = $1', [member.accountId]);
} finally {
  await db.end();
}
