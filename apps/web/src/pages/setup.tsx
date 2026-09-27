import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AuthSetupStatus } from '@family/contracts';
import { useAuth } from '../lib/auth';
import { api, ApiError } from '../lib/api';
import { Button, Input } from '../components/ui';
import { applyTheme, readTheme } from '../lib/theme';

const MIN_PASSWORD = 8;

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** 首次初始化：服务器上还没有任何家庭时，建家庭和第一位管理员。家庭时区默认取浏览器的。 */
export function SetupPage() {
  const { bootstrap } = useAuth();
  // 登录前的页面不在外壳里，自己按这台设备选过的深浅色来。
  useEffect(() => applyTheme(readTheme()), []);
  const navigate = useNavigate();
  const [status, setStatus] = useState<AuthSetupStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [secret, setSecret] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<AuthSetupStatus>('/auth/setup/status', { auth: false })
      .then((next) => active && setStatus(next))
      .catch(() => active && setStatusError(true));
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`密码至少 ${MIN_PASSWORD} 位`);
    setBusy(true);
    setError(null);
    try {
      await bootstrap({
        bootstrapSecret: secret.trim(),
        householdName: householdName.trim(),
        ownerName: ownerName.trim(),
        loginName: loginName.trim(),
        password,
        timezone: browserTimezone(),
      });
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '连不上服务器');
    } finally {
      setBusy(false);
    }
  }

  const ready =
    secret.trim().length >= 16 &&
    householdName.trim() &&
    ownerName.trim() &&
    loginName.trim().length >= 2 &&
    password.length > 0;

  return (
    <div className="grid min-h-full place-items-center px-5 py-10">
      <div className="w-full max-w-[360px]">
        <h1 className="text-2xl font-semibold tracking-tight">建立家庭空间</h1>
        <p className="mt-1.5 text-sm text-ink-soft">第一次使用：建好家庭和第一位管理员</p>

        {statusError ? (
          <p role="alert" className="mt-6 text-[13px] text-danger">连不上服务器，稍后刷新再试。</p>
        ) : null}

        {status?.initialized ? (
          <div className="mt-6 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] text-ink-soft" data-setup-done>
            这台服务器上的家庭已经建好了。有账号就去登录，还没有就找家里的管理员要一个邀请。
            <div className="mt-3 flex gap-3">
              <Link to="/" className="text-accent">去登录</Link>
              <Link to="/join" className="text-accent">用邀请码加入</Link>
            </div>
          </div>
        ) : null}

        {status && !status.initialized ? (
          <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">初始化密钥</span>
              <Input
                autoFocus
                type="password"
                autoComplete="off"
                value={secret}
                placeholder="部署时 deploy/secrets 里的 bootstrap_secret"
                onChange={(e) => setSecret(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">家庭名</span>
              <Input value={householdName} maxLength={64} placeholder="比如 我们家" onChange={(e) => setHouseholdName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">家里怎么称呼你</span>
              <Input value={ownerName} maxLength={64} placeholder="比如 爸爸" onChange={(e) => setOwnerName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">登录名</span>
              <Input autoComplete="username" value={loginName} maxLength={64} onChange={(e) => setLoginName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">密码</span>
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                placeholder={`至少 ${MIN_PASSWORD} 位`}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p className="text-[12px] text-ink-soft">家庭时区先用这台设备的（{browserTimezone() ?? '上海'}），以后在家庭设置里能改。</p>
            {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
            <Button type="submit" disabled={busy || !ready}>
              {busy ? '建立中…' : '建立家庭并登录'}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
