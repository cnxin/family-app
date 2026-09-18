import type {
  PointsAccount,
  PointsLedger,
  Reward,
  RewardRedemption,
  RewardRedemptionStatus,
} from '@family/contracts';
import { Button, EmptyState } from './ui';

export const REDEMPTION_STATUS_LABEL: Record<RewardRedemptionStatus, string> = {
  pending: '待确认',
  approved: '已确认',
  rejected: '未通过',
  cancelled: '已取消',
  reversed: '已撤销',
};

export function ledgerTypeLabel(type: PointsLedger['type']) {
  if (type === 'award') return '积分发放';
  if (type === 'adjustment') return '积分调整';
  if (type === 'redemption') return '奖励兑换';
  return '反向流水';
}

export function timeLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: RewardRedemptionStatus }) {
  const tone =
    status === 'pending'
      ? 'bg-warm-soft text-warm'
      : status === 'approved'
        ? 'bg-accent-soft text-accent'
        : 'bg-muted text-ink-soft';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {REDEMPTION_STATUS_LABEL[status]}
    </span>
  );
}

/** 每个人的余额：自己的大一点放最前，其他人排在后面。 */
export function BalanceBand({
  accounts,
  meId,
  loading,
}: {
  accounts: PointsAccount[];
  meId: string | undefined;
  loading: boolean;
}) {
  const mine = accounts.find((one) => one.memberId === meId);
  const others = accounts.filter((one) => one.memberId !== meId);
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
      <div className="flex min-w-[150px] shrink-0 items-center gap-3 rounded-card bg-warm-soft px-4 py-3">
        <span className="text-[22px]">🪙</span>
        <span>
          <span className="block text-[12px] text-ink-soft">我的可用积分</span>
          <span className="block text-2xl font-semibold tabular-nums text-warm">
            {loading ? '--' : (mine?.balance ?? 0)}
          </span>
        </span>
      </div>
      {others.map((one) => (
        <div
          key={one.id}
          className="flex min-w-[112px] shrink-0 items-center gap-2.5 rounded-card border border-border bg-surface px-3 py-3"
        >
          <span className="text-xl">{one.member.avatarEmoji}</span>
          <span>
            <span className="block text-[12px] text-ink-soft">{one.member.name}</span>
            <span className="block text-[17px] font-semibold tabular-nums">{one.balance}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function RewardGrid({
  rewards,
  balance,
  manager,
  onRedeem,
  onEdit,
}: {
  rewards: Reward[];
  balance: number;
  manager: boolean;
  onRedeem: (reward: Reward) => void;
  onEdit: (reward: Reward) => void;
}) {
  if (!rewards.length) {
    return (
      <EmptyState
        emoji="🎁"
        title="还没有家庭奖励"
        hint={manager ? '点右上角「新增奖励」，比如「选一次周末电影」' : '等管理员上架奖励就能用积分兑换'}
      />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:items-start">
      {rewards.map((reward) => {
        const affordable = balance >= reward.cost;
        return (
          <article
            key={reward.id}
            aria-label={reward.name}
            className="flex flex-col rounded-card border border-border bg-surface p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="grid size-9 place-items-center rounded-lg bg-warm-soft text-[17px]">🎁</span>
              <span className="rounded-full bg-warm-soft px-2 py-0.5 text-[12px] font-semibold tabular-nums text-warm">
                {reward.cost} 分
              </span>
            </div>
            <h3 className="mt-2.5 text-[15px] font-semibold">{reward.name}</h3>
            <p className="mt-1 line-clamp-3 flex-1 text-[13px] leading-relaxed text-ink-soft">
              {reward.description ?? '管理员确认后履约'}
            </p>
            {reward.isActive ? null : <p className="mt-2 text-[12px] text-danger">已停用</p>}
            <div className="mt-3 flex items-center gap-1.5">
              {reward.isActive ? (
                <Button
                  className="h-9 px-3 text-[13px]"
                  disabled={!affordable}
                  aria-label={`兑换${reward.name}`}
                  onClick={() => onRedeem(reward)}
                >
                  {affordable ? '申请兑换' : `还差 ${reward.cost - balance} 分`}
                </Button>
              ) : null}
              {manager ? (
                <Button
                  variant="ghost"
                  className="h-9 px-2 text-[13px]"
                  aria-label={`编辑${reward.name}`}
                  onClick={() => onEdit(reward)}
                >
                  编辑
                </Button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function RedemptionList({
  redemptions,
  focusedId,
  manager,
  meId,
  onApprove,
  onReject,
  onCancel,
  onReverse,
}: {
  redemptions: RewardRedemption[];
  focusedId: string | null;
  manager: boolean;
  meId: string | undefined;
  onApprove: (one: RewardRedemption) => void;
  onReject: (one: RewardRedemption) => void;
  onCancel: (one: RewardRedemption) => void;
  onReverse: (one: RewardRedemption) => void;
}) {
  if (!redemptions.length) {
    return <EmptyState emoji="🧾" title="没有这样的兑换记录" hint="在「家庭奖励」里申请兑换，记录会出现在这儿" />;
  }
  return (
    <div className="overflow-hidden rounded-card border border-border">
      {redemptions.map((one, index) => (
        <div
          key={one.id}
          className={
            'flex items-start gap-2.5 px-3.5 py-3 ' +
            (index ? 'border-t border-border ' : '') +
            (one.id === focusedId ? 'bg-accent-soft/40' : '')
          }
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[15px]">🎁</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-[14px] font-medium">{one.rewardName}</span>
              <StatusBadge status={one.status} />
            </div>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              {one.member.avatarEmoji} {one.member.name} · {one.cost} 分 · {timeLabel(one.createdAt)}
              {one.handledBy ? ` · ${one.handledBy.name}处理` : ''}
            </p>
            {one.decisionNote ? (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-soft">{one.decisionNote}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {manager && one.status === 'pending' ? (
              <>
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-[13px] text-accent"
                  aria-label={`确认兑换${one.rewardName}`}
                  onClick={() => onApprove(one)}
                >
                  确认
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-[13px] text-danger"
                  aria-label={`拒绝兑换${one.rewardName}`}
                  onClick={() => onReject(one)}
                >
                  拒绝
                </Button>
              </>
            ) : null}
            {one.status === 'pending' && one.memberId === meId ? (
              <Button
                variant="ghost"
                className="h-8 px-2 text-[13px] text-ink-soft"
                aria-label={`取消兑换${one.rewardName}`}
                onClick={() => onCancel(one)}
              >
                取消
              </Button>
            ) : null}
            {manager && one.status === 'approved' ? (
              <Button
                variant="ghost"
                className="h-8 px-2 text-[13px] text-ink-soft"
                aria-label={`撤销兑换${one.rewardName}`}
                onClick={() => onReverse(one)}
              >
                撤销
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LedgerList({
  ledger,
  manager,
  onReverse,
}: {
  ledger: PointsLedger[];
  manager: boolean;
  onReverse: (entry: PointsLedger) => void;
}) {
  if (!ledger.length) {
    return <EmptyState emoji="📜" title="还没有积分流水" hint="完成带积分的任务、或者管理员手工发放，都会记在这儿" />;
  }
  // 已经被反向流水冲掉的，不再给「撤销」按钮
  const reversed = new Set(ledger.map((one) => one.reversesLedgerId).filter(Boolean));
  return (
    <div className="overflow-hidden rounded-card border border-border">
      {ledger.map((entry, index) => {
        const reversible =
          manager && entry.sourceType === 'manual' && entry.type !== 'reversal' && !reversed.has(entry.id);
        return (
          <div
            key={entry.id}
            className={'flex items-start gap-2.5 px-3.5 py-3 ' + (index ? 'border-t border-border' : '')}
          >
            <span
              className={
                'grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ' +
                (entry.delta > 0 ? 'bg-accent-soft text-accent' : 'bg-muted text-ink-soft')
              }
            >
              {entry.delta > 0 ? '+' : '−'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">
                {entry.member.avatarEmoji} {entry.member.name} · {entry.delta > 0 ? '+' : ''}
                {entry.delta}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                {entry.pointsBefore} → {entry.pointsAfter} · {entry.note ?? ledgerTypeLabel(entry.type)} ·{' '}
                {timeLabel(entry.createdAt)}
              </p>
              {reversed.has(entry.id) ? (
                <p className="mt-0.5 text-[12px] text-ink-soft/70">已通过反向流水撤销</p>
              ) : null}
            </div>
            {reversible ? (
              <Button
                variant="ghost"
                className="h-8 shrink-0 px-2 text-[13px] text-ink-soft"
                aria-label={`撤销流水${entry.member.name}${entry.delta}`}
                onClick={() => onReverse(entry)}
              >
                撤销
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
