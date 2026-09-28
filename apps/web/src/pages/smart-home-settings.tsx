import { useAuth } from '../lib/auth';
import { useSmartHomeConnectorSettings } from '../lib/queries';
import { QueryFrame } from '../components/query-state';
import { ListSkeleton } from '../components/skeleton';
import { SmartHomeConnectorCard } from '../components/smart-home-connector';
import { SmartHomeDirectoryPanel } from '../components/smart-home-directory';
import { SmartHomeWhitelistPanel } from '../components/smart-home-devices';
import { EmptyState, Page, Panel } from '../components/ui';

/** /house/smart-home/settings：连 HA、挑白名单、起中文名。只有管理员。 */
export function SmartHomeSettingsPage() {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const settings = useSmartHomeConnectorSettings(manager);

  if (!manager) {
    return (
      <Page title="智能家居设置" subtitle="连接 Home Assistant · 挑设备">
        <Panel className="p-3">
          <EmptyState emoji="🔐" title="这一页只有家庭管理员能改" hint="里面是 Home Assistant 的地址和令牌" />
        </Panel>
      </Page>
    );
  }

  return (
    <Page title="智能家居设置" subtitle="连上 Home Assistant，挑几样家里人常看的设备，起个中文名">
      <QueryFrame query={settings} skeleton={<Panel className="p-3"><ListSkeleton rows={3} /></Panel>}>
        {settings.data ? (
          <>
            <div className="flex min-h-0 flex-col gap-4 lg:w-[420px] lg:shrink-0">
              <SmartHomeConnectorCard settings={settings.data} />
              <SmartHomeWhitelistPanel />
            </div>
            <div className="flex min-h-[420px] min-w-0 flex-1 flex-col">
              <SmartHomeDirectoryPanel configured={settings.data.configured} />
            </div>
          </>
        ) : null}
      </QueryFrame>
    </Page>
  );
}
