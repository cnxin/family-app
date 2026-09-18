import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PointsLedger, Reward, RewardRedemption, RewardRedemptionStatus } from '@family/contracts';
import {
  useCancelRedemption,
  useDecideRedemption,
  usePointsAccounts,
  usePointsLedger,
  useRedeemReward,
  useReversePointsLedger,
  useReverseRedemption,
  useRewardRedemptions,
  useRewards,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { pushToast } from '../lib/toast';
import { AdjustmentForm, RewardForm } from '../components/reward-form';
import {
  BalanceBand,
  LedgerList,
  RedemptionList,
  RewardGrid,
} from '../components/points-lists';
import { ListSkeleton } from '../components/skeleton';
import { Button, Dialog, EmptyState, Page, Panel, Segmented } from '../components/ui';

type Mode = 'rewards' | 'redemptions' | 'ledger';
type RedemptionFilter = 'all' | RewardRedemptionStatus;
type Ask =
  | { kind: 'redeem'; reward: Reward }
  | { kind: 'approve' | 'reject' | 'cancel' | 'reverse-redemption'; redemption: RewardRedemption }
  | { kind: 'reverse-ledger'; entry: PointsLedger };

const NO_REWARDS: Reward[] = [];
const NO_REDEMPTIONS: RewardRedemption[] = [];
const NO_LEDGER: PointsLedger[] = [];

export function PointsPage() {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const meId = session?.member.id;

  const accounts = usePointsAccounts();
  const rewards = useRewards(manager);
  const redemptions = useRewardRedemptions();
  const ledger = usePointsLedger();
  const redeem = useRedeemReward();
  const decide = useDecideRedemption();
  const cancel = useCancelRedemption();
  const reverseRedemption = useReverseRedemption();
  const reverseLedger = useReversePointsLedger();

  const [params] = useSearchParams();
  const focusedId = params.get('redemptionId');
  const [mode, setMode] = useState<Mode>(focusedId ? 'redemptions' : 'rewards');
  const [filter, setFilter] = useState<RedemptionFilter>('all');
  const [rewardForm, setRewardForm] = useState<Reward | 'new' | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [consumed, setConsumed] = useState<string | null>(null);

  // 通知里带 ?redemptionId= 过来，直接切到兑换记录
  if (focusedId && consumed !== focusedId) {
    setConsumed(focusedId);
    setMode('redemptions');
  }

  const accountRows = accounts.data ?? [];
  const balance = accountRows.find((one) => one.memberId === meId)?.balance ?? 0;
  const rewardRows = rewards.data ?? NO_REWARDS;
  const redemptionRows = redemptions.data ?? NO_REDEMPTIONS;
  const pendingCount = redemptionRows.filter((one) => one.status === 'pending').length;
  const visibleRedemptions = useMemo(
    () => (filter === 'all' ? redemptionRows : redemptionRows.filter((one) => one.status === filter)),
    [redemptionRows, filter],
  );

  const busy =
    redeem.isPending ||
    decide.isPending ||
    cancel.isPending ||
    reverseRedemption.isPending ||
    reverseLedger.isPending;

  const copy = askCopy(ask, accountRows, balance);

  function confirm() {
    if (!ask) return;
    const done = (text: string) => () => {
      setAsk(null);
      pushToast(text);
    };
    if (ask.kind === 'redeem') {
      redeem.mutate({ rewardId: ask.reward.id }, { onSuccess: done(`已申请兑换「${ask.reward.name}」，等确认`) });
    } else if (ask.kind === 'approve' || ask.kind === 'reject') {
      decide.mutate(
        { id: ask.redemption.id, decision: ask.kind === 'approve' ? 'approve' : 'reject' },
        { onSuccess: done(ask.kind === 'approve' ? '兑换已确认' : '已拒绝并退回积分') },
      );
    } else if (ask.kind === 'cancel') {
      cancel.mutate({ id: ask.redemption.id }, { onSuccess: done('兑换已取消，积分退回') });
    } else if (ask.kind === 'reverse-redemption') {
      reverseRedemption.mutate({ id: ask.redemption.id }, { onSuccess: done('兑换已撤销，积分退回') });
    } else if (ask.kind === 'reverse-ledger') {
      reverseLedger.mutate({ id: ask.entry.id }, { onSuccess: done('已写入反向流水') });
    }
  }

  const loading =
    (mode === 'rewards' && rewards.isPending) ||
    (mode === 'redemptions' && redemptions.isPending) ||
    (mode === 'ledger' && ledger.isPending);
  const failed =
    (mode === 'rewards' && rewards.isError) ||
    (mode === 'redemptions' && redemptions.isError) ||
    (mode === 'ledger' && ledger.isError);

  return (
    <Page
      title="积分奖励"
      subtitle="家庭贡献、兑换和审批都记在这儿"
      actions={
        manager ? (
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              className="h-9 px-3 text-[13px]"
              disabled={!accountRows.length}
              onClick={() => setAdjustOpen(true)}
            >
              调整积分
            </Button>
            <Button className="h-9 px-3 text-[13px]" onClick={() => setRewardForm('new')}>
              + 新增奖励
            </Button>
          </div>
        ) : undefined
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <BalanceBand accounts={accountRows} meId={meId} loading={accounts.isPending} />
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'rewards', label: '家庭奖励' },
              {
                value: 'redemptions',
                label: `${manager ? '兑换审批' : '我的兑换'}${pendingCount ? ` ${pendingCount}` : ''}`,
              },
              { value: 'ledger', label: '积分流水' },
            ]}
          />
        </div>
      }
    >
      <Panel className="p-3">
        {loading ? (
          <ListSkeleton rows={4} />
        ) : failed ? (
          <EmptyState emoji="📉" title="积分数据读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : mode === 'rewards' ? (
          <RewardGrid
            rewards={rewardRows}
            balance={balance}
            manager={manager}
            onRedeem={(reward) => setAsk({ kind: 'redeem', reward })}
            onEdit={(reward) => setRewardForm(reward)}
          />
        ) : mode === 'redemptions' ? (
          <div className="flex flex-col gap-3">
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all' as const, label: '全部' },
                { value: 'pending' as const, label: '待确认' },
                { value: 'approved' as const, label: '已确认' },
              ]}
            />
            <RedemptionList
              redemptions={visibleRedemptions}
              focusedId={focusedId}
              manager={manager}
              meId={meId}
              onApprove={(redemption) => setAsk({ kind: 'approve', redemption })}
              onReject={(redemption) => setAsk({ kind: 'reject', redemption })}
              onCancel={(redemption) => setAsk({ kind: 'cancel', redemption })}
              onReverse={(redemption) => setAsk({ kind: 'reverse-redemption', redemption })}
            />
          </div>
        ) : (
          <LedgerList
            ledger={ledger.data ?? NO_LEDGER}
            manager={manager}
            onReverse={(entry) => setAsk({ kind: 'reverse-ledger', entry })}
          />
        )}
      </Panel>

      {rewardForm ? (
        <RewardForm
          key={rewardForm === 'new' ? 'new' : rewardForm.id}
          editing={rewardForm === 'new' ? null : rewardForm}
          onClose={() => setRewardForm(null)}
        />
      ) : null}

      {adjustOpen ? (
        <AdjustmentForm accounts={accountRows} onClose={() => setAdjustOpen(false)} />
      ) : null}

      {ask ? (
        <Dialog
          title={copy.title}
          onClose={() => setAsk(null)}
          maxWidth={420}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAsk(null)}>
                再想想
              </Button>
              <Button
                className={'flex-1 ' + (copy.destructive ? 'bg-danger hover:brightness-110' : '')}
                disabled={busy}
                onClick={confirm}
              >
                {busy ? '处理中…' : copy.confirmLabel}
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-ink-soft">{copy.message}</p>
        </Dialog>
      ) : null}
    </Page>
  );
}

