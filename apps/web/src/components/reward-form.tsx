import { useState } from 'react';
import type { PointsAccount, Reward } from '@family/contracts';
import { idempotencyKey, useAdjustPoints, useUpsertReward } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Checkbox, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';

/** 新建 / 编辑家庭奖励。规则照旧客户端：积分是 1～1000000 的整数，停用只在编辑时能改。 */
export function RewardForm({ editing, onClose }: { editing: Reward | null; onClose: () => void }) {
  const save = useUpsertReward();
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [cost, setCost] = useState(String(editing?.cost ?? 20));
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    const points = Number(cost);
    if (!name.trim()) return setMessage('先给奖励起个名字');
    if (!Number.isInteger(points) || points < 1 || points > 1_000_000) {
      return setMessage('兑换积分要是 1 到 1000000 的整数');
    }
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        body: {
          name: name.trim(),
          description: description.trim() || null,
          cost: points,
          ...(editing ? { isActive } : {}),
        },
      },
      {
        onSuccess: (reward) => {
          pushToast(editing ? '奖励已更新' : `奖励「${reward.name}」已上架`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.name}」` : '新增奖励'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : '保存奖励'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-ink-soft">
          成员申请时先扣积分，管理员没通过会自动退回。
        </p>
        <label className="block">
          <span className={label}>奖励名称</span>
          <Input
            autoFocus
            value={name}
            placeholder="比如：选一次周末电影"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
          />
        </label>
        <label className="block">
          <span className={label}>需要多少积分</span>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={cost}
            placeholder="20"
            onChange={(event) => setCost(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>说明（选填）</span>
          <textarea
            value={description}
            rows={3}
            placeholder="兑换范围、怎么履约、注意什么"
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </label>
        {editing ? (
          <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <Checkbox
              label="上架中"
              checked={isActive}
              onChange={() => setIsActive((value) => !value)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">上架中</span>
              <span className="mt-0.5 block text-[12px] text-ink-soft">
                取消勾选就停用，成员不能再兑换，已有的记录不受影响
              </span>
            </span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** 管理员手工调整某个成员的积分。变化写进不可变流水，错了用反向流水纠正。 */
export function AdjustmentForm({
  accounts,
  onClose,
}: {
  accounts: PointsAccount[];
  onClose: () => void;
}) {
  const adjust = useAdjustPoints();
  const [memberId, setMemberId] = useState(accounts[0]?.memberId ?? '');
  const [delta, setDelta] = useState('10');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const account = accounts.find((one) => one.memberId === memberId);
  const amount = Number(delta);
  const expected = account && Number.isInteger(amount) ? account.balance + amount : null;

  function submit() {
    if (!account) return setMessage('先选一个家庭成员');
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      return setMessage('积分变化要是 -1000000 到 1000000 之间的非零整数');
    }
    if ((expected ?? -1) < 0) return setMessage('调整后的积分不能小于 0');
    setMessage(null);
    adjust.mutate(
      {
        memberId: account.memberId,
        delta: amount,
        note: note.trim() || null,
        idempotencyKey: idempotencyKey(),
      },
      {
        onSuccess: () => {
          pushToast(`${account.member.name} 的积分已${amount > 0 ? '发放' : '扣减'} ${Math.abs(amount)}`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '调整没成功'),
      },
    );
  }

  return (
    <Dialog
      title="调整成员积分"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={adjust.isPending} onClick={submit}>
            {adjust.isPending ? '提交中…' : '确认变动'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-ink-soft">
          变化会写进流水，不能删除；填错了用「撤销」写一条反向流水纠正。
        </p>
        <div>
          <span className={label}>家庭成员</span>
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((one) => (
              <button
                key={one.id}
                type="button"
                aria-pressed={one.memberId === memberId}
                onClick={() => setMemberId(one.memberId)}
                className={
                  'rounded-full border px-3 py-1 text-[13px] transition-colors duration-150 ' +
                  (one.memberId === memberId
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : 'border-border text-ink-soft hover:bg-muted')
                }
              >
                {one.member.avatarEmoji} {one.member.name} · {one.balance}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={label}>积分变化</span>
          <Input
            type="number"
            inputMode="numeric"
            value={delta}
            placeholder="正数发放，负数扣减"
            onChange={(event) => setDelta(event.target.value)}
          />
          {account && expected !== null ? (
            <span className="mt-1 block text-[12px] text-ink-soft">
              {account.balance} {amount >= 0 ? '+' : '-'} {Math.abs(amount)} = {expected}
            </span>
          ) : null}
        </label>
        <label className="block">
          <span className={label}>原因（选填）</span>
          <Input
            value={note}
            placeholder="比如：主动做了额外家务"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}
