import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { integrationSecretKey } from './config';

const encryptionKey = integrationSecretKey();

export function integrationCredentialHint(value: string) {
  return `****${value.slice(-4)}`;
}

export function encryptIntegrationCredential(
  value: string,
  householdId: string,
  scope: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from(`${householdId}:${scope}`, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptIntegrationCredential(
  encryptedValue: string | null,
  householdId: string,
  scope: string,
  label: string,
) {
  if (!encryptedValue) return null;
  const [version, ivValue, tagValue, value] = encryptedValue.split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !value) {
    throw new Error(`${label}凭据密文格式无效`);
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(ivValue, 'base64'),
  );
  decipher.setAAD(Buffer.from(`${householdId}:${scope}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
