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
  type SmartHomeCommandBody,
  type SmartHomeDomain,
} from '@family/contracts';
import { JwtUser } from '../auth/jwt.guard';
import { SmartHomeCommandRecord, SmartHomeDevice } from '../entities';
import { HomeAssistantError, callHomeAssistantService } from './home-assistant.client';
import { SmartHomeSettingsService } from './smart-home-settings.service';
import { SmartHomeService, canControlDevice, isReadonlyCover } from './smart-home.service';

/** 简单动作 → HA service 名（domain 就是实体自己的 domain），只带 entity_id。 */
const SERVICES: Partial<Record<SmartHomeAction, string>> = {
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

const HVAC_MODES: Partial<Record<SmartHomeAction, string>> = {
  mode_cool: 'cool',
  mode_heat: 'heat',
  mode_fan_only: 'fan_only',
  mode_auto: 'auto',
};

interface ServicePlan {
  service: string;
  data: Record<string, unknown>;
  /** 审计里记的，比如 climate.set_temperature(27) */
  label: string;
}

function isUniqueViolation(error: unknown) {
  return error instanceof QueryFailedError && (error.driverError as { code?: string } | undefined)?.code === '23505';
}

/**
 * E2 控制（home-assistant-plan §6）：每条指令都重新校验权限（不信前端）、带幂等键、落审计；
 * HA 失败回 502，审计里记下原因。成功后丢掉状态缓存，全局拦截器随即发 smart-home 事件。
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

  async execute(entityId: string, body: SmartHomeCommandBody, user: JwtUser): Promise<SmartHomeCommand> {
    const device = await this.devices.findOne({ where: { householdId: user.householdId, entityId } });
    if (!device) throw new NotFoundException('白名单里没有这个设备');
    if (!smartHomeActionsFor(device.domain).includes(body.action)) {
      throw new BadRequestException('这台设备没有这个动作');
    }
    const view = { ...device, domain: device.domain as SmartHomeDomain, createdAt: '', updatedAt: '' };
    if (!device.controllable) throw new ForbiddenException('这台设备没开放在小管家里控制');
    if (!canControlDevice(view, user.role)) throw new ForbiddenException('这台设备只有管理员能控制');
    if (device.domain === 'cover') {
      const state = await this.smartHome.currentState(user.householdId, entityId);
      if (isReadonlyCover(device.domain, state?.deviceClass ?? null)) {
        throw new ForbiddenException('车库门、大门这类只读');
      }
    }

    // 同一次点击重发：直接交回上一次的结果（在按当前状态算调用之前，免得调温重发时已经到头而报冲突）
    const prior = await this.commands.findOne({ where: { householdId: user.householdId, requestId: body.requestId } });
    if (prior) return this.replay(user, body, entityId);
    const plan = await this.plan(user.householdId, entityId, device.domain, body.action);
    const service = plan.label;
    let record: SmartHomeCommandRecord;
    try {
      record = await this.commands.save(
        this.commands.create({
          householdId: user.householdId,
          memberId: user.memberId,
          requestId: body.requestId,
          entityId,
          action: body.action,
          service,
          status: 'pending',
          message: null,
          finishedAt: null,
        }),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.replay(user, body, entityId);
    }

    const { target } = await this.settings.resolve(user.householdId);
    try {
      if (!target) throw new HomeAssistantError('还没连上 Home Assistant');
      const { changed } = await callHomeAssistantService(target, device.domain, plan.service, {
        entity_id: entityId,
        ...plan.data,
      });
      record.status = 'succeeded';
      record.message = `已执行 ${service}（${changed} 个实体有变化）`;
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

  /** 这个动作要调哪个 service、带什么参数。空调的模式、温度要看 HA 里的当前状态。 */
  private async plan(householdId: string, entityId: string, domain: string, action: SmartHomeAction): Promise<ServicePlan> {
    const simple = SERVICES[action];
    if (simple) return { service: simple, data: {}, label: `${domain}.${simple}` };
    const state = await this.smartHome.currentState(householdId, entityId);
    const mode = HVAC_MODES[action];
    if (mode) {
      if (state?.hvacModes && !state.hvacModes.includes(mode)) throw new BadRequestException('这台空调没有这个模式');
      return { service: 'set_hvac_mode', data: { hvac_mode: mode }, label: `${domain}.set_hvac_mode(${mode})` };
    }
    // temperature_up / temperature_down：以 HA 里的设定温度为准 ±1，收在它给的上下限里
    const current = state?.targetTemperature;
    if (current == null) throw new ConflictException('读不到空调现在的设定温度，先在 Home Assistant 里设一次');
    const min = state?.minTemperature ?? 16;
    const max = state?.maxTemperature ?? 30;
    const next = Math.min(max, Math.max(min, current + (action === 'temperature_up' ? 1 : -1)));
    if (next === current) throw new ConflictException(action === 'temperature_up' ? `已经是最高的 ${max}° 了` : `已经是最低的 ${min}° 了`);
    return { service: 'set_temperature', data: { temperature: next }, label: `${domain}.set_temperature(${next})` };
  }

  async recent(householdId: string): Promise<SmartHomeCommand[]> {
    const rows = await this.commands.find({
      where: { householdId },
      relations: { member: true },
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
      entityId: row.entityId,
      action: row.action as SmartHomeAction,
      status: row.status,
      message: row.message,
      memberName,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      replayed,
    };
  }
}
