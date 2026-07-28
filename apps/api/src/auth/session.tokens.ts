import { createHash, randomBytes } from 'node:crypto';

const DEFAULT_ACCESS_TOKEN_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

function positiveSeconds(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function accessTokenExpiresSeconds(): number {
  return positiveSeconds('JWT_EXPIRES_SECONDS', DEFAULT_ACCESS_TOKEN_SECONDS);
}

export function refreshTokenExpiresSeconds(): number {
  return positiveSeconds(
    'REFRESH_TOKEN_EXPIRES_SECONDS',
    DEFAULT_REFRESH_TOKEN_SECONDS,
  );
}

export function createRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function credentialSnapshot(pinHash: string | null): string {
  return createHash('sha256')
    .update(`family-app-credential:${pinHash ?? 'no-pin'}`, 'utf8')
    .digest('hex');
}

export function refreshTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + refreshTokenExpiresSeconds() * 1000);
}
