import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  smartHomeActionsFor,
  type SmartHomeAction,
  type SmartHomeCommand,
  type SmartHomeCommandSource,
  type SmartHomeCommandBody,
} from '@family/contracts';
import { JwtUser } from '../auth/jwt.guard';
import { SmartHomeCommandRecord, SmartHomeDevice } from '../entities';
import { HomeAssistantError, callHomeAssistantService } from './home-assistant.client';
import { SmartHomeSettingsService } from './smart-home-settings.service';
import { SmartHomeControlError, actionFitsDomain, planCommand, type ServicePlan } from './smart-home-controls';
import { domainOf } from './smart-home-devices';
import { canOperate, controlFor, entityAccess } from './smart-home-panel.service';
import { SmartHomeService, isReadonlyCover } from './smart-home.service';

/** 主实体的简单动作 → HA service 名（domain 就是实体自己的 domain），只带 entity_id，不用先读状态。 */
const SIMPLE: Partial<Record<SmartHomeAction, string>> = {
  start: 'start',
  pause: 'pause',
  return_to_base: 'return_to_base',
  open: 'open_cover',
  stop: 'stop_cover',
  close: 'close_cover',
  turn_on: 'turn_on',
  turn_off: 'turn_off',
  activate: 'turn_on',
};

function isUniqueViolation(error: unknown) {
  return error instanceof QueryFailedError && (error.driverError as { code?: string } | undefined)?.code === '23505';
}

/**
 * E2 控制（home-assistant-plan §6）+ R1b 详情面板的子实体控制（smart-home-redesign §9.5）：每条指令都重新校验权限
 * （不信前端）、带幂等键、落审计；HA 失败回 502，审计里记下原因。成功后丢掉状态缓存，全局拦截器随即发 smart-home 事件。
 *
 * 放行顺序：设备在白名单 → 允许控制 + 角色够 → 子实体属于这台、没藏、已确认、不在排除名单、不是诊断类 →
 * 控件描述里有这个动作 → 值按 HA 当前属性合法 → 幂等键查重 → 调 HA。
 */
@Injectable()
export class SmartHomeCommandsService {
  constructor(
    @InjectRepository(SmartHomeDevice)
    private readonly devices: Repository<SmartHomeDevice>,
    @InjectRepository(SmartHomeCommandRecord)
    private readonly commands: Repository<SmartHomeCommandRecord>,
    private readonly settings: SmartHomeSettingsService,
    private readonly smartHome: SmartHomeService,
  ) {}

