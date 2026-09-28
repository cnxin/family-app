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

/** 动作 → HA service 名（domain 就是实体自己的 domain）。 */
const SERVICES: Record<SmartHomeAction, string> = {
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

    const service = `${device.domain}.${SERVICES[body.action]}`;
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
      const { changed } = await callHomeAssistantService(target, device.domain, SERVICES[body.action], {
        entity_id: entityId,
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
