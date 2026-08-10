import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const profileHome = resolve(
  process.argv[2] || join(homedir(), '.hermes', 'profiles', 'familyapp'),
);
const secretsDir = join(projectRoot, 'deploy', 'secrets');
const configTemplatePath = join(projectRoot, 'deploy', 'hermes', 'config.local.yaml');

async function ensureSecret(name) {
  const path = join(secretsDir, `${name}.txt`);
  try {
    const current = (await readFile(path, 'utf8')).trim();
    if (current.length >= 32) return current;
    throw new Error(`${path} 已存在但内容无效，请先人工检查`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const value = randomBytes(32).toString('hex');
  await writeFile(path, `${value}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return value;
}

function updateEnv(source, values) {
  const lines = source ? source.split(/\r?\n/) : [];
  const pending = new Map(Object.entries(values));
  const updated = lines.flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !pending.has(match[1])) return line ? [line] : [];
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return [`${match[1]}=${value}`];
  });
  for (const [key, value] of pending) updated.push(`${key}=${value}`);
  return `${updated.join('\n')}\n`;
}

function readEnvValue(source, key) {
  const prefix = `${key}=`;
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  return line?.slice(prefix.length) || null;
}

await mkdir(secretsDir, { recursive: true, mode: 0o700 });
await chmod(secretsDir, 0o700);
const mcpKey = await ensureSecret('agent_mcp_key');
const runtimeKey = await ensureSecret('agent_runtime_key');

const configPath = join(profileHome, 'config.yaml');
try {
  await readFile(configPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  const configTemplate = await readFile(configTemplatePath, 'utf8');
  await writeFile(configPath, configTemplate, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}
await chmod(configPath, 0o600);

const envPath = join(profileHome, '.env');
const defaultEnvPath = join(homedir(), '.hermes', '.env');
let currentEnv = '';
let defaultEnv = '';
try {
  currentEnv = await readFile(envPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  await mkdir(dirname(envPath), { recursive: true, mode: 0o700 });
}
try {
  defaultEnv = await readFile(defaultEnvPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const profileValues = {
  AGENT_MCP_KEY: mcpKey,
  API_SERVER_ENABLED: 'true',
  API_SERVER_HOST: '127.0.0.1',
  API_SERVER_KEY: runtimeKey,
  API_SERVER_MODEL_NAME: 'hermes-agent',
  API_SERVER_PORT: '8642',
};
const providerKey = readEnvValue(defaultEnv, 'OPENCODE_ZEN_API_KEY');
if (providerKey) profileValues.OPENCODE_ZEN_API_KEY = providerKey;
const nextEnv = updateEnv(currentEnv, profileValues);
const temporaryPath = `${envPath}.tmp`;
await writeFile(temporaryPath, nextEnv, { encoding: 'utf8', mode: 0o600 });
await rename(temporaryPath, envPath);
await chmod(envPath, 0o600);

console.log('Family App Hermes 本地密钥已就绪（未输出密钥内容）。');
