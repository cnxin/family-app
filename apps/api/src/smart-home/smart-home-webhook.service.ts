import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { QueryFailedError, Repository } from 'typeorm';
import {
  DEFAULT_SMART_HOME_RULES,
  SMART_HOME_WEBHOOK_DEDUP_MINUTES,
  SMART_HOME_WEBHOOK_GRACE_HOURS,
  SMART_HOME_WEBHOOK_TOLERANCE_SECONDS,
  smartHomeRulesSchema,
  type SmartHomeRules,
  type SmartHomeWebhookBody,
  type SmartHomeWebhookEventRecord,
  type SmartHomeWebhookSecret,
  type SmartHomeWebhookSettings as SmartHomeWebhookSettingsView,
} from '@family/contracts';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import {
  decryptIntegrationCredential,
  encryptIntegrationCredential,
  integrationCredentialHint,
} from '../common/integration-credentials';
import { SmartHomeEventRecord, SmartHomeWebhookSettings } from '../entities';
import { EventBus } from '../events/event-bus';
import { SmartHomeLinkagesService } from './smart-home-linkages.service';
import { SmartHomeService } from './smart-home.service';

const SCOPE = 'webhook:home_assistant';
const SETTINGS_PATH = '/house/smart-home/settings';
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** 与设置页生成的 HA 模板一致：sha256(密钥 + sha256(密钥 + 时间戳 + "." + 原始请求体))。 */
export function smartHomeWebhookSignature(secret: string, timestamp: string, rawBody: string) {
  return sha256(secret + sha256(`${secret}${timestamp}.${rawBody}`));
}

