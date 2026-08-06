import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { AgentMessage, AgentToolEvent } from '../entities';

const PURGE_BATCH_SIZE = 200;
const DEFAULT_RETENTION_DAYS = 7;
const DUE_CONVERSATIONS = `
  SELECT conversation.id
  FROM agent_conversations AS conversation
  LEFT JOIN agent_settings AS setting
    ON setting."householdId" = conversation."householdId"
  WHERE conversation."expiresAt" <= CURRENT_TIMESTAMP
    OR (
      conversation.status = :archivedStatus
      AND conversation."updatedAt" <= CURRENT_TIMESTAMP
        - (COALESCE(setting."retentionDays", :defaultRetentionDays) * INTERVAL '1 day')
    )
`;

@Injectable()
export class AgentRetentionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  private purging = false;

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap() {
    const configured = Number(
      process.env.AGENT_PURGE_POLL_INTERVAL_MS || 60_000,
    );
    const interval = Number.isFinite(configured)
      ? Math.max(100, Math.min(configured, 300_000))
      : 60_000;
    void this.purgeDue();
    this.timer = setInterval(() => void this.purgeDue(), interval);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async purgeDue() {
    if (this.purging) return;
    this.purging = true;
    try {
      await this.dataSource.transaction(async (manager) => {
        const messages = manager.getRepository(AgentMessage);
        const dueMessages = await messages
          .createQueryBuilder('message')
          .where(`message.conversationId IN (${DUE_CONVERSATIONS})`, {
            archivedStatus: 'archived',
            defaultRetentionDays: DEFAULT_RETENTION_DAYS,
          })
          .orderBy('message.createdAt', 'ASC')
          .take(PURGE_BATCH_SIZE)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();

        if (dueMessages.length) {
          await messages.delete({ id: In(dueMessages.map((message) => message.id)) });
        }

        const remaining = PURGE_BATCH_SIZE - dueMessages.length;
        if (remaining <= 0) return;

        const events = manager.getRepository(AgentToolEvent);
        const dueEvents = await events
          .createQueryBuilder('event')
          .where('event.presentationCiphertext IS NOT NULL')
          .andWhere(
            `event.runId IN (
              SELECT agent_run.id
              FROM agent_runs AS agent_run
              WHERE agent_run."conversationId" IN (${DUE_CONVERSATIONS})
            )`,
            {
              archivedStatus: 'archived',
              defaultRetentionDays: DEFAULT_RETENTION_DAYS,
            },
          )
          .orderBy('event.startedAt', 'ASC')
          .take(remaining)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();

        if (dueEvents.length) {
          await events.update(
            { id: In(dueEvents.map((event) => event.id)) },
            {
              presentationCiphertext: null,
              presentationNonce: null,
              presentationVersion: null,
            },
          );
        }
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'agent_retention_purge_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    } finally {
      this.purging = false;
    }
  }
}
