import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { useUpdatePassword } from '../lib/queries';
import { Button, Input } from '../components/ui';
import { applyTheme, readTheme } from '../lib/theme';

/**
 * 首次登录强制设密码（C2 批 2）：迁移来的老账号用登录名 + 空密码进来后只能看到这一页，
 * 服务端除了设密码和退出登录都回 403 PASSWORD_SETUP_REQUIRED。设好后更新会话、进首页。
 */
export function SetPasswordPage() {
  const { session, signOut, updateAccount } = useAuth();
  const update = useUpdatePassword();
  const navigate = useNavigate();
  // 不在外壳里，自己按这台设备选过的深浅色来（同登录页）
  useEffect(() => applyTheme(readTheme()), []);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (next.length < 8) return setError('至少 8 位');
    if (next !== confirm) return setError('两次输入的不一样');
    setError(null);
    update.mutate(
      { newPassword: next },
      {
        onSuccess: (account) => {
          navigator.vibrate?.(10);
          updateAccount(account);
          navigate('/', { replace: true });
        },
        onError: (caught) => setError(caught instanceof ApiError ? caught.message : '连不上服务器'),
      },
    );
  }

  return (
    <div className="grid min-h-full place-items-center px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-[340px] motion-safe:animate-[page-in_190ms_cubic-bezier(0,0,0.2,1)]">
        <h1 className="text-2xl font-semibold tracking-tight">设个密码</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {session?.member.name ? `${session.member.name}，这` : '这'}是你第一次登录。给账号设个密码，以后用它登录。
        </p>

        <div className="mt-7 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">新密码（至少 8 位）</span>
            <Input
              autoFocus
              type="password"
              autoComplete="new-password"
              value={next}
              aria-label="新密码"
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">再输一次</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              aria-label="再输一次新密码"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={update.isPending || !next || !confirm} className="mt-5 w-full">
          {update.isPending ? '保存中…' : '设好了'}
        </Button>
        <p className="mt-6 text-center text-[13px] text-ink-soft">
          不是你的账号？
          <button type="button" className="text-accent" onClick={() => void signOut()}>
            换个账号登录
          </button>
        </p>
      </form>
    </div>
  );
}
