import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Button, Input } from '../components/ui';

export function LoginPage() {
  const { signIn } = useAuth();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn({ loginName: loginName.trim(), password });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.status === 401
            ? '账号或密码不对'
            : caught.message
          : '连不上服务器',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-[340px]">
        <h1 className="text-2xl font-semibold tracking-tight">小管家</h1>
        <p className="mt-1.5 text-sm text-ink-soft">用家庭成员账号登录</p>

        <div className="mt-7 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">账号</span>
            <Input
              autoFocus
              autoComplete="username"
              value={loginName}
              placeholder="输入账号"
              onChange={(e) => setLoginName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">密码</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              placeholder="输入密码"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={busy || !loginName.trim()} className="mt-5 w-full">
          {busy ? '登录中…' : '登录'}
        </Button>
      </form>
    </div>
  );
}
