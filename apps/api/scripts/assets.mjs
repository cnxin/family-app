import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

async function rawRequest(path, token) {
  return fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function uploadDocument(path, token, fields, body, mimeType) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', new Blob([body], { type: mimeType }), 'document.png');
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
const cleanupFiles = [];

await db.connect();

try {
  const login = await request('/auth/login', null, 'POST', {
    loginName: '爸爸',
    password: PASSWORD,
  });
  assert(login.status === 201, '资产测试账号可以登录');
  const token = login.data.accessToken;
  const member = login.data.member;

  console.log('1. 资产、资料与家庭隔离');
  const asset = await request('/assets', token, 'POST', {
    name: '客厅空气净化器',
    category: 'appliance',
    location: '客厅',
    brand: '测试品牌',
    model: 'AP-01',
    serialNumber: 'ASSET-REGRESSION-01',
    purchaseDate: '2025-01-01',
    purchasePrice: 1299.5,
    warrantyExpiresOn: '2027-01-01',
    note: 'M6 资产回归数据',
  });
  assert(
    asset.status === 201 &&
      asset.data.name === '客厅空气净化器' &&
      asset.data.documents.length === 0 &&
      asset.data.maintenancePlans.length === 0,
    '可以创建包含购买与保修信息的家庭资产',
  );

  const invalidWarranty = await request('/assets', token, 'POST', {
    name: '错误保修日期',
    category: 'other',
    purchaseDate: '2026-01-02',
    warrantyExpiresOn: '2026-01-01',
  });
  assert(invalidWarranty.status === 400, '保修到期日不能早于购买日期');

  const unsafeDocument = await request(
    `/assets/${asset.data.id}/documents`,
    token,
    'POST',
    { type: 'manual', title: '不安全链接', url: 'javascript:alert(1)' },
  );
  const legacyLocalDocument = await request(
    `/assets/${asset.data.id}/documents`,
    token,
    'POST',
    { type: 'receipt', title: '旧公开路径', url: '/uploads/receipt.jpg' },
  );
  const document = await request(
    `/assets/${asset.data.id}/documents`,
    token,
    'POST',
    {
      type: 'manual',
      title: '厂商说明书',
      url: 'https://example.com/manual.pdf',
    },
  );
  assert(
    unsafeDocument.status === 400 &&
      legacyLocalDocument.status === 400 &&
      document.status === 201 &&
      document.data.type === 'manual',
    '资产资料链接只接受 HTTP(S)，本地路径必须走安全上传',
  );

  const privateBody = 'private-asset-document-regression';
  const uploadedDocument = await uploadDocument(
    `/assets/${asset.data.id}/documents/upload`,
    token,
    { type: 'receipt', title: '安全上传凭证' },
    privateBody,
    'image/png',
  );
  const unauthenticatedAccess = await request(
    `/asset-documents/${uploadedDocument.data.id}/access`,
    null,
  );
  const uploadedAccess = await request(
    `/asset-documents/${uploadedDocument.data.id}/access`,
    token,
  );
  const externalAccess = await request(
    `/asset-documents/${document.data.id}/access`,
    token,
  );
  const signedContent = await rawRequest(uploadedAccess.data.url, null);
  const signedBody = await signedContent.text();
  const tamperedUrl = new URL(uploadedAccess.data.url, BASE);
  const signature = tamperedUrl.searchParams.get('signature');
  tamperedUrl.searchParams.set(
    'signature',
    `${signature?.slice(0, -1)}${signature?.endsWith('A') ? 'B' : 'A'}`,
  );
  const tamperedContent = await fetch(tamperedUrl);
  const storedUpload = await db.query(
    `SELECT url FROM asset_documents WHERE id = $1`,
    [uploadedDocument.data.id],
  );
  const storedKey = storedUpload.rows[0].url;
  const privateFileName = storedKey.replace('asset-file://', '');
  const directPrivateAccess = await rawRequest(
    `/uploads/.private/assets/${member.householdId}/${privateFileName}`,
    null,
  );
  assert(
    uploadedDocument.status === 201 &&
      uploadedDocument.data.url === null &&
      storedKey.startsWith('asset-file://') &&
      unauthenticatedAccess.status === 401 &&
      uploadedAccess.status === 200 &&
      uploadedAccess.data.external === false &&
      signedContent.status === 200 &&
      signedContent.headers.get('content-type') === 'image/png' &&
      signedBody === privateBody &&
      tamperedContent.status === 403 &&
      directPrivateAccess.status !== 200 &&
      externalAccess.data.url === 'https://example.com/manual.pdf' &&
      externalAccess.data.external === true,
    '上传资料使用私有存储和短时签名，外链保持直接访问',
  );

  const legacyDocumentId = randomUUID();
  const legacyFileName = `legacy-asset-${randomUUID()}.png`;
  const legacyPath = resolve(process.cwd(), 'uploads', legacyFileName);
  await mkdir(resolve(process.cwd(), 'uploads'), { recursive: true });
  await writeFile(legacyPath, 'legacy-private-asset-document');
  cleanupFiles.push(legacyPath);
  await db.query(
    `INSERT INTO asset_documents
       (id, "householdId", "assetId", type, title, url, "createdById")
     VALUES ($1, $2, $3, 'warranty', '旧版保修资料', $4, $5)`,
    [
      legacyDocumentId,
      member.householdId,
      asset.data.id,
      `/uploads/${legacyFileName}`,
      member.id,
    ],
  );
  const directLegacyAccess = await rawRequest(
    `/uploads/${legacyFileName}`,
    null,
  );
  const legacyAccess = await request(
    `/asset-documents/${legacyDocumentId}/access`,
    token,
  );
  const legacySignedContent = await rawRequest(legacyAccess.data.url, null);
  const legacyBody = await legacySignedContent.text();
  const detailWithProtectedDocuments = await request(
    `/assets/${asset.data.id}`,
    token,
  );
  assert(
    directLegacyAccess.status === 404 &&
      legacyAccess.status === 200 &&
      legacySignedContent.status === 200 &&
      legacyBody === 'legacy-private-asset-document' &&
      detailWithProtectedDocuments.data.documents
        .filter((item) =>
          [uploadedDocument.data.id, legacyDocumentId].includes(item.id),
        )
        .every((item) => item.url === null),
    '旧版本地资产资料也会退出静态服务并隐藏底层路径',
  );

  const foreignHouseholdId = randomUUID();
  const foreignAssetId = randomUUID();
  const foreignDocumentId = randomUUID();
  await db.query(
    `INSERT INTO households (id, name, slug) VALUES ($1, '资产隔离测试家庭', $2)`,
    [foreignHouseholdId, `asset-isolation-${foreignHouseholdId}`],
  );
  await db.query(
    `INSERT INTO home_assets
       (id, "householdId", name, category, status, "createdById")
     VALUES ($1, $2, '其他家庭资产', 'other', 'active', $3)`,
    [foreignAssetId, foreignHouseholdId, member.id],
  );
  await db.query(
    `INSERT INTO asset_documents
       (id, "householdId", "assetId", type, title, url, "createdById")
     VALUES ($1, $2, $3, 'other', '其他家庭资料', 'https://example.com/foreign', $4)`,
    [foreignDocumentId, foreignHouseholdId, foreignAssetId, member.id],
  );
  const activeAssets = await request('/assets?status=active', token);
  const foreignGet = await request(`/assets/${foreignAssetId}`, token);
  const foreignPlan = await request(
    `/assets/${foreignAssetId}/maintenance-plans`,
    token,
    'POST',
    { title: '不应创建', frequencyDays: 30, nextDueDate: dateOnly(new Date()) },
  );
  const foreignDocumentAccess = await request(
    `/asset-documents/${foreignDocumentId}/access`,
    token,
  );
  assert(
    activeAssets.status === 200 &&
      activeAssets.data.some((item) => item.id === asset.data.id) &&
      !activeAssets.data.some((item) => item.id === foreignAssetId) &&
      foreignGet.status === 404 &&
      foreignPlan.status === 404 &&
      foreignDocumentAccess.status === 404,
    '资产列表、详情、维护写入和资料访问均隔离其他家庭',
  );

  console.log('2. 维护计划、提醒与并发幂等');
  const performedAt = new Date(Date.now() - 60_000);
  const performedDate = dateOnly(performedAt);
  const dueDate = performedDate;
  const plan = await request(
    `/assets/${asset.data.id}/maintenance-plans`,
    token,
    'POST',
    {
      title: '更换滤芯',
      frequencyDays: 30,
      nextDueDate: dueDate,
      note: '每 30 天检查一次',
    },
  );
  const duplicatePlan = await request(
    `/assets/${asset.data.id}/maintenance-plans`,
    token,
    'POST',
    { title: '更换滤芯', frequencyDays: 60, nextDueDate: dueDate },
  );
  assert(
    plan.status === 201 && duplicatePlan.status === 409,
    '维护计划创建成功且同一资产拒绝同名计划',
  );

  const sources = await request(
    `/reminder-sources?start=${dueDate}&end=${dueDate}`,
    token,
  );
  const maintenanceSource = sources.data.find(
    (source) => source.module === 'maintenance' && source.sourceId === plan.data.id,
  );
  assert(
    sources.status === 200 &&
      maintenanceSource?.targetPath === `/assets?assetId=${asset.data.id}&planId=${plan.data.id}`,
    '启用中的维护计划进入统一提醒来源并指向资产详情',
  );

  const reminder = await request('/reminders', token, 'POST', {
    sourceModule: 'maintenance',
    sourceId: plan.data.id,
    remindAt: new Date(Date.now() + 60_000).toISOString(),
    recipientIds: [member.id],
  });
  assert(reminder.status === 201, '维护计划可以创建家庭提醒');

  const key = `assets-regression-${randomUUID()}`;
  const completions = await Promise.all([
    request(`/maintenance-plans/${plan.data.id}/complete`, token, 'POST', {
      performedAt: performedAt.toISOString(),
      cost: 88.5,
      note: '已更换滤芯',
      idempotencyKey: key,
    }),
    request(`/maintenance-plans/${plan.data.id}/complete`, token, 'POST', {
      performedAt: performedAt.toISOString(),
      cost: 88.5,
      note: '已更换滤芯',
      idempotencyKey: key,
    }),
  ]);
  const recordIds = completions.map((response) => response.data.record.id);
  assert(
    completions.every((response) => response.status === 201) &&
      new Set(recordIds).size === 1 &&
      completions.filter((response) => response.data.alreadyCompleted).length === 1 &&
      completions[0].data.plan.nextDueDate === addUtcDays(performedDate, 30),
    '并发完成维护只追加一条记录并从实际执行日推进周期',
  );

  const reminderAfterCompletion = await request('/reminders?status=all', token);
  const cancelledReminder = reminderAfterCompletion.data.find(
    (item) => item.id === reminder.data.id,
  );
  assert(
    cancelledReminder?.status === 'cancelled' &&
      cancelledReminder.cancelReason === 'source_rescheduled',
    '维护完成后旧周期提醒自动取消且保留取消原因',
  );

  const secondPlan = await request(
    `/assets/${asset.data.id}/maintenance-plans`,
    token,
    'POST',
    { title: '清洁进风口', frequencyDays: 14, nextDueDate: performedDate },
  );
  const reusedKey = await request(
    `/maintenance-plans/${secondPlan.data.id}/complete`,
    token,
    'POST',
    { performedAt: performedAt.toISOString(), idempotencyKey: key },
  );
  assert(reusedKey.status === 409, '同一家庭的幂等键不能用于不同维护计划');

  console.log('3. 历史不可变、停用与资料清理');
  let updateRejected = false;
  let deleteRejected = false;
  try {
    await db.query(
      `UPDATE maintenance_records SET note = '不应修改' WHERE id = $1`,
      [recordIds[0]],
    );
  } catch (error) {
    updateRejected = error.code === '55000';
  }
  try {
    await db.query(`DELETE FROM maintenance_records WHERE id = $1`, [recordIds[0]]);
  } catch (error) {
    deleteRejected = error.code === '55000';
  }
  assert(updateRejected && deleteRejected, '数据库拒绝更新或删除维护历史');

  const disabled = await request(
    `/maintenance-plans/${secondPlan.data.id}`,
    token,
    'PATCH',
    { isEnabled: false },
  );
  const disabledCompletion = await request(
    `/maintenance-plans/${secondPlan.data.id}/complete`,
    token,
    'POST',
    { idempotencyKey: `disabled-${randomUUID()}` },
  );
  const retired = await request(`/assets/${asset.data.id}`, token, 'PATCH', {
    status: 'retired',
  });
  const activeAfterRetire = await request('/assets?status=active', token);
  const allAfterRetire = await request('/assets?status=all', token);
  assert(
    disabled.status === 200 &&
      disabled.data.isEnabled === false &&
      disabledCompletion.status === 409 &&
      retired.status === 200 &&
      !activeAfterRetire.data.some((item) => item.id === asset.data.id) &&
      allAfterRetire.data.some((item) => item.id === asset.data.id),
    '停用计划不能完成，归档资产保留历史但退出在用列表',
  );

  const removedDocument = await request(
    `/asset-documents/${document.data.id}`,
    token,
    'DELETE',
  );
  const duplicateRemoval = await request(
    `/asset-documents/${document.data.id}`,
    token,
    'DELETE',
  );
  assert(
    removedDocument.status === 200 && duplicateRemoval.status === 404,
    '资产资料可明确删除且重复删除返回不存在',
  );

  const removedUpload = await request(
    `/asset-documents/${uploadedDocument.data.id}`,
    token,
    'DELETE',
  );
  const contentAfterRemoval = await rawRequest(uploadedAccess.data.url, null);
  const removedLegacyDocument = await request(
    `/asset-documents/${legacyDocumentId}`,
    token,
    'DELETE',
  );
  assert(
    removedUpload.status === 200 &&
      removedLegacyDocument.status === 200 &&
      contentAfterRemoval.status === 404,
    '删除私有资料后旧签名立即失效且文件不再可读',
  );

  const detail = await request(`/assets/${asset.data.id}`, token);
  assert(
    detail.status === 200 &&
      detail.data.maintenanceRecords.length === 1 &&
      detail.data.maintenanceRecords[0].performedById === member.id &&
      detail.data.maintenanceRecords[0].nextDueDateBefore === dueDate,
    '资产详情持续返回操作者、执行时间与周期前后快照',
  );

  const activities = await request('/activities?limit=100', token);
  const assetActivities = activities.data.filter(
    (item) => item.module === 'asset' && item.metadata.assetId === asset.data.id,
  );
  const actions = assetActivities.map((item) => item.action);
  assert(
    activities.status === 200 &&
      actions.includes('asset_created') &&
      actions.includes('asset_document_added') &&
      actions.includes('asset_document_removed') &&
      actions.includes('maintenance_plan_created') &&
      actions.includes('maintenance_plan_disabled') &&
      actions.includes('asset_retired') &&
      actions.filter((action) => action === 'maintenance_completed').length ===
        1 &&
      assetActivities.every(
        (item) =>
          item.actor.id === member.id && item.targetPath?.startsWith('/assets'),
      ),
    '资产、资料与维护操作写入可追溯活动且幂等完成只记录一次',
  );

  console.log('\n家庭资产与维护回归测试全部通过');
} finally {
  await Promise.all(cleanupFiles.map((path) => unlink(path).catch(() => undefined)));
  await db.end();
}
