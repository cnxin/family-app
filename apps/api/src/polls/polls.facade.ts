import type { PollsFacade } from '@family/contracts';
import { fromPluginTransaction } from '../system/plugin-facades.registry';
import type { PollsService } from './polls.module';

/** 投票门面的实现（J4.1，接口见 contracts/plugins/polls.facade.ts），PollsModule 启动时注册。 */
export function pollsFacade(polls: PollsService): PollsFacade {
  return {
    createPoll: (transaction, input, actor) =>
      polls.createWithinTransaction(input, actor, fromPluginTransaction(transaction)),
  };
}
