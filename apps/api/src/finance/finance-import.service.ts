import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  CommitFinanceImportBody,
  CreateFinanceImportBody,
  FinanceImportColumnMapping,
} from '@family/contracts';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { assertCapability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import { FinanceAccount, FinanceImport } from '../entities';
import { buildPreviewRows, previewStats, type StoredPreview, type StoredPreviewRow } from './finance-import.preview';
import { learnMerchantRule } from './finance-merchant-rules';
import { FinanceService } from './finance.service';
import { IMPORT_MAX_BYTES, IMPORT_TOO_LARGE, STATEMENT_FORMATS } from './import/import-formats';
import {
  parseGenericRows,
  parseStatement,
  readGenericTable,
  StatementFormatError,
  validateGenericMapping,
  type ParsedStatement,
} from './import/import-parser';
import { normalizeMerchant } from './import/merchant-rules';

const PREVIEW_MINUTES = 30;
const SOURCE_LABELS = { alipay: '支付宝', wechat: '微信', csv: '通用 CSV' } as const;

/** multer 把非 ASCII 文件名按 latin1 交过来：能还原成 UTF-8 就还原。 */
function decodeFileName(raw: string) {
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return (decoded.includes('�') ? raw : decoded).slice(0, 255) || 'statement.csv';
}

function parseError(error: unknown): never {
  if (error instanceof StatementFormatError) throw new BadRequestException(error.message);
  throw error;
}

/**
 * K1 账单导入（docs/finance-plan.md §3-K1）：上传 → 预览（30 分钟）→ 确认才入库。导入算记账（record_finance，成员可用），
 * 只能导进本家庭在用的账户。原文件只在内存里解析；预览存 finance_imports.preview，确认 / 放弃后清空。
 */
@Injectable()
export class FinanceImportService {
  constructor(
    @InjectRepository(FinanceImport)
    private readonly imports: Repository<FinanceImport>,
    private readonly finance: FinanceService,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async upload(file: Express.Multer.File | undefined, body: CreateFinanceImportBody, user: JwtUser) {
    assertCapability(user, 'record_finance');
    if (!file) throw new BadRequestException('没有收到文件');
    if (file.size > IMPORT_MAX_BYTES) throw new PayloadTooLargeException(IMPORT_TOO_LARGE);
    const account = await this.requireAccount(this.dataSource.manager, body.accountId, user.householdId);
    const now = this.clock.now();
    // 顺手清掉本家庭过期没人管的预览（只清解析结果，批次记录留着，算放弃）
    await this.dataSource.query(
      `UPDATE finance_imports SET status = 'discarded', preview = NULL
        WHERE "householdId" = $1 AND status = 'previewing' AND "expiresAt" <= $2`,
      [user.householdId, now],
    );
    let preview: StoredPreview;
    let parsed: ParsedStatement | null = null;
    if (body.source === 'csv') {
      const table = (() => {
        try {
          return readGenericTable(file.buffer);
        } catch (error) {
          return parseError(error);
        }
      })();
      preview = { stage: 'mapping', headers: table.headers, rows: table.rows, firstLine: table.firstLine };
    } else {
      try {
        parsed = parseStatement(file.buffer, body.source);
      } catch (error) {
        parseError(error);
      }
      preview = await this.readyPreview(this.dataSource.manager, account, parsed!, body.source);
    }
    const saved = await this.imports.save(
      this.imports.create({
        householdId: user.householdId,
        source: body.source,
        fileName: decodeFileName(file.originalname),
        accountId: account.id,
        status: 'previewing',
        totalRows: preview.stage === 'ready' ? preview.rows.length : 0,
        rangeFrom: parsed?.rangeFrom ?? null,
        rangeTo: parsed?.rangeTo ?? null,
        columnMapping: null,
        preview,
        expiresAt: new Date(now.getTime() + PREVIEW_MINUTES * 60_000),
        createdById: user.memberId,
      }),
    );
    return this.view(saved.id, user.householdId);
  }

  async preview(id: string, user: JwtUser) {
    await this.load(this.dataSource.manager, id, user.householdId, { allowDone: true });
    return this.view(id, user.householdId);
  }

  async map(id: string, mapping: FinanceImportColumnMapping, user: JwtUser) {
    assertCapability(user, 'record_finance');
    await this.dataSource.transaction(async (manager) => {
      const record = await this.load(manager, id, user.householdId, { lock: true });
      const stored = record.preview as StoredPreview;
      if (record.source !== 'csv' || stored.stage !== 'mapping') throw new ConflictException('这次导入不需要选列');
      const table = { headers: stored.headers, rows: stored.rows, firstLine: stored.firstLine };
      const problem = validateGenericMapping(table.headers, mapping);
      if (problem) throw new BadRequestException(problem);
      const parsed = parseGenericRows(table, mapping);
      if (!parsed.rows.length) throw new BadRequestException('按这样选列，一行都读不出来：看看日期、金额选对了没有');
      const account = await this.requireAccount(manager, record.accountId, user.householdId);
      record.preview = await this.readyPreview(manager, account, parsed, 'csv');
      record.columnMapping = mapping;
      record.totalRows = parsed.rows.length;
      record.rangeFrom = parsed.rangeFrom;
      record.rangeTo = parsed.rangeTo;
      record.expiresAt = new Date(this.clock.now().getTime() + PREVIEW_MINUTES * 60_000);
      await manager.getRepository(FinanceImport).save(record);
    });
    return this.view(id, user.householdId);
  }

  /** 确认导入：一个事务里建流水；已导入过的行勾了也跳过；改过分类的商户记进 finance_merchant_rules。 */
  async commit(id: string, body: CommitFinanceImportBody, user: JwtUser) {
    assertCapability(user, 'record_finance');
    const result = await this.dataSource.transaction(async (manager) => {
      // 同一家庭的导入排队确认：单号去重靠唯一索引，并发确认会让整个事务失败
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${user.householdId}:finance-import`]);
      const record = await this.load(manager, id, user.householdId, { lock: true });
      const stored = record.preview as StoredPreview;
      if (stored.stage !== 'ready') throw new ConflictException('还没选列，先告诉我哪列是日期、金额');
      const account = await this.requireAccount(manager, record.accountId, user.householdId);
      const decisions = new Map(body.rows.map((row) => [row.rowNo, row]));
      for (const rowNo of decisions.keys()) {
        if (!stored.rows.some((row) => row.rowNo === rowNo)) throw new BadRequestException(`第 ${rowNo} 行不在这次预览里`);
      }
      const existing = new Set(
        (
          await manager.query(
            `SELECT "externalId" FROM finance_transactions
              WHERE "householdId" = $1 AND "sourceType" = 'import' AND "externalId" = ANY($2::text[])`,
            [user.householdId, stored.rows.map((row) => row.externalId).filter(Boolean)],
          )
        ).map((row: { externalId: string }) => row.externalId),
      );
      let imported = 0;
      let duplicates = 0;
      const learned: { pattern: string; kind: 'expense' | 'income'; categoryId: string }[] = [];
      for (const row of stored.rows) {
        const decision = decisions.get(row.rowNo);
        const included = decision ? decision.included : row.included;
        if (!row.selectable || (row.externalId && existing.has(row.externalId))) {
          duplicates += 1;
          continue;
        }
        if (!included) continue;
        const type = decision?.type ?? row.suggestedType;
        const categoryId = type === 'transfer' ? null : (decision?.categoryId !== undefined ? decision.categoryId : row.suggestedCategoryId);
        const toAccountId = type === 'transfer' ? (decision?.toAccountId ?? row.toAccountId) : null;
        if (type !== 'transfer' && !categoryId) throw new BadRequestException(`第 ${row.rowNo} 行没选分类`);
        if (type === 'transfer' && !toAccountId) throw new BadRequestException(`第 ${row.rowNo} 行记成转账要选转入账户`);
        // 流水名字用交易对方（「康安大药房-望京店」比「药品」好认），商品说明放备注
        const product = row.title && row.title !== '/' && row.title !== row.merchant ? row.title : null;
        const title = (row.merchant || product || SOURCE_LABELS[record.source]).slice(0, 120);
        await this.finance.insertWithinTransaction(
          {
            type,
            amount: row.amount,
            accountId: account.id,
            toAccountId,
            categoryId,
            title,
            note: row.merchant ? (product?.slice(0, 1000) ?? null) : null,
            occurredOn: row.occurredOn,
            idempotencyKey: `import:${record.id}:${row.externalId ?? `row-${row.rowNo}`}`.slice(0, 180),
          },
          user,
          manager,
          {
            sourceType: 'import',
            sourceId: record.id,
            externalId: row.externalId ? row.externalId.slice(0, 64) : null,
            merchant: row.merchant ? row.merchant.slice(0, 120) : null,
          },
        );
        if (row.externalId) existing.add(row.externalId);
        imported += 1;
        const pattern = normalizeMerchant(row.merchant).slice(0, 120);
        if (type !== 'transfer' && categoryId && categoryId !== row.suggestedCategoryId && pattern) {
          learned.push({ pattern, kind: type, categoryId });
        }
      }
      for (const rule of learned) await learnMerchantRule(manager, { householdId: user.householdId, ...rule });
      record.status = 'committed';
      record.importedRows = imported;
      record.duplicateRows = duplicates;
      record.skippedRows = stored.rows.length - imported - duplicates;
      record.committedAt = this.clock.now();
      record.processedExternalIds = [...new Set(stored.rows.map((row) => row.externalId).filter((value): value is string => Boolean(value)))];
      record.preview = null;
      await manager.getRepository(FinanceImport).save(record);
      await recordActivity(manager, user, {
        module: 'finance',
        action: 'finance_import_committed',
        summary: `${user.name}导入了${SOURCE_LABELS[record.source]}账单 ${imported} 笔`,
        detail: duplicates ? `另有 ${duplicates} 笔以前导入过，跳过` : null,
        targetPath: '/house/finance',
        metadata: { importId: record.id, accountId: account.id, imported, duplicates, skipped: record.skippedRows },
      });
      return { imported, skipped: record.skippedRows, duplicates };
    });
    const view = await this.view(id, user.householdId);
    const { headers: _headers, sampleRows: _sampleRows, stats: _stats, skipped: _skipped, rows: _rows, ...summary } = view;
    return { import: summary, ...result };
  }

  async discard(id: string, user: JwtUser) {
    assertCapability(user, 'record_finance');
    await this.dataSource.transaction(async (manager) => {
      const record = await this.load(manager, id, user.householdId, { lock: true, allowExpired: true });
      record.status = 'discarded';
      record.preview = null;
      await manager.getRepository(FinanceImport).save(record);
    });
    const { headers: _h, sampleRows: _s, stats: _st, skipped: _sk, rows: _r, ...summary } = await this.view(id, user.householdId);
    return summary;
  }

  async list(user: JwtUser) {
    const rows = await this.imports.find({
      where: { householdId: user.householdId, status: In(['committed', 'discarded']) },
      relations: { account: true, createdBy: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return rows.map((row) => this.summary(row));
  }

  private async readyPreview(manager: EntityManager, account: FinanceAccount, parsed: ParsedStatement, source: 'alipay' | 'wechat' | 'csv') {
    const rows = await buildPreviewRows(manager, {
      householdId: account.householdId,
      account,
      rows: parsed.rows,
      platformCategories: source === 'csv' ? {} : STATEMENT_FORMATS[source].platformCategories,
    });
    return { stage: 'ready' as const, rows, skipped: parsed.skipped };
  }

  private async requireAccount(manager: EntityManager, id: string, householdId: string) {
    const account = await manager.getRepository(FinanceAccount).findOneBy({ id, householdId, isActive: true });
    if (!account) throw new NotFoundException('财务账户不存在或已停用');
    return account;
  }

  /** 取一个批次；预览中且过期 → 410；已确认 / 放弃 → 409（只读时可以看）。 */
  private async load(
    manager: EntityManager,
    id: string,
    householdId: string,
    options: { lock?: boolean; allowDone?: boolean; allowExpired?: boolean } = {},
  ) {
    const query = manager
      .getRepository(FinanceImport)
      .createQueryBuilder('record')
      .where('record.id = :id AND record.householdId = :householdId', { id, householdId });
    if (options.lock) query.setLock('pessimistic_write');
    const record = await query.getOne();
    if (!record) throw new NotFoundException('这次导入不存在');
    if (record.status !== 'previewing') {
      if (options.allowDone) return record;
      throw new ConflictException(record.status === 'committed' ? '这次导入已经确认过了' : '这次导入已经放弃了');
    }
    if (!options.allowExpired && record.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new GoneException(`预览已经过期（${PREVIEW_MINUTES} 分钟），重新上传一次`);
    }
    return record;
  }

  private summary(row: FinanceImport) {
    const stored = row.preview as StoredPreview | null;
    return {
      id: row.id,
      householdId: row.householdId,
      source: row.source,
      fileName: row.fileName,
      accountId: row.accountId,
      account: { id: row.account.id, name: row.account.name, type: row.account.type },
      status: row.status,
      stage: row.status !== 'previewing' ? ('done' as const) : stored?.stage === 'mapping' ? ('mapping' as const) : ('ready' as const),
      totalRows: row.totalRows,
      importedRows: row.importedRows,
      skippedRows: row.skippedRows,
      duplicateRows: row.duplicateRows,
      rangeFrom: row.rangeFrom,
      rangeTo: row.rangeTo,
      columnMapping: (row.columnMapping as FinanceImportColumnMapping | null) ?? null,
      expiresAt: row.expiresAt,
      createdById: row.createdById,
      createdBy: { id: row.createdBy.id, name: row.createdBy.name },
      createdAt: row.createdAt,
      committedAt: row.committedAt,
    };
  }

  private async view(id: string, householdId: string) {
    const row = await this.imports.findOneOrFail({
      where: { id, householdId },
      relations: { account: true, createdBy: true },
    });
    const stored = row.preview as StoredPreview | null;
    const rows: StoredPreviewRow[] = stored?.stage === 'ready' ? stored.rows : [];
    return {
      ...this.summary(row),
      headers: stored?.stage === 'mapping' ? stored.headers : null,
      sampleRows: stored?.stage === 'mapping' ? stored.rows.slice(0, 5) : null,
      stats: previewStats(rows, stored?.stage === 'ready' ? stored.skipped.length : 0),
      skipped: stored?.stage === 'ready' ? stored.skipped : [],
      rows: rows.map(({ externalId: _externalId, ...rest }) => rest),
    };
  }
}
