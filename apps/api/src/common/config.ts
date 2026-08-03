import { readFileSync } from 'fs';
import { createHash } from 'crypto';

function readConfiguredSecret(
  name:
    | 'BOOTSTRAP_SECRET'
    | 'DB_PASSWORD'
    | 'JWT_SECRET'
    | 'INTEGRATION_SECRET_KEY',
  developmentFallback: string,
) {
  const fileVariable = `${name}_FILE`;
  const configuredFile = process.env[fileVariable]?.trim();
  if (configuredFile) {
    let value: string;
    try {
      value = readFileSync(configuredFile, 'utf8').trim();
    } catch {
      throw new Error(`无法读取 ${fileVariable} 指定的密钥文件`);
    }
    if (!value) throw new Error(`${fileVariable} 指定的密钥文件为空`);
    return value;
  }

  const configuredValue = process.env[name]?.trim();
  if (configuredValue) return configuredValue;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`生产环境必须配置 ${name}_FILE 或 ${name}`);
  }
  return developmentFallback;
}

function readOptionalSecret(name: string) {
  const configuredFile = process.env[`${name}_FILE`]?.trim();
  if (configuredFile) {
    try {
      const value = readFileSync(configuredFile, 'utf8').trim();
      if (!value) throw new Error('empty');
      return value;
    } catch {
      throw new Error(`无法读取 ${name}_FILE 指定的密钥文件`);
    }
  }
  return process.env[name]?.trim() || null;
}

function decodeDataKey(value: string, name: string) {
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(`${name} 必须是 32 字节的 Base64 或 64 位十六进制密钥`);
  }
  return key;
}

export function databasePassword() {
  return readConfiguredSecret('DB_PASSWORD', 'family123');
}

export function jwtSecret() {
  return readConfiguredSecret('JWT_SECRET', 'family-app-dev-secret');
}

export function bootstrapSecret() {
  return readConfiguredSecret(
    'BOOTSTRAP_SECRET',
    'family-app-local-bootstrap-secret',
  );
}

export function integrationSecretKey() {
  const configured = readConfiguredSecret('INTEGRATION_SECRET_KEY', '');
  if (!configured) {
    return createHash('sha256')
      .update('family-app-local-integration-secret', 'utf8')
      .digest();
  }

  const key = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'INTEGRATION_SECRET_KEY 必须是 32 字节的 Base64 或 64 位十六进制密钥',
    );
  }
  return key;
}

export function agentDataKey() {
  const configured = readOptionalSecret('AGENT_DATA_KEY');
  if (configured) return decodeDataKey(configured, 'AGENT_DATA_KEY');
  if (process.env.NODE_ENV === 'production') return null;
  return createHash('sha256')
    .update('family-app-local-agent-data-key', 'utf8')
    .digest();
}

export function agentMcpKey() {
  return (
    readOptionalSecret('AGENT_MCP_KEY') ??
    (process.env.NODE_ENV === 'production'
      ? null
      : 'family-app-local-agent-mcp-key')
  );
}

export function agentRuntimeKey() {
  return readOptionalSecret('AGENT_RUNTIME_KEY');
}

export function agentRuntimeUrl() {
  return (process.env.AGENT_RUNTIME_URL || 'http://hermes:8642').replace(/\/+$/, '');
}

export function trustProxyHops() {
  const rawValue = process.env.TRUST_PROXY_HOPS?.trim();
  if (!rawValue) return 0;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error('TRUST_PROXY_HOPS 必须是 0 到 10 之间的整数');
  }
  return value;
}

export function validateRuntimeConfiguration() {
  databasePassword();
  jwtSecret();
  bootstrapSecret();
  integrationSecretKey();
  agentDataKey();
  agentMcpKey();
  trustProxyHops();
  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.CORS_ORIGINS?.split(',').some((origin) => origin.trim())
  ) {
    throw new Error('生产环境必须明确配置 CORS_ORIGINS');
  }
}
