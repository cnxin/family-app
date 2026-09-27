import assert from 'node:assert/strict';
import pg from 'pg';
import { createModuleHousehold } from './system-modules-fixtures.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

async function patch(token, body) {
  const response = await fetch(`${BASE}/households/me`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, data: json?.data, error: json?.error };
}

await db.connect();
try {
  const owner = await createModuleHousehold(db, 'owner');
  const member = await createModuleHousehold(db, 'member');

  const invalid = await patch(owner.token, { timezone: 'Not/AZone' });
  assert.equal(invalid.status, 400, invalid.error?.message ?? '非法时区应 400');

  const forbidden = await patch(member.token, { timezone: 'America/Los_Angeles' });
  assert.equal(forbidden.status, 403, forbidden.error?.message ?? '普通成员应 403');

  const updated = await patch(owner.token, { timezone: 'America/Los_Angeles' });
  assert.equal(updated.status, 200, updated.error?.message ?? '管理员应能改时区');
  assert.equal(updated.data.timezone, 'America/Los_Angeles');
  assert.equal(updated.data.id, owner.householdId);
  const stored = await db.query('SELECT timezone FROM households WHERE id = $1', [owner.householdId]);
  assert.equal(stored.rows[0].timezone, 'America/Los_Angeles');

  const memberStored = await db.query('SELECT timezone FROM households WHERE id = $1', [member.householdId]);
  assert.equal(memberStored.rows[0].timezone, 'Asia/Shanghai', '被拒绝的修改不能落库');
  console.log('家庭时区：非法 400、成员 403、管理员可改');
} finally {
  await db.end();
}
