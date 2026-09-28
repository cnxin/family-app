import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useSmartHomeConnectorSettings } from '../lib/queries';
import { QueryFrame } from '../components/query-state';
import { ListSkeleton } from '../components/skeleton';
import { SmartHomeCommandsPanel } from '../components/smart-home-commands';
import { SmartHomeConnectorCard } from '../components/smart-home-connector';
import { SmartHomeDirectoryPanel } from '../components/smart-home-directory';
import { SmartHomeWhitelistPanel } from '../components/smart-home-devices';
import { SmartHomeLinkagesSection } from '../components/smart-home-linkages';
import { EmptyState, Page, Panel, Segmented } from '../components/ui';

type Section = 'devices' | 'linkages';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'devices', label: '连接与设备' },
  { value: 'linkages', label: '联动' },
];

/** /house/smart-home/settings：连 HA、挑白名单；HA → 小管家的联动（?section=linkages）。只有管理员。 */
export function SmartHomeSettingsPage() {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const settings = useSmartHomeConnectorSettings(manager);
  const [params, setParams] = useSearchParams();
  const section: Section = params.get('section') === 'linkages' ? 'linkages' : 'devices';

  if (!manager) {
    return (
      <Page title="智能家居设置" subtitle="连接 Home Assistant · 挑设备 · 联动">
        <Panel className="p-3">
          <EmptyState emoji="🔐" title="这一页只有家庭管理员能改" hint="里面是 Home Assistant 的地址和令牌" />
        </Panel>
      </Page>
    );
  }

  return (
    <Page
      title="智能家居设置"
      subtitle={
        section === 'devices'
          ? '连上 Home Assistant，挑几样家里人常看的设备，起个中文名'
          : '家电完成了事，小管家接着安排通知、家务、购物清单；家务和日程也能反过来让设备动一下'
      }
      toolbar={
        <Segmented<Section>
          value={section}
          options={SECTIONS}
          onChange={(value) => setParams(value === 'devices' ? {} : { section: value }, { replace: true })}
        />
      }
    >
      {section === 'linkages' ? (
        <SmartHomeLinkagesSection />
      ) : (
        <QueryFrame query={settings} skeleton={<Panel className="p-3"><ListSkeleton rows={3} /></Panel>}>
          {settings.data ? (
            <>
              <div className="flex min-h-0 flex-col gap-4 lg:w-[420px] lg:shrink-0">
                <SmartHomeConnectorCard settings={settings.data} />
                <SmartHomeWhitelistPanel />
                <SmartHomeCommandsPanel />
              </div>
              <div className="flex min-h-[420px] min-w-0 flex-1 flex-col">
                <SmartHomeDirectoryPanel configured={settings.data.configured} />
              </div>
            </>
          ) : null}
        </QueryFrame>
      )}
    </Page>
  );
}
