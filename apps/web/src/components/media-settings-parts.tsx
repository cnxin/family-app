import type { ReactNode } from 'react';
import type { MediaSettingsMode } from '@family/contracts';
import { Checkbox, Input } from './ui';

/* 三块设置（媒体服务 / 搜索数据源 / 用户映射）长得一样：一张卡、一排状态、
   几个输入框、一个「只写不读」的凭据框。共用的零件放这儿，三个文件都不用各写一遍。 */

export const fieldLabel = 'mb-1 block text-[12px] text-ink-soft';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className={fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

/** 卡片右上角那颗状态点：停用 > 已配置 > 待配置，和旧版一致。 */
export function SettingsBadge({ enabled, configured }: { enabled: boolean; configured: boolean }) {
  const [text, tone] = !enabled
    ? ['已停用', 'bg-muted text-ink-soft']
    : configured
      ? ['已配置', 'bg-accent-soft text-accent']
      : ['待配置', 'bg-warm-soft text-warm'];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${tone}`}>{text}</span>;
}

export function modeLabel(mode: MediaSettingsMode) {
  return mode === 'household' ? '家庭设置' : '服务器默认';
}

/** 开关行：新客户端没有原生 Switch，用 Checkbox 表示「开着没」，读屏也听得懂。 */
export function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <span className="text-[13px]">{label}</span>
      <Checkbox checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </div>
  );
}

/**
 * 凭据框。后端永远只回「配没配」和一小段提示，不回明文，所以这里是只写不读：
 * 输入框永远从空开始，留空就是「不改」，要删得显式勾「清除现有凭据」。
 */
export function CredentialField({
  name,
  label,
  configured,
  hint,
  value,
  onChange,
  clearing,
  onToggleClear,
  disabled,
}: {
  name: string;
  label: string;
  configured: boolean;
  hint: string | null;
  value: string;
  onChange: (value: string) => void;
  clearing: boolean;
  onToggleClear: () => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-ink-soft">{label}</span>
        {configured ? (
          <span className="truncate text-[11px] text-accent">🔑 {hint ?? '已配置'}</span>
        ) : null}
      </div>
      <Input
        type="password"
        autoComplete="off"
        aria-label={`${name} ${label}`}
        placeholder={configured ? '已配置，留空就是不改' : label}
        disabled={disabled || clearing}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {configured ? (
        <div className="mt-2 flex items-center gap-2">
          <Checkbox
            checked={clearing}
            disabled={disabled}
            onChange={onToggleClear}
            label={`清除 ${name} 现有凭据`}
          />
          <span className={`text-[12px] ${clearing ? 'text-danger' : 'text-ink-soft'}`}>
            清除现有凭据
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** 保存/测试的结果就地回显一行，成功绿色失败红色——和旧版一样不弹窗。 */
export function ResultLine({ message, ok }: { message: string; ok: boolean }) {
  return (
    <p aria-live="polite" className={`text-[12px] ${ok ? 'text-accent' : 'text-danger'}`}>
      {message}
    </p>
  );
}
