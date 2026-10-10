import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { financeAttachmentName, type FinanceScreenshotRecognition } from '@family/contracts';
import { AgentVisionService } from '../agent/agent-vision.service';
import type { JwtUser } from '../auth/jwt.guard';
import { FinanceAccount, FinanceCategory, FinanceMerchantRule, FinanceTransaction } from '../entities';
import { UPLOAD_DIR } from '../upload/upload.module';
import {
  guessAccount,
  normalizeOccurredOn,
  parseScreenshotReply,
  screenshotTitle,
  sniffScreenshot,
  SCREENSHOT_SYSTEM_PROMPT,
  SCREENSHOT_UNRECOGNIZED,
  SCREENSHOT_USER_PROMPT,
} from './finance-screenshot.rules';
import { suggestCategory } from './import/merchant-rules';

/** 截图放 uploads/.private/finance/<家庭>/：/uploads 静态路由不给 .private，整个 uploads 目录本来就在备份里（同地图底图）。 */
export const FINANCE_UPLOAD_DIR = join(UPLOAD_DIR, '.private', 'finance');

const CONTENT_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** 记一笔带了截图文件名：必须是本家庭截图目录里真有的文件（文件名格式由契约限定，拼不出别的路径）。 */
export async function assertFinanceAttachment(householdId: string, name: string) {
  if (!financeAttachmentName.safeParse(name).success) throw new BadRequestException('截图文件名无效');
  try {
    const info = await stat(resolve(FINANCE_UPLOAD_DIR, householdId, name));
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    throw new BadRequestException('截图不存在，重新传一次');
  }
}

/**
 * K2 截图记账（docs/finance-plan.md §3-K2）：存截图 → 内核的云端看图（AgentVisionService，计入每日上限）识别 →
 * 按商户规则链猜分类、按付款方式猜账户 → 返回预填结果。不落流水：成员在表单里确认后才走「记一笔」。
 */
@Injectable()
export class FinanceScreenshotService {
  constructor(
    private readonly vision: AgentVisionService,
    private readonly dataSource: DataSource,
  ) {}

  async recognize(file: Express.Multer.File | undefined, user: JwtUser): Promise<FinanceScreenshotRecognition> {
    if (!file?.buffer?.length) throw new BadRequestException('没有收到截图');
    const image = sniffScreenshot(file.buffer);
    if (!image) throw new BadRequestException('只支持 JPG、PNG、WebP 截图');
    if (!(await this.vision.available(user))) {
      throw new ForbiddenException('截图识别要用云端模型：第 2 档对你开放、配的模型能看图并且测通过才行');
    }
    const name = `${randomUUID()}${image.ext}`;
    const directory = resolve(FINANCE_UPLOAD_DIR, user.householdId);
    const path = resolve(directory, name);
    await mkdir(directory, { recursive: true });
    await writeFile(path, file.buffer, { flag: 'wx' });
    try {
      const output = await this.vision.recognize(user, {
        title: '截图记账',
        image: { base64: file.buffer.toString('base64'), mime: image.mime },
        system: SCREENSHOT_SYSTEM_PROMPT,
        prompt: SCREENSHOT_USER_PROMPT,
        maxTokens: 300,
        parse: parseScreenshotReply,
        unrecognized: SCREENSHOT_UNRECOGNIZED,
      });
      const merchant = output.merchant?.trim() || null;
      const note = output.note?.trim() || null;
      return {
        amount: output.amount,
        direction: output.direction,
        merchant,
        occurredOn: normalizeOccurredOn(output.occurredAt),
        payMethod: output.payMethod?.trim() || null,
        note,
        title: screenshotTitle(merchant, note),
        categoryId: await this.suggestCategory(user.householdId, output.direction, merchant, note),
        accountId: await this.suggestAccount(user.householdId, output.payMethod ?? null),
        attachmentPath: name,
      };
    } catch (error) {
      // 没识别出来（422）、额度用完（429）、模型出错（502）：截图用不上，删掉
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  /** 分类按 K1 / K5 的商户规则链：家庭学到的规则 → 内置关键词 → 其他支出 / 其他收入。 */
  private async suggestCategory(householdId: string, kind: 'expense' | 'income', merchant: string | null, note: string | null) {
    const manager = this.dataSource.manager;
    const categories = await manager.getRepository(FinanceCategory).find({ where: { householdId, isActive: true } });
    const learned = await manager.getRepository(FinanceMerchantRule).find({ where: { householdId, kind } });
    const kindOf = new Map(categories.map((category) => [category.id, category.kind]));
    const suggestion = suggestCategory(
      { merchant: merchant ?? '', title: note ?? '', kind, platformCategory: null },
      learned,
      (id) => kindOf.get(id) ?? null,
      {},
    );
    if ('categoryId' in suggestion) return suggestion.categoryId;
    const bySystemKey = new Map(categories.filter((one) => one.systemKey).map((one) => [one.systemKey!, one.id]));
    return bySystemKey.get(suggestion.systemKey) ?? bySystemKey.get(kind === 'income' ? 'income_other' : 'expense_other') ?? null;
  }

  private async suggestAccount(householdId: string, payMethod: string | null) {
    const accounts = await this.dataSource.manager.getRepository(FinanceAccount).find({ where: { householdId } });
    return guessAccount(payMethod, accounts);
  }

  /** 流水的截图原图：只给本家庭、有截图的流水。 */
  async attachment(id: string, user: JwtUser) {
    const transaction = await this.dataSource.manager
      .getRepository(FinanceTransaction)
      .findOneBy({ id, householdId: user.householdId });
    const name = transaction?.attachmentPath;
    if (!name || !financeAttachmentName.safeParse(name).success) throw new NotFoundException('这笔账没有截图');
    try {
      const body = await readFile(resolve(FINANCE_UPLOAD_DIR, user.householdId, name));
      return { body, contentType: CONTENT_TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream' };
    } catch {
      throw new NotFoundException('截图文件不在了');
    }
  }
}
