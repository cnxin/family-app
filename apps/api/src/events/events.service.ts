import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import {
  EVENTS_HEARTBEAT_MS,
  EVENTS_MAX_CONNECTIONS_PER_HOUSEHOLD,
  type EventsChanged,
  type EventsHello,
} from '@family/contracts';
import { Clock } from '../common/clock';
import { EventBus, type HouseholdChange } from './event-bus';

interface Connection {
  id: string;
  householdId: string;
  memberId: string;
  response: Response;
  heartbeat: ReturnType<typeof setInterval>;
  expiry: ReturnType<typeof setTimeout> | null;
}

function heartbeatMs() {
  const configured = Number(process.env.EVENTS_HEARTBEAT_MS);
  return Number.isFinite(configured) && configured >= 50 ? configured : EVENTS_HEARTBEAT_MS;
}

/**
 * /events 的连接表：每条连接绑定一个家庭，只收本家庭的事件。
 * 访问令牌到期时服务端主动断开，客户端用续期后的令牌重连——退出登录后旧流最多再活一个令牌有效期。
 */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger('Events');
  private readonly connections = new Map<string, Set<Connection>>();
  private readonly unsubscribe: () => void;

  constructor(
    bus: EventBus,
    private readonly clock: Clock,
  ) {
    this.unsubscribe = bus.subscribe((change) => this.fanOut(change));
  }

  /** 家庭连接数已满时返回 false，调用方回 429。 */
  open(user: { householdId: string; memberId: string }, response: Response, expiresAtMs: number | null) {
    const current = this.connections.get(user.householdId) ?? new Set<Connection>();
    if (current.size >= EVENTS_MAX_CONNECTIONS_PER_HOUSEHOLD) {
      this.logger.warn(
        `events_connection_rejected household=${user.householdId} open=${current.size} limit=${EVENTS_MAX_CONNECTIONS_PER_HOUSEHOLD}`,
      );
      return false;
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    // 反代（Caddy / nginx）别缓冲这条流
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const connection: Connection = {
      id: randomUUID(),
      householdId: user.householdId,
      memberId: user.memberId,
      response,
      heartbeat: setInterval(() => this.send(connection, 'heartbeat', ''), heartbeatMs()),
      expiry: null,
    };
    if (expiresAtMs !== null) {
      const remaining = Math.max(0, expiresAtMs - Date.now());
      connection.expiry = setTimeout(() => this.close(connection, true), remaining);
    }
    current.add(connection);
    this.connections.set(user.householdId, current);
    response.on('close', () => this.close(connection, false));

    const hello: EventsHello = { serverTime: this.clock.now().toISOString(), connectionId: connection.id };
    this.send(connection, 'hello', JSON.stringify(hello));
    return true;
  }

  /** 测试与运维用：当前各家庭的连接数。 */
  connectionCount(householdId: string) {
    return this.connections.get(householdId)?.size ?? 0;
  }

  onModuleDestroy() {
    this.unsubscribe();
    for (const set of this.connections.values()) {
      for (const connection of [...set]) this.close(connection, true);
    }
  }

  private fanOut(change: HouseholdChange) {
    const targets = this.connections.get(change.householdId);
    if (!targets?.size) return;
    const payload: EventsChanged = {
      domains: [...new Set(change.domains)],
      at: this.clock.now().toISOString(),
      ...(change.actor ? { actor: change.actor } : {}),
    };
    const data = JSON.stringify(payload);
    for (const connection of targets) this.send(connection, 'changed', data);
  }

  private send(connection: Connection, event: string, data: string) {
    if (connection.response.writableEnded) return;
    connection.response.write(`event: ${event}\ndata: ${data}\n\n`);
  }

  private close(connection: Connection, end: boolean) {
    clearInterval(connection.heartbeat);
    if (connection.expiry) clearTimeout(connection.expiry);
    const set = this.connections.get(connection.householdId);
    if (set?.delete(connection) && set.size === 0) this.connections.delete(connection.householdId);
    if (end && !connection.response.writableEnded) connection.response.end();
  }
}
