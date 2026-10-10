import type { HouseholdPoll, PollsFacade } from '@family/contracts';
import { fromPluginTransaction } from '../system/plugin-facades.registry';
import type { PollsService } from './polls.module';

/** 投票门面的实现（J4.1，接口见 contracts/plugins/polls.facade.ts），PollsModule 启动时注册。 */
export function pollsFacade(polls: PollsService): PollsFacade {
  return {
    createPoll: (transaction, input, actor) =>
      polls.createWithinTransaction(input, actor, fromPluginTransaction(transaction)),
    // present 出来的时间是 Date，经 HTTP 序列化后才是契约里的字符串；小管家只取标题、选项票数、截止时间
    listPolls: async (status, actor) => (await polls.list({ status }, actor)) as unknown as HouseholdPoll[],
  };
}
