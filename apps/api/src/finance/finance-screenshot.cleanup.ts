import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { FINANCE_UPLOAD_DIR } from './finance-screenshot.service';
import { orphanScreenshots, ORPHAN_SCREENSHOT_BATCH } from './finance-screenshot.rules';

const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;

/**
 * 孤儿截图清理（K2 收尾）：识别成功却没点确认的截图留在 uploads/.private/finance/<家庭>/。文件是财务的，清理归财务插件，
 * 不进内核的 agent-retention。启动 5 分钟后首跑，之后每小时一次：修改时间早于 24 小时、没有流水引用的删掉，
 * 每轮最多 200 个；删不掉只记一行 warn。测试环境（NODE_ENV=test）不启动，免得黑盒跑着跑着文件没了。
 */
@Injectable()
export class FinanceScreenshotCleanup implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('FinanceScreenshot');
  private firstRun: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.firstRun = setTimeout(() => {
      this.firstRun = null;
      void this.cleanup();
      this.timer = setInterval(() => void this.cleanup(), INTERVAL_MS);
      this.timer.unref();
    }, FIRST_RUN_DELAY_MS);
    this.firstRun.unref();
  }

  onModuleDestroy() {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
    this.firstRun = null;
    this.timer = null;
  }

  /** 跑一轮；返回删掉的个数。 */
  async cleanup(now = Date.now()) {
    if (this.running) return 0;
    this.running = true;
    let scanned = 0;
    let removed = 0;
    try {
      const households = await readdir(FINANCE_UPLOAD_DIR, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const household of households) {
        if (!household.isDirectory() || removed >= ORPHAN_SCREENSHOT_BATCH) continue;
        const directory = join(FINANCE_UPLOAD_DIR, household.name);
        const files: { name: string; mtimeMs: number }[] = [];
        for (const name of await readdir(directory)) {
          const info = await stat(join(directory, name)).catch(() => null);
          if (info?.isFile()) files.push({ name, mtimeMs: info.mtimeMs });
        }
        scanned += files.length;
        const rows: { attachmentPath: string }[] = await this.dataSource.query(
          `SELECT DISTINCT "attachmentPath" FROM finance_transactions WHERE "householdId"::text = $1 AND "attachmentPath" IS NOT NULL`,
          [household.name],
        );
        const referenced = new Set(rows.map((row) => row.attachmentPath));
        for (const name of orphanScreenshots(files, referenced, now, ORPHAN_SCREENSHOT_BATCH - removed)) {
          try {
            await unlink(join(directory, name));
            removed += 1;
          } catch (error) {
            this.logger.warn(`finance_screenshot_cleanup_unlink_failed file=${name} ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      this.logger.log(`finance_screenshot_cleanup scanned=${scanned} removed=${removed}`);
    } catch (error) {
      this.logger.warn(`finance_screenshot_cleanup_failed ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
    return removed;
  }
}