function sameHex(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function isUniqueViolation(error: unknown) {
  return error instanceof QueryFailedError && (error.driverError as { code?: string } | undefined)?.code === '23505';
}

/**
 * E3：HA → 小管家。收到先验签（时间戳 5 分钟窗口、当前密钥或宽限期内的旧密钥），按 (家庭, 事件 id) 去重
 * 10 分钟，先发 /events 的 smart-home，再跑联动，联动写了哪些域就再发哪些域。
 */
@Injectable()
export class SmartHomeWebhookService {
  private readonly logger = new Logger('SmartHomeWebhook');

  constructor(
    @InjectRepository(SmartHomeWebhookSettings)
    private readonly settings: Repository<SmartHomeWebhookSettings>,
    @InjectRepository(SmartHomeEventRecord)
    private readonly events: Repository<SmartHomeEventRecord>,
    private readonly clock: Clock,
    private readonly bus: EventBus,
    private readonly linkages: SmartHomeLinkagesService,
    private readonly smartHome: SmartHomeService,
  ) {}

  async view(householdId: string): Promise<SmartHomeWebhookSettingsView> {
    const row = await this.settings.findOne({ where: { householdId } });
    return this.present(householdId, row);
  }

  async rotate(user: JwtUser): Promise<SmartHomeWebhookSecret> {
    const row = await this.loadWithSecrets(user.householdId);
    const now = this.clock.now();
    const secret = randomBytes(24).toString('base64url');
    const next = row ?? this.settings.create({ householdId: user.householdId, rules: { ...DEFAULT_SMART_HOME_RULES } });
    if (row?.secretEncrypted) {
      next.previousSecretEncrypted = row.secretEncrypted;
      next.previousValidUntil = new Date(now.getTime() + SMART_HOME_WEBHOOK_GRACE_HOURS * 3_600_000);
    }
    next.secretEncrypted = encryptIntegrationCredential(secret, user.householdId, SCOPE);
    next.secretHint = integrationCredentialHint(secret);
    next.rotatedAt = now;
    await this.settings.manager.transaction(async (manager) => {
      await manager.getRepository(SmartHomeWebhookSettings).save(next);
      await recordActivity(manager, user, {
        module: 'system',
        action: row?.secretEncrypted ? 'smart_home_webhook_rotated' : 'smart_home_webhook_created',
        summary: row?.secretEncrypted ? '轮换了 Home Assistant 回调密钥' : '生成了 Home Assistant 回调密钥',
        targetPath: SETTINGS_PATH,
      });
    });
    return { ...(await this.view(user.householdId)), secret };
  }

  async updateRules(rules: SmartHomeRules, user: JwtUser) {
    // 触发实体按「设备 + 它的某个子实体」引用（redesign §4.2）：设备得在这家的白名单里，实体得是它名下的
    const refs = [rules.laundry.washer, rules.laundry.dryer, rules.vacuum.trigger, rules.filter.trigger];
    for (const ref of refs) {
      if (!ref) continue;
      const device = await this.smartHome.find(user.householdId, ref.deviceId);
      if (!device) throw new BadRequestException('触发设备不在白名单里');
      if (!(await this.smartHome.entitiesOf(device)).has(ref.entityId)) {
        throw new BadRequestException(`「${device.displayName}」名下没有 ${ref.entityId}`);
      }
    }
    const row =
      (await this.settings.findOne({ where: { householdId: user.householdId } })) ??
      this.settings.create({ householdId: user.householdId });
    row.rules = rules;
    await this.settings.save(row);
    return this.view(user.householdId);
  }

  async recentEvents(householdId: string): Promise<SmartHomeWebhookEventRecord[]> {
    const rows = await this.events.find({ where: { householdId }, order: { receivedAt: 'DESC' }, take: 20 });
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      event: row.event,
      status: row.status,
      result: row.result,
      receivedAt: row.receivedAt.toISOString(),
    }));
  }

  async receive(
    householdId: string,
    rawBody: Buffer | undefined,
    headers: { timestamp?: string; signature?: string },
    body: SmartHomeWebhookBody,
  ) {
    const row = await this.loadWithSecrets(householdId);
    this.verify(householdId, row, rawBody, headers);
    const rules = this.rules(row);

    // 去重：同一个事件 id 10 分钟内只处理一次；超过一天的流水顺手清掉
    await this.events
      .createQueryBuilder()
      .delete()
      .where('"householdId" = :householdId AND "receivedAt" < now() - interval \'1 day\'', { householdId })
      .execute();
    const existing = await this.events.findOne({ where: { householdId, eventId: body.eventId } });
    if (existing) {
      const age = this.clock.now().getTime() - existing.receivedAt.getTime();
      if (age < SMART_HOME_WEBHOOK_DEDUP_MINUTES * 60_000) {
        return { accepted: true, duplicate: true, result: existing.result };
      }
      await this.events.delete(existing.id);
    }
    let record: SmartHomeEventRecord;
    try {
      record = await this.events.save(
        this.events.create({ householdId, eventId: body.eventId, event: body.event, status: 'processed', result: null }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) return { accepted: true, duplicate: true, result: null };
      throw error;
    }

    // 先告诉家里人「智能家居那边有动静」，再做联动
    this.bus.publish({ householdId, domains: ['smart-home'] });
    try {
      const outcome = await this.linkages.run(householdId, body, rules);
      record.status = outcome.status;
      record.result = outcome.result.slice(0, 300);
      await this.events.save(record);
      // 结果写好后再推一次：上面那次推的时候结果还是空的，刚好那时去取的页面会一直停在「—」（ping 这类没有别的域要推）
      this.bus.publish({ householdId, domains: [...new Set(['smart-home' as const, ...outcome.domains])] });
      return { accepted: true, duplicate: false, result: outcome.result };
    } catch (error) {
      record.status = 'failed';
      record.result = (error instanceof Error ? error.message : '联动失败').slice(0, 300);
      await this.events.save(record);
      this.bus.publish({ householdId, domains: ['smart-home'] });
      this.logger.warn(`smart_home_webhook_failed household=${householdId} event=${body.event} ${record.result}`);
      return { accepted: true, duplicate: false, result: `联动失败：${record.result}` };
    }
  }

  /** 验签。任何一步不对都是同一句 401，不告诉对方差在哪。 */
  private verify(
    householdId: string,
    row: SmartHomeWebhookSettings | null,
    rawBody: Buffer | undefined,
    headers: { timestamp?: string; signature?: string },
  ) {
    const reject = () => new UnauthorizedException('签名不对');
    if (!row?.secretEncrypted || !rawBody || !headers.timestamp || !headers.signature) throw reject();
    const timestamp = Number(headers.timestamp);
    const now = this.clock.now().getTime() / 1000;
    if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > SMART_HOME_WEBHOOK_TOLERANCE_SECONDS) throw reject();
    const raw = rawBody.toString('utf8');
    const signature = headers.signature.trim().toLowerCase();
    const secrets = [row.secretEncrypted];
    if (row.previousSecretEncrypted && row.previousValidUntil && row.previousValidUntil.getTime() > now * 1000) {
      secrets.push(row.previousSecretEncrypted);
    }
    const ok = secrets.some((encrypted) => {
      const secret = decryptIntegrationCredential(encrypted, householdId, SCOPE, 'Home Assistant 回调');
      return secret ? sameHex(smartHomeWebhookSignature(secret, headers.timestamp!, raw), signature) : false;
    });
    if (!ok) throw reject();
  }

  private rules(row: SmartHomeWebhookSettings | null): SmartHomeRules {
    const parsed = smartHomeRulesSchema.safeParse(row?.rules);
    return parsed.success ? parsed.data : DEFAULT_SMART_HOME_RULES;
  }

  private loadWithSecrets(householdId: string) {
    return this.settings
      .createQueryBuilder('settings')
      .addSelect(['settings.secretEncrypted', 'settings.previousSecretEncrypted'])
      .where('settings.householdId = :householdId', { householdId })
      .getOne();
  }

  private present(householdId: string, row: SmartHomeWebhookSettings | null): SmartHomeWebhookSettingsView {
    const now = this.clock.now().getTime();
    return {
      configured: Boolean(row?.secretHint),
      secretHint: row?.secretHint ?? null,
      rotatedAt: row?.rotatedAt?.toISOString() ?? null,
      previousValidUntil:
        row?.previousValidUntil && row.previousValidUntil.getTime() > now ? row.previousValidUntil.toISOString() : null,
      path: `/smart-home/webhook/${householdId}`,
      rules: this.rules(row),
    };
  }
}
