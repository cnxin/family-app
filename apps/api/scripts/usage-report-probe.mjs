// 给黑盒脚本用：跑一次 usage-report.mjs（和 NAS 上同一份），把输出交回去断言。连接参数沿用当前进程的 DB_*。
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const SCRIPT = fileURLToPath(new URL('./usage-report.mjs', import.meta.url));

export async function usageReport(days = 1) {
  const { stdout } = await promisify(execFile)(process.execPath, [SCRIPT, '--days', String(days)], { env: process.env });
  return stdout;
}
