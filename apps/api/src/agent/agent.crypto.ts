import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { agentDataKey } from '../common/config';

function additionalData(householdId: string, conversationId: string) {
  return Buffer.from(`agent:${householdId}:${conversationId}`, 'utf8');
}

function memoryAdditionalData(
  householdId: string,
  ownerMemberId: string | null,
  memoryItemId: string,
) {
  return Buffer.from(
    `agent-memory:${householdId}:${ownerMemberId ?? 'household'}:${memoryItemId}`,
    'utf8',
  );
}

export function encryptAgentContent(
  content: string,
  householdId: string,
  conversationId: string,
) {
  const key = agentDataKey();
  if (!key) return null;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(additionalData(householdId, conversationId));
  const ciphertext = Buffer.concat([
    cipher.update(content, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    contentCiphertext: ciphertext.toString('base64'),
    contentNonce: nonce.toString('base64'),
    contentVersion: 1,
  };
}

export function decryptAgentContent(
  contentCiphertext: string,
  contentNonce: string,
  householdId: string,
  conversationId: string,
) {
  const key = agentDataKey();
  if (!key) return null;
  const payload = Buffer.from(contentCiphertext, 'base64');
  if (payload.length < 17) return null;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(contentNonce, 'base64'),
  );
  decipher.setAAD(additionalData(householdId, conversationId));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  return Buffer.concat([
    decipher.update(payload.subarray(0, payload.length - 16)),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptAgentMemoryContent(
  content: string,
  householdId: string,
  ownerMemberId: string | null,
  memoryItemId: string,
) {
  const key = agentDataKey();
  if (!key) return null;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(memoryAdditionalData(householdId, ownerMemberId, memoryItemId));
  const ciphertext = Buffer.concat([
    cipher.update(content, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    contentCiphertext: ciphertext.toString('base64'),
    contentNonce: nonce.toString('base64'),
    contentVersion: 1,
  };
}

export function decryptAgentMemoryContent(
  contentCiphertext: string,
  contentNonce: string,
  householdId: string,
  ownerMemberId: string | null,
  memoryItemId: string,
) {
  const key = agentDataKey();
  if (!key) return null;
  const payload = Buffer.from(contentCiphertext, 'base64');
  if (payload.length < 17) return null;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(contentNonce, 'base64'),
  );
  decipher.setAAD(memoryAdditionalData(householdId, ownerMemberId, memoryItemId));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  return Buffer.concat([
    decipher.update(payload.subarray(0, payload.length - 16)),
    decipher.final(),
  ]).toString('utf8');
}

function providerKeyAdditionalData(householdId: string) {
  return Buffer.from(`agent-provider-key:${householdId}`, 'utf8');
}

/**
 * 云端档服务商的 key（J4.3）：和对话内容同一把 AGENT_DATA_KEY、同样的 AES-256-GCM，附加数据绑定家庭；
 * 存成一列 `v1:<nonce>:<密文>`。没配 AGENT_DATA_KEY 时返回 null（调用方拒绝保存）。
 */
export function encryptProviderKey(key: string, householdId: string) {
  const dataKey = agentDataKey();
  if (!dataKey) return null;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
  cipher.setAAD(providerKeyAdditionalData(householdId));
  const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1:${nonce.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptProviderKey(stored: string, householdId: string) {
  const dataKey = agentDataKey();
  const [version, nonce, ciphertext] = stored.split(':');
  if (!dataKey || version !== 'v1' || !nonce || !ciphertext) return null;
  const payload = Buffer.from(ciphertext, 'base64');
  if (payload.length < 17) return null;
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(nonce, 'base64'));
  decipher.setAAD(providerKeyAdditionalData(householdId));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  return Buffer.concat([
    decipher.update(payload.subarray(0, payload.length - 16)),
    decipher.final(),
  ]).toString('utf8');
}