/** 每种确认都把「预计积分变化」算给人看——这是旧客户端里最值得保留的一处体贴。 */
function askCopy(
  ask: Ask | null,
  accounts: { memberId: string; balance: number }[],
  myBalance: number,
) {
  if (!ask) return { title: '', message: '', confirmLabel: '确认', destructive: false };
  if (ask.kind === 'redeem') {
    return {
      title: `兑换「${ask.reward.name}」？`,
      message: `预计积分变化：${myBalance} - ${ask.reward.cost} = ${myBalance - ask.reward.cost}。提交后先扣分，没通过会自动退回。`,
      confirmLabel: '确认兑换',
      destructive: false,
    };
  }
  if (ask.kind === 'approve') {
    return {
      title: '确认这笔兑换？',
      message: `「${ask.redemption.rewardName}」在申请时已经扣了 ${ask.redemption.cost} 分，确认后进入已完成，不会再扣。`,
      confirmLabel: '确认通过',
      destructive: false,
    };
  }
  if (ask.kind === 'reverse-ledger') {
    const before = accounts.find((one) => one.memberId === ask.entry.memberId)?.balance ?? 0;
    const delta = -ask.entry.delta;
    return {
      title: '撤销这笔积分流水？',
      message: `会写一条反向流水。预计积分变化：${before} ${delta >= 0 ? '+' : '-'} ${Math.abs(delta)} = ${before + delta}，原流水永久保留。`,
      confirmLabel: '确认撤销',
      destructive: true,
    };
  }
  const before = accounts.find((one) => one.memberId === ask.redemption.memberId)?.balance ?? 0;
  return {
    title:
      ask.kind === 'reject'
        ? '拒绝这笔兑换？'
        : ask.kind === 'cancel'
          ? '取消这笔兑换？'
          : '撤销已确认的兑换？',
    message: `会写反向流水并退回积分。预计变化：${before} + ${ask.redemption.cost} = ${before + ask.redemption.cost}，历史记录不删。`,
    confirmLabel: ask.kind === 'reject' ? '拒绝并退回' : '撤销并退回',
    destructive: true,
  };
}
