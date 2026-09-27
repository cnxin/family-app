import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { InvitationPreview } from '@family/contracts';
import { useAuth } from '../lib/auth';
import { api, ApiError } from '../lib/api';
import { memberRoleLabel } from '../components/member-editor';
import { Button, Input } from '../components/ui';
import { applyTheme, readTheme } from '../lib/theme';

const MIN_PASSWORD = 8;

/** 从地址里取邀请码：/join?code=…。读完就从地址栏抹掉，不留在浏览记录里。 */
function useInvitationCode() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const [code, setCode] = useState(() => new URLSearchParams(search).get('code')?.trim() ?? '');
  useEffect(() => {
    if (new URLSearchParams(search).has('code')) navigate('/join', { replace: true });
  }, [search, navigate]);
  return [code, setCode] as const;
}

function previewInvitation(invitationToken: string) {
  return api<InvitationPreview>('/auth/invitations/preview', {
    method: 'POST',
    auth: false,
    body: { invitationToken },
  });
}

function previewErrorText(caught: unknown) {
  return caught instanceof ApiError ? '这个邀请码用不了：可能已经用过、被撤销或过期了' : '连不上服务器';
}

/** 邀请兑换：看清是谁邀请进哪个家，设自己的登录名和密码，兑换后直接登录。 */
export function JoinPage() {
  const { session, redeemInvitation } = useAuth();
  // 登录前的页面不在外壳里，自己按这台设备选过的深浅色来。
  useEffect(() => applyTheme(readTheme()), []);
  const navigate = useNavigate();
  const [code, setCode] = useInvitationCode();
  // 地址里带来的邀请码自动看一次；手动粘贴的走「看看这个邀请」。
  const [linkCode] = useState(code);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(linkCode.length >= 32);
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (linkCode.length < 32) return;
    let active = true;
    previewInvitation(linkCode)
      .then((next) => active && setPreview(next))
      .catch((caught) => active && setPreviewError(previewErrorText(caught)))
      .finally(() => active && setChecking(false));
    return () => {
      active = false;
    };
  }, [linkCode]);

  async function check() {
    setChecking(true);
    setPreviewError(null);
    try {
      setPreview(await previewInvitation(code));
    } catch (caught) {
      setPreview(null);
      setPreviewError(previewErrorText(caught));
    } finally {
      setChecking(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`密码至少 ${MIN_PASSWORD} 位`);
    if (password !== confirm) return setError('两次输入的密码不一样');
    setBusy(true);
    setError(null);
    try {
      await redeemInvitation({ invitationToken: code, loginName: loginName.trim(), password });
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '连不上服务器');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-5 py-10">
      <div className="w-full max-w-[360px]">
        <h1 className="text-2xl font-semibold tracking-tight">加入家庭</h1>
        <p className="mt-1.5 text-sm text-ink-soft">用家里人发给你的邀请链接或邀请码</p>

        {session ? (
          <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-[13px] text-ink-soft">
            这台设备已经登录了「{session.member.name}」，加入后会换成新账号。
          </p>
        ) : null}

        {preview ? (
          <div className="mt-6 rounded-xl border border-border bg-surface px-4 py-3" data-invitation-preview>
            <p className="text-[13px] text-ink-soft">{preview.householdName} 邀请你加入</p>
            <p className="mt-1 text-lg font-semibold">
              {preview.avatarEmoji} {preview.memberName}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              {memberRoleLabel(preview.role)} · {new Date(preview.expiresAt).toLocaleString('zh-CN')} 前有效
            </p>
            <p className="mt-2 text-[12px] text-ink-soft">家里怎么称呼你是邀请时定的，进去以后在成员页能改。</p>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">邀请码</span>
              <Input
                autoFocus
                value={code}
                placeholder="粘贴邀请码"
                onChange={(e) => setCode(e.target.value.trim())}
              />
            </label>
            {previewError ? (
              <p role="alert" className="text-[13px] text-danger">{previewError}</p>
            ) : null}
            <Button
              variant="outline"
              disabled={checking || code.length < 32}
              onClick={() => void check()}
            >
              {checking ? '正在看…' : '看看这个邀请'}
            </Button>
          </div>
        )}

        {preview ? (
          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">登录名（以后用它登录）</span>
              <Input
                autoFocus
                autoComplete="username"
                value={loginName}
                maxLength={64}
                placeholder="比如 mama"
                onChange={(e) => setLoginName(e.target.value)}
              />
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
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-soft">再输一次密码</span>
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
            <Button type="submit" disabled={busy || loginName.trim().length < 2 || !password}>
              {busy ? '加入中…' : '加入并登录'}
            </Button>
          </form>
        ) : null}

        <p className="mt-6 text-center text-[13px] text-ink-soft">
          已经有账号？<Link to="/" className="text-accent">去登录</Link>
        </p>
      </div>
    </div>
  );
}
