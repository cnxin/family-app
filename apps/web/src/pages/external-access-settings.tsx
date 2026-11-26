import { useAuth } from '../lib/auth';
import { useExternalAccessSettings } from '../lib/queries';
import { ExternalAccessConnectorCard } from '../components/external-access-connector';
import { QueryFrame } from '../components/query-state';
import { ListSkeleton } from '../components/skeleton';
import { SoftLink } from '../components/soft-link';
import { EmptyState, Page, Panel } from '../components/ui';

/** /house/external-access/settings：配置 Tailscale 控制面只读凭据、节点名与外部入口地址（仅管理员）。 */
export function ExternalAccessSettingsPage() {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const settings = useExternalAccessSettings(manager);

  if (!manager) {
    return (
      <Page title="外部访问设置" subtitle="连接 Tailscale 控制面 · 节点与入口自检">
        <Panel className="p-3">
          <EmptyState
            emoji="🔐"
            title="这一页只有家庭管理员能改"
            hint="里面是 Tailscale 控制面的只读凭据与外部访问地址"
          />
        </Panel>
      </Page>
    );
  }

  return (
    <Page
      title="外部访问设置"
      subtitle="配置只读控制面凭据（OAuth 优先）、小管家节点名与外部访问地址"
      actions={
        <SoftLink
          to="/house/external-access"
          className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3.5 text-sm transition-colors duration-150 hover:bg-muted"
        >
          返回概览
        </SoftLink>
      }
    >
      <QueryFrame query={settings} skeleton={<Panel className="p-3"><ListSkeleton rows={4} /></Panel>}>
        {settings.data ? (
          <>
            <div className="flex min-h-0 flex-col gap-4 lg:w-[460px] lg:shrink-0">
              <ExternalAccessConnectorCard
                key={`${session?.member.householdId ?? 'none'}:${session?.member.id ?? 'none'}`}
                settings={settings.data}
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Panel title="接入步骤与安全边界" grow={false}>
                <ol className="flex flex-col gap-3 px-4 py-3.5 text-[13px] leading-relaxed text-ink-soft">
                  <li>
                    <span className="font-medium text-ink">1. 宿主机开启 Tailscale Serve</span>
                    <p className="mt-0.5">
                      在 Mac mini 宿主机（非容器）运行{' '}
                      <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-ink">
                        tailscale up --hostname=xiaoguanjia --accept-dns=false
                      </code>{' '}
                      与{' '}
                      <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-ink">
                        tailscale serve --bg --https=443 http://127.0.0.1:8089
                      </code>
                      ，仅面向 tailnet 内部开放，不开启 Funnel。
                    </p>
                  </li>
                  <li>
                    <span className="font-medium text-ink">2. 创建只读 OAuth 客户端</span>
                    <p className="mt-0.5">
                      在 Tailscale 控制台的 OAuth clients 新建客户端，仅授予{' '}
                      <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-ink">
                        devices:core:read
                      </code>{' '}
                      权限。凭据加密保存在服务端，页面永不回显明文。
                    </p>
                  </li>
                  <li>
                    <span className="font-medium text-ink">3. 核对 CORS 与代理层数</span>
                    <p className="mt-0.5">
                      生产环境 <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-ink">deploy/.env.production</code>{' '}
                      需设置 <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-ink">TRUST_PROXY_HOPS=2</code>，
                      并将外部地址加入 <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-ink">CORS_ORIGINS</code>。
                    </p>
                  </li>
                  <li>
                    <span className="font-medium text-ink">4. 阶段 1 只读原则</span>
                    <p className="mt-0.5">
                      小管家不接触宿主机 tailscaled socket、不修改 ACL 策略，也不以 Tailscale 身份代替家庭账号登录；
                      授权设备、移除设备或调整 ACL 请直接在 Tailscale 控制台完成。
                    </p>
                  </li>
                </ol>
              </Panel>
            </div>
          </>
        ) : null}
      </QueryFrame>
    </Page>
  );
}
