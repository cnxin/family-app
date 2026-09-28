import { Injectable, Logger } from '@nestjs/common';
import { JwtUser } from '../auth/jwt.guard';

/** 某次家务被打勾完成（事务已提交）。 */
export interface TaskCompletedEvent {
  householdId: string;
  taskId: string;
  dueDate: string;
  title: string;
  actor: JwtUser;
}

/**
 * 家务模块对外的进程内事件：别的模块（智能家居 E4 联动）订阅「完成」，家务模块不反过来依赖它们。
 * 监听方异步执行、出错只记日志——打勾这件事本身不等、也不受影响。
 */
@Injectable()
export class TaskEvents {
  private readonly logger = new Logger('TaskEvents');
  private readonly listeners = new Set<(event: TaskCompletedEvent) => Promise<void> | void>();

  onCompleted(listener: (event: TaskCompletedEvent) => Promise<void> | void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitCompleted(event: TaskCompletedEvent) {
    for (const listener of this.listeners) {
      setImmediate(() => {
        Promise.resolve()
          .then(() => listener(event))
          .catch((error) =>
            this.logger.warn(`task_completed_listener_failed task=${event.taskId} ${error instanceof Error ? error.message : String(error)}`),
          );
      });
    }
  }
}
