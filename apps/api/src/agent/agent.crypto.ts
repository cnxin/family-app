import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { agentDataKey } from '../common/config';

function additionalData(householdId: string, conversationId: string) {
  return Buffer.from(`agent:${householdId}:${conversationId}`, 'utf8');
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
