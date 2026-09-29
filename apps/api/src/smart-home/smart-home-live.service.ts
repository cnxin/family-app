import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmartHomeDevice } from '../entities';
import { EventBus } from '../events/event-bus';
import { fetchHomeAssistantStates, type HomeAssistantTarget } from './home-assistant.client';
import { subscribeHomeAssistantStates, type HomeAssistantSubscription } from './home-assistant.ws';
import { SmartHomeMergeService } from './smart-home-merge.service';
import { SmartHomeSettingsService } from './smart-home-settings.service';
import { SmartHomeService } from './smart-home.service';

function envMs(name: string, fallback: number, min = 50) {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured >= min ? configured : fallback;
}

/**
 * 一个家庭的 HA 状态盯梢：优先 WebSocket 订阅 state_changed（推），断了退回定时拉 /api/states 比对
 * （pre-trial-plan H3：有了 /events 就不该让客户端轮询，服务端退化为 30 秒一次），同时按退避重连 WebSocket。
 * 只看白名单设备名下的实体；有变化就调 onChange（已去抖）。
 */
class HouseholdWatcher {
  private subscription: HomeAssistantSubscription | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private signature: string | null = null;
  private attempt = 0;
  private stopped = false;
  mode: 'connecting' | 'push' | 'poll' = 'connecting';

  constructor(
    readonly householdId: string,
    private readonly target: HomeAssistantTarget,
    readonly version: string,
    public entityIds: Set<string>,
    private readonly onChange: () => void,
    private readonly log: (message: string) => void,
  ) {}

  start() {
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.subscription?.close();
    this.stopPolling();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  private changed() {
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      if (!this.stopped) this.onChange();
    }, 200);
  }

  private connect() {
    if (this.stopped) return;
    this.subscription = subscribeHomeAssistantStates(this.target, {
      onOpen: () => {
        if (this.mode !== 'push') this.log(`smart_home_live household=${this.householdId} mode=push`);
        this.mode = 'push';
        this.attempt = 0;
        this.stopPolling();
        // 断开期间可能错过了变化：连上时让客户端补读一次
        this.changed();
      },
      onStateChanged: (entityId) => {
        if (this.entityIds.has(entityId)) this.changed();
      },
      onClose: (reason) => {
        this.subscription = null;
        if (this.stopped) return;
        // 从推送掉下来：让客户端马上重读一次——页面没有刷新按钮了，得靠这一下才知道「连不上」
        if (this.mode === 'push') this.changed();
        if (this.mode !== 'poll') this.log(`smart_home_live household=${this.householdId} mode=poll reason=${reason}`);
        this.mode = 'poll';
        this.startPolling();
        const delay = Math.min(
          envMs('SMART_HOME_RECONNECT_MAX_MS', 60_000),
          envMs('SMART_HOME_RECONNECT_MIN_MS', 5_000) * 2 ** this.attempt,
        );
        this.attempt += 1;
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      },
    });
  }

  private startPolling() {
    if (this.pollTimer) return;
    const poll = async () => {
      try {
        const states = await fetchHomeAssistantStates(this.target);
        const signature = states
          .filter((raw) => this.entityIds.has(raw.entity_id))
          .map((raw) => `${raw.entity_id}=${raw.state}@${raw.last_changed ?? ''}:${JSON.stringify(raw.attributes ?? {})}`)
          .sort()
          .join('|');
        if (this.signature !== null && signature !== this.signature) this.changed();
        this.signature = signature;
      } catch {
        /* HA 连不上：页面自己会显示「连不上」，这里不重复推 */
      }
    };
    void poll();
    this.pollTimer = setInterval(() => void poll(), envMs('SMART_HOME_POLL_MS', 30_000));
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.signature = null;
  }
}

/**
 * 每个「连好了 HA 且白名单非空」的家庭一个盯梢。设置 / 白名单变了由控制器调 refresh()；
 * 另外每分钟全量对账一次（兜住服务器默认的令牌文件后写入、测试直接改库之类）。
 */
@Injectable()
export class SmartHomeLiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SmartHomeLive');
  private readonly watchers = new Map<string, HouseholdWatcher>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(SmartHomeDevice)
    private readonly devices: Repository<SmartHomeDevice>,
    private readonly settings: SmartHomeSettingsService,
    private readonly smartHome: SmartHomeService,
    private readonly merge: SmartHomeMergeService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    const every = envMs('SMART_HOME_RECONCILE_MS', 60_000);
    this.timer = setInterval(() => void this.reconcile(), every);
    setTimeout(() => void this.reconcile(), Math.min(every, 2_000)).unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    for (const watcher of this.watchers.values()) watcher.stop();
    this.watchers.clear();
  }

  /** 测试与排查用：各家庭当前是推还是拉。 */
  modes() {
    return Object.fromEntries([...this.watchers.values()].map((watcher) => [watcher.householdId, watcher.mode]));
  }

  async reconcile() {
    try {
      const rows: { householdId: string }[] = await this.devices
        .createQueryBuilder('device')
        .select('DISTINCT device.householdId', 'householdId')
        .getRawMany();
      const active = new Set(rows.map((row) => row.householdId));
      for (const householdId of this.watchers.keys()) if (!active.has(householdId)) this.stop(householdId);
      for (const householdId of active) await this.refresh(householdId);
    } catch (error) {
      this.logger.warn(`smart_home_live_reconcile_failed ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async refresh(householdId: string) {
    const { target, version } = await this.settings.resolve(householdId);
    // 有按实体登记的旧行、HA 又连得上：先按设备归并（R1，幂等；连不上就等下一轮对账）
    if (target) await this.merge.mergeIfNeeded(householdId);
    const entityIds = await this.smartHome.watchedEntityIds(householdId);
    if (!target || !entityIds.size) return this.stop(householdId);
    const existing = this.watchers.get(householdId);
    if (existing && existing.version === version) {
      existing.entityIds = entityIds;
      return;
    }
    existing?.stop();
    const watcher = new HouseholdWatcher(
      householdId,
      target,
      version,
      entityIds,
      () => {
        this.smartHome.forget(householdId);
        this.bus.publish({ householdId, domains: ['smart-home'] });
      },
      (message) => this.logger.log(message),
    );
    this.watchers.set(householdId, watcher);
    watcher.start();
  }

  private stop(householdId: string) {
    this.watchers.get(householdId)?.stop();
    this.watchers.delete(householdId);
  }
}
