import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  process.execPath,
  [
    playwrightCli,
    'test',
    'e2e/agent-hermes-live.spec.ts',
    '--project=mobile-chrome',
    '--no-deps',
  ],
  {
    cwd: mobileRoot,
    env: { ...process.env, HERMES_LIVE_E2E: '1' },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
