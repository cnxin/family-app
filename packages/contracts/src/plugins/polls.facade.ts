// 投票门面（J4.1）：实现在 apps/api/src/polls/polls.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（投票提案确认后发起投票）。
import type { CreatePollBody } from '../polls';
import type { PluginActor, PluginTransaction } from './kernel';

export interface PollsFacade {
  /** 与 POST /polls 同一个实现，在调用方的事务里建；返回投票 id。 */
  createPoll(transaction: PluginTransaction, input: CreatePollBody, actor: PluginActor): Promise<string>;
}