  /** origin：E4 联动按的传 linkId（审计里记来源），家里人手按的不传。 */
  async execute(
    deviceId: string,
    body: SmartHomeCommandBody,
    user: JwtUser,
    origin: { linkId: string } | null = null,
  ): Promise<SmartHomeCommand> {
    const device = await this.devices.findOne({ where: { householdId: user.householdId, id: deviceId } });
    if (!device) throw new NotFoundException('白名单里没有这台设备');
    const entityId = body.entityId ?? device.primaryEntityId;
    const domain = domainOf(entityId);
    if (!actionFitsDomain(domain, body.action)) throw new BadRequestException('这台设备没有这个动作');
    if (!device.controllable) throw new ForbiddenException('这台设备没开放在小管家里控制');
    if (!canOperate(device, user.role)) throw new ForbiddenException('这台设备只有管理员能控制');
    const simple =
      entityId === device.primaryEntityId &&
      body.value === undefined &&
      SIMPLE[body.action] !== undefined &&
      smartHomeActionsFor(domain).includes(body.action);

    let plan: ServicePlan | null = null;
    if (simple) {
      if (domain === 'cover') {
        const state = await this.smartHome.currentState(user.householdId, entityId);
        if (isReadonlyCover(domain, state?.deviceClass ?? null)) throw new ForbiddenException('车库门、大门这类只读');
      }
    } else {
      plan = await this.plan(device, entityId, body, user);
    }

    // 同一次点击重发：直接交回上一次的结果（在按当前状态算调用之前，免得调温重发时已经到头而报冲突）
    const prior = await this.commands.findOne({ where: { householdId: user.householdId, requestId: body.requestId } });
    if (prior) return this.replay(user, body, entityId);
    const service = plan ?? { domain, service: SIMPLE[body.action] as string, data: {}, label: `${domain}.${SIMPLE[body.action]}` };
    let record: SmartHomeCommandRecord;
    try {
      record = await this.commands.save(
        this.commands.create({
          householdId: user.householdId,
          memberId: user.memberId,
          requestId: body.requestId,
          deviceId: device.id,
          entityId,
          action: body.action,
          service: service.label.slice(0, 80),
          status: 'pending',
          message: null,
          finishedAt: null,
          source: origin ? 'link' : 'manual',
          linkId: origin?.linkId ?? null,
        }),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.replay(user, body, entityId);
    }

    const { target } = await this.settings.resolve(user.householdId);
    try {
      if (!target) throw new HomeAssistantError('还没连上 Home Assistant');
      const { changed } = await callHomeAssistantService(target, service.domain, service.service, {
        entity_id: entityId,
        ...service.data,
      });
      record.status = 'succeeded';
      record.message = `已执行 ${service.label}（${changed} 个实体有变化）`;
    } catch (error) {
      record.status = 'failed';
      record.message = (error instanceof HomeAssistantError ? error.message : '执行失败').slice(0, 300);
    }
    record.finishedAt = new Date();
    await this.commands.save(record);
    this.smartHome.forget(user.householdId);
    if (record.status === 'failed') throw new BadGatewayException(`没执行成功：${record.message}`);
    return this.present(record, user.name, false);
  }

  /** 完整路径：子实体身份 → 控件描述 → 按 HA 当前属性校验值。 */
  private async plan(device: SmartHomeDevice, entityId: string, body: SmartHomeCommandBody, user: JwtUser) {
    const context = await this.smartHome.deviceContext(device);
    const access = entityAccess(device, context, entityId);
    if (access.kind === 'missing') throw new NotFoundException('这台设备没有这个实体');
    if (access.kind === 'pending') throw new ForbiddenException('这是 Home Assistant 新冒出来的实体，管理员在详情里确认后才能用');
    if (access.kind === 'excluded') throw new ForbiddenException('此操作请在厂商 App 完成');
    if (!context.live) throw new BadGatewayException(`没执行成功：${context.connection.message}`);
    const control = controlFor(device, context, entityId, access, canOperate(device, user.role));
    if (!control) throw new BadRequestException(access.diagnostic ? '这个实体只能看' : '这个实体在小管家里只能看');
    try {
      return planCommand(domainOf(entityId), control, body.action, body.value, access.raw);
    } catch (error) {
      if (error instanceof SmartHomeControlError) {
        throw error.status === 409 ? new ConflictException(error.message) : new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async recent(householdId: string, source?: SmartHomeCommandSource): Promise<SmartHomeCommand[]> {
    const rows = await this.commands.find({
      where: { householdId, ...(source ? { source } : {}) },
      relations: { member: true, link: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return rows.map((row) => this.present(row, row.member?.name ?? '', false));
  }

  /** 同一个 requestId 再来一次：不再发给 HA，把第一次的结果原样交回去。 */
  private async replay(user: JwtUser, body: SmartHomeCommandBody, entityId: string) {
    const existing = await this.commands.findOne({
      where: { householdId: user.householdId, requestId: body.requestId },
    });
    if (!existing || existing.entityId !== entityId || existing.action !== body.action) {
      throw new ConflictException('请求编号重复了，刷新页面再试');
    }
    if (existing.status === 'pending') throw new ConflictException('上一次还在执行，稍等一下');
    if (existing.status === 'failed') throw new BadGatewayException(`没执行成功：${existing.message}`);
    return this.present(existing, user.name, true);
  }

  private present(row: SmartHomeCommandRecord, memberName: string, replayed: boolean): SmartHomeCommand {
    return {
      id: row.id,
      deviceId: row.deviceId,
      entityId: row.entityId,
      action: row.action as SmartHomeAction,
      status: row.status,
      message: row.message,
      memberName,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      replayed,
      source: row.source,
      linkName: row.link?.name ?? null,
    };
  }
}
