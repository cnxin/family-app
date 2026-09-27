import { useState } from 'react';
import type { BackupPolicy, BackupScheduleFrequency } from '@family/contracts';
import { backupTime, useUpdateBackupPolicy } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Checkbox, Input, Panel, Segmented } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function NumberField({
  name,
  value,
  onChange,
  suffix,
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
  suffix: string;
}) {
  return (
    <label className="block">
      <span className={label}>
        {name}（{suffix}）
      </span>
      <Input
        inputMode="numeric"
        value={String(value)}
        aria-label={name}
        className="h-9"
        onChange={(event) => onChange(Number(event.target.value.replace(/\D/g, '') || 0))}
      />
    </label>
  );
}

export function BackupPolicyPanel({ policy }: { policy: BackupPolicy }) {
  const save = useUpdateBackupPolicy();
  const [form, setForm] = useState({
    scheduleEnabled: policy.scheduleEnabled,
    frequency: policy.frequency,
    weeklyDay: policy.weeklyDay ?? 0,
    scheduledHour: policy.scheduledHour,
    scheduledMinute: policy.scheduledMinute,
    retentionDays: policy.retentionDays,
    retentionCount: policy.retentionCount,
    capacityWarningPercent: policy.capacityWarningPercent,
    capacityCriticalPercent: policy.capacityCriticalPercent,
    restoreDrillEnabled: policy.restoreDrillEnabled,
    restoreDrillDay: policy.restoreDrillDay,
    restoreDrillHour: policy.restoreDrillHour,
  });
  const [message, setMessage] = useState<string | null>(null);

  function patch(next: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function submit() {
    // 后端的边界：警告 1–98、严重 2–99，而且警告必须小于严重；这里先自己拦一遍，
    // 不然回来的是 class-validator 的英文报错
    const checks: [boolean, string][] = [
      [form.scheduledHour >= 0 && form.scheduledHour <= 23, '执行小时填 0 到 23'],
      [form.scheduledMinute >= 0 && form.scheduledMinute <= 59, '执行分钟填 0 到 59'],
      [form.retentionDays >= 1 && form.retentionDays <= 3650, '保留天数填 1 到 3650'],
      [form.retentionCount >= 1 && form.retentionCount <= 365, '保留份数填 1 到 365'],
      [
        form.capacityWarningPercent >= 1 && form.capacityWarningPercent <= 98,
        '容量警告阈值填 1 到 98',
      ],
      [
        form.capacityCriticalPercent >= 2 && form.capacityCriticalPercent <= 99,
        '容量严重阈值填 2 到 99',
      ],
      [form.capacityWarningPercent < form.capacityCriticalPercent, '警告阈值要低于严重阈值'],
      [form.restoreDrillDay >= 1 && form.restoreDrillDay <= 28, '演练日期填 1 到 28'],
      [form.restoreDrillHour >= 0 && form.restoreDrillHour <= 23, '演练小时填 0 到 23'],
    ];
    const bad = checks.find(([ok]) => !ok);
    if (bad) return setMessage(bad[1]);
    setMessage(null);
    save.mutate(
      {
        ...form,
        // 每天备份时星期必须明确置 null，否则后端按每周算
        weeklyDay: form.frequency === 'weekly' ? form.weeklyDay : null,
      },
      {
        onSuccess: () => pushToast('备份策略已保存'),
        onError: (error) => setMessage(error instanceof Error ? error.message : '策略没保存成功'),
      },
    );
  }

  return (
    <Panel title="计划与保留" grow={false}>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={form.scheduleEnabled}
            label="自动完整备份"
            onChange={() => patch({ scheduleEnabled: !form.scheduleEnabled })}
          />
          <span className="text-[13px]">
            自动完整备份 · 下次 {backupTime(policy.nextBackupAt)}
          </span>
        </div>

        <Segmented
          value={form.frequency}
          onChange={(value: BackupScheduleFrequency) => patch({ frequency: value })}
          options={[
            { value: 'daily' as const, label: '每天' },
            { value: 'weekly' as const, label: '每周' },
          ]}
        />

        {form.frequency === 'weekly' ? (
          <div>
            <span className={label}>星期几</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEK.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  aria-label={`星期${name}`}
                  aria-pressed={form.weeklyDay === index}
                  className={
                    'size-8 rounded-full border text-[13px] transition-colors duration-150 ' +
                    (form.weeklyDay === index
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border text-ink-soft hover:bg-muted')
                  }
                  onClick={() => patch({ weeklyDay: index })}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            name="执行小时"
            suffix="时"
            value={form.scheduledHour}
            onChange={(value) => patch({ scheduledHour: value })}
          />
          <NumberField
            name="执行分钟"
            suffix="分"
            value={form.scheduledMinute}
            onChange={(value) => patch({ scheduledMinute: value })}
          />
          <NumberField
            name="保留天数"
            suffix="天"
            value={form.retentionDays}
            onChange={(value) => patch({ retentionDays: value })}
          />
          <NumberField
            name="保留份数"
            suffix="份"
            value={form.retentionCount}
            onChange={(value) => patch({ retentionCount: value })}
          />
          <NumberField
            name="容量警告"
            suffix="%"
            value={form.capacityWarningPercent}
            onChange={(value) => patch({ capacityWarningPercent: value })}
          />
          <NumberField
            name="容量严重"
            suffix="%"
            value={form.capacityCriticalPercent}
            onChange={(value) => patch({ capacityCriticalPercent: value })}
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            checked={form.restoreDrillEnabled}
            label="每月恢复演练"
            onChange={() => patch({ restoreDrillEnabled: !form.restoreDrillEnabled })}
          />
          <span className="text-[13px]">
            每月恢复演练 · 下次 {backupTime(policy.nextRestoreDrillAt)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            name="演练日期"
            suffix="日"
            value={form.restoreDrillDay}
            onChange={(value) => patch({ restoreDrillDay: value })}
          />
          <NumberField
            name="演练小时"
            suffix="时"
            value={form.restoreDrillHour}
            onChange={(value) => patch({ restoreDrillHour: value })}
          />
        </div>

        {message ? <p className="text-[13px] text-danger">{message}</p> : null}
        <Button disabled={save.isPending} onClick={submit}>
          {save.isPending ? '保存中…' : '保存策略'}
        </Button>
      </div>
    </Panel>
  );
}
