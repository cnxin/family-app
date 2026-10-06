import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Res,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Response } from 'express';
import { Brackets, Repository } from 'typeorm';
import {
  assistantUtteranceFilterQuery,
  assistantUtteranceListQuery,
  clearAssistantUtterancesQuery,
  createAssistantUtteranceBody,
  uuid,
  type AssistantUtterance,
  type AssistantUtteranceFilterQuery,
  type AssistantUtteranceListQuery,
  type AssistantUtterancePage,
  type CreateAssistantUtteranceBody,
} from '@family/contracts';
import { hasCapability, RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod';
import { AssistantUtteranceRecord, Member } from '../entities';

// 助理原话（J2，docs/architecture.md §2.3）。助理层不是插件：这些路由在 CORE_EVENT_ROUTE_EXEMPT 里，
// 不推事件、不进动态流水、不进通知；原话只存本地库，不出网。保留期见 agent-retention.service.ts。

type Row = AssistantUtteranceRecord & { memberName: string | null };

function present(row: Row): AssistantUtterance {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.memberName,
    text: row.text,
    source: row.source,
    tier: row.tier,
    intentId: row.intentId,
    confidence: row.confidence == null ? null : Number(row.confidence),
    outcome: row.outcome,
    chosenKind: row.chosenKind,
    chosenId: row.chosenId,
    correctedIntentId: row.correctedIntentId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 游标：上一页最后一条的创建时间 + id（倒序），base64url 包一层，只给前端原样带回。 */
function encodeCursor(row: AssistantUtteranceRecord) {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!createdAt || Number.isNaN(Date.parse(createdAt)) || !uuid.safeParse(id).success) return null;
  return { createdAt, id };
}

/** CSV 一格：有逗号、引号、换行就整格加引号；= + - @ 开头的前面垫一个单引号，防 Excel 当公式算。 */
function csvCell(value: string | number | null) {
  if (value == null) return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_COLUMNS = [
  'createdAt', 'memberName', 'text', 'source', 'outcome', 'chosenKind', 'chosenId',
  'tier', 'intentId', 'confidence', 'correctedIntentId', 'id', 'memberId',
] as const;

/** 一次导出最多这么多行；试用期一个家庭远到不了。 */
const EXPORT_LIMIT = 50_000;

@Injectable()
export class AssistantUtterancesService {
  constructor(
    @InjectRepository(AssistantUtteranceRecord)
    private readonly utterances: Repository<AssistantUtteranceRecord>,
  ) {}

  async create(body: CreateAssistantUtteranceBody, user: JwtUser): Promise<AssistantUtterance> {
    // 幂等：同一家、同一人、同一个 clientId 只落一条，重复提交返回第一次那条
    await this.utterances
      .createQueryBuilder()
      .insert()
      .values({
        householdId: user.householdId,
        memberId: user.memberId,
        clientId: body.clientId,
        text: body.text,
        source: body.source,
        outcome: body.outcome,
        chosenKind: body.chosenKind ?? null,
        chosenId: body.chosenId ?? null,
        tier: body.tier ?? null,
        intentId: body.intentId ?? null,
        confidence: body.confidence == null ? null : String(body.confidence),
        correctedIntentId: body.correctedIntentId ?? null,
        // 显式给到毫秒：库里默认 now() 是微秒，游标（毫秒）比较会漏掉同一毫秒内的行
        createdAt: new Date(),
      })
      .orIgnore()
      .execute();
    const [row] = await this.rows(user.householdId)
      .andWhere('utterance.memberId = :memberId AND utterance.clientId = :clientId', {
        memberId: user.memberId,
        clientId: body.clientId,
      })
      .getRawAndEntities()
      .then(withMemberName);
    return present(row);
  }

  async list(query: AssistantUtteranceListQuery, user: JwtUser): Promise<AssistantUtterancePage> {
    const builder = this.filtered(query, user);
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (cursor) {
        builder.andWhere(
          new Brackets((where) =>
            where
              .where('utterance.createdAt < :cursorAt', { cursorAt: cursor.createdAt })
              .orWhere('utterance.createdAt = :cursorAt AND utterance.id < :cursorId', { cursorId: cursor.id }),
          ),
        );
      }
    }
    const rows = withMemberName(await builder.limit(query.limit + 1).getRawAndEntities());
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(present),
      nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  async exportCsv(query: AssistantUtteranceFilterQuery, user: JwtUser) {
    const rows = withMemberName(await this.filtered(query, user).limit(EXPORT_LIMIT).getRawAndEntities());
    const lines = [
      CSV_COLUMNS.join(','),
      ...rows.map(present).map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(',')),
    ];
    // UTF-8 BOM：Excel 直接双击打开不乱码
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  async remove(id: string, user: JwtUser) {
    const row = await this.utterances.findOneBy({ id, householdId: user.householdId });
    if (!row) throw new NotFoundException('这条原话不存在');
    if (row.memberId !== user.memberId && !hasCapability(user, 'manage_agent')) {
      throw new ForbiddenException('只能删自己的原话');
    }
    await this.utterances.delete({ id, householdId: user.householdId });
    return { deleted: 1 };
  }

  async clearMine(user: JwtUser) {
    const result = await this.utterances.delete({ householdId: user.householdId, memberId: user.memberId });
    return { deleted: result.affected ?? 0 };
  }

  private rows(householdId: string) {
    return this.utterances
      .createQueryBuilder('utterance')
      .leftJoin(Member, 'member', 'member.id = utterance.memberId')
      .addSelect('member.name', 'memberName')
      .where('utterance.householdId = :householdId', { householdId })
      .orderBy('utterance.createdAt', 'DESC')
      .addOrderBy('utterance.id', 'DESC');
  }

  /** 成员（没有 manage_agent）只能看自己的：不传 memberId 就是自己，传别人 403。 */
  private filtered(query: AssistantUtteranceFilterQuery, user: JwtUser) {
    const manager = hasCapability(user, 'manage_agent');
    if (!manager && query.memberId && query.memberId !== user.memberId) {
      throw new ForbiddenException('只能看自己的原话');
    }
    const memberId = manager ? query.memberId : user.memberId;
    const builder = this.rows(user.householdId);
    if (memberId) builder.andWhere('utterance.memberId = :memberId', { memberId });
    if (query.source) builder.andWhere('utterance.source = :source', { source: query.source });
    if (query.outcome) builder.andWhere('utterance.outcome = :outcome', { outcome: query.outcome });
    if (query.from) builder.andWhere('utterance.createdAt >= :from', { from: query.from });
    if (query.to) builder.andWhere('utterance.createdAt < :to', { to: query.to });
    return builder;
  }
}

/** getRawAndEntities 的 raw 与 entities 按顺序一一对应，把成员名并进来。 */
function withMemberName({ entities, raw }: { entities: AssistantUtteranceRecord[]; raw: { memberName: string | null }[] }): Row[] {
  return entities.map((entity, index) => Object.assign(entity, { memberName: raw[index]?.memberName ?? null }));
}

@Controller('assistant/utterances')
export class AssistantUtterancesController {
  constructor(private readonly service: AssistantUtterancesService) {}

  @Post()
  create(@ZodBody(createAssistantUtteranceBody) body: CreateAssistantUtteranceBody, @CurrentUser() user: JwtUser) {
    return this.service.create(body, user);
  }

  @Get()
  list(@ZodQuery(assistantUtteranceListQuery) query: AssistantUtteranceListQuery, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Get('export.csv')
  @RequireCapabilities('manage_agent')
  async exportCsv(
    @ZodQuery(assistantUtteranceFilterQuery) query: AssistantUtteranceFilterQuery,
    @CurrentUser() user: JwtUser,
    @Res() response: Response,
  ) {
    const csv = await this.service.exportCsv(query, user);
    const stamp = new Date().toISOString().slice(0, 10);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="assistant-utterances-${stamp}.csv"`);
    response.setHeader('Cache-Control', 'no-store');
    response.send(csv);
  }

  @Delete(':id')
  remove(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user);
  }

  @Delete()
  clearMine(@ZodQuery(clearAssistantUtterancesQuery) _query: { memberId: 'me' }, @CurrentUser() user: JwtUser) {
    return this.service.clearMine(user);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([AssistantUtteranceRecord])],
  controllers: [AssistantUtterancesController],
  providers: [AssistantUtterancesService],
})
export class AssistantUtterancesModule {}
