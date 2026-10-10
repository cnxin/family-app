// 投票门面（J4.1）：实现在 apps/api/src/polls/polls.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（投票提案确认后发起投票；第四批起读工具 get_polls 看投票和票数）。
import type { CreatePollBody, HouseholdPoll } from '../polls';
import type { PluginActor, PluginTransaction } from './kernel';

export interface PollsFacade {
  /** 与 POST /polls 同一个实现，在调用方的事务里建；返回投票 id。 */
  createPoll(transaction: PluginTransaction, input: CreatePollBody, actor: PluginActor): Promise<string>;
  /** 只读：与 GET /polls?status= 同一个实现（不含归档的，最近 50 个里按状态筛）。 */
  listPolls(status: 'open' | 'closed', actor: PluginActor): Promise<HouseholdPoll[]>;
}
