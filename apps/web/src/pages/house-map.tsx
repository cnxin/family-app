import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useHouseholdMap, useLocations } from '../lib/queries';
import { useMediaQuery } from '../lib/use-media-query';
import { MapPane } from '../components/map/map-pane';
import { MapTree } from '../components/map/map-tree';
import { MapEditor } from '../components/map/editor/map-editor';
import { QueryFrame } from '../components/query-state';
import { SoftLink } from '../components/soft-link';
import { Skeleton } from '../components/skeleton';
import { Button, EmptyState, Page, Segmented, buttonClass } from '../components/ui';
import { api } from '../lib/api';
import { pushToast } from '../lib/toast';
import type { HouseholdMapExport } from '@family/contracts';

/**
 * /house/map：家庭地图（item-location-plan §3 I2b）。位置管理页与地图合并为一页（拍板 §6 第 2 条）：
 * 桌面左树右图；手机上「地图 / 清单」二选一——家里人看地图找东西，树只在「清单」里。
 * 看模式全家可用；「编辑地图」只对管理员显示，进的是全屏编辑器（地图编辑器 v2，?edit=1：后退 = 完成）。
 * 深链：?focus=<位置 id> 对准并打开那个位置；?q=<物品名> 预填搜索并高亮（⌘K、库存 / 资产详情用）。
 */
export function HouseMapPage() {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const desktop = useMediaQuery('(min-width: 1024px)');
  const map = useHouseholdMap();
  const locations = useLocations(false);
  const [params, setParams] = useSearchParams();
  const [initial] = useState(() => ({ focus: params.get('focus'), q: params.get('q') ?? '' }));
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'map' | 'list' | null>(initial.focus || initial.q ? 'map' : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(
    initial.focus ? { id: initial.focus, seq: 1 } : null,
  );

  // 深链参数读一次就抹掉，刷新 / 返回不再重复对准
  useEffect(() => {
    if (!params.has('focus') && !params.has('q')) return;
    const next = new URLSearchParams(params);
    next.delete('focus');
    next.delete('q');
    setParams(next, { replace: true });
    // 只在进页面时抹一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMap = Boolean(map.data);
  // 地图还在加载时先按「地图」摆（那一栏出骨架），不然每次进来先闪一下清单再翻过去
  const activeTab = tab ?? (hasMap || map.isPending ? 'map' : 'list');
  const editing = manager && hasMap && params.get('edit') === '1';
  // 进编辑压一条历史：手机返回手势 / 浏览器后退就等于点「完成」，不会直接离开地图页
  const enterEdit = () => {
    setSelectedId(null);
    setTab('map');
    const next = new URLSearchParams(params);
    next.set('edit', '1');
    setParams(next, { state: { fromMap: true } });
  };
  const leaveEdit = () => {
    if ((location.state as { fromMap?: boolean } | null)?.fromMap) navigate(-1);
    else {
      const next = new URLSearchParams(params);
      next.delete('edit');
      setParams(next, { replace: true });
    }
  };
  const pickFromTree = (id: string | null) => {
    setSelectedId(id);
    if (id && desktop) setFocusRequest((current) => ({ id, seq: (current?.seq ?? 0) + 1 }));
  };

  const editButton = (
    <Button className="min-h-10" onClick={enterEdit}>
      编辑地图
    </Button>
  );

  const mapArea = (
    <QueryFrame query={map} skeleton={<Skeleton className="h-full min-h-[360px] w-full rounded-card" />}>
      {map.data ? (
        <MapPane
          key={map.data.id}
          map={map.data}
          locations={locations.data ?? []}
          desktop={desktop}
          selectedId={selectedId}
          onSelect={setSelectedId}
          initialQuery={initial.q}
          focusRequest={locations.data ? focusRequest : null}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center rounded-card border border-border bg-surface">
          <EmptyState
            emoji="🗺️"
            title="还没有家庭地图"
            hint={manager ? '把扫地机 App 里的地图截个图传上来，框出房间就行；先用左边的清单也可以' : '管理员还没画地图，先在「清单」里按房间找'}
          />
          {manager ? (
            <SoftLink to="/house/map/import" className={buttonClass('primary', 'mb-8')}>导入扫地机截图</SoftLink>
          ) : null}
        </div>
      )}
    </QueryFrame>
  );

  return (
    <Page
      title="地图"
      subtitle={desktop ? '东西上次放在哪：点房间看柜子，输名字在图上高亮' : undefined}
      actions={
        manager && desktop ? (
          <div className="flex flex-wrap items-center gap-2">
            {hasMap ? editButton : null}
            {hasMap ? (
              <SoftLink to="/house/map/import" className={buttonClass('ghost', 'min-h-10 border border-border')}>重新导入</SoftLink>
            ) : null}
            {hasMap ? (
              <Button variant="ghost" className="min-h-10 border border-border" onClick={() => void exportMap()}>导出</Button>
            ) : null}
          </div>
        ) : null
      }
      toolbar={
        desktop ? null : (
          <div className="flex items-center justify-between gap-2">
            <Segmented
              label="地图或清单"
              value={activeTab}
              onChange={(value) => {
                setTab(value);
                setSelectedId(null);
              }}
              options={[{ value: 'map', label: '地图' }, { value: 'list', label: '清单' }]}
            />
            {manager && hasMap && activeTab === 'map' ? editButton : null}
          </div>
        )
      }
    >
      {desktop ? (
        <div className="flex min-h-[560px] w-full flex-1 gap-4">
          <div className="flex w-[360px] flex-none flex-col">
            <MapTree manager={manager} selectedId={selectedId} onSelect={pickFromTree} withContents={!hasMap} narrow={hasMap} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">{mapArea}</div>
        </div>
      ) : activeTab === 'map' ? (
        <FillHeight className="flex min-h-[360px] w-full flex-col">{mapArea}</FillHeight>
      ) : (
        <MapTree manager={manager} selectedId={selectedId} onSelect={setSelectedId} withContents />
      )}
      {editing && map.data ? (
        <MapEditor map={map.data} locations={locations.data ?? []} desktop={desktop} onDone={leaveEdit} />
      ) : null}
    </Page>
  );
}

/** I2c：地图 + 所有位置的形状 + 底图，存成一个 JSON 文件（备份不靠它，uploads 本来就在备份里） */
async function exportMap() {
  try {
    const data = await api<HouseholdMapExport>('/map/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `家庭地图-${data.exportedAt.slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    pushToast(error instanceof Error ? error.message : '导出失败');
  }
}

/** 手机上地图占满到底部标签栏之上：按自己在屏幕上的位置量出剩余高度（转屏、键盘收起时重量）。 */
function FillHeight({ className, children }: { className: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const top = box.current?.getBoundingClientRect().top ?? 0;
      const tabs = document.querySelector('nav[aria-label="主导航"]')?.getBoundingClientRect().height ?? 56;
      setHeight(Math.round(window.innerHeight - top - tabs - 12 + window.scrollY));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return (
    <div ref={box} className={className} style={height ? { height } : undefined}>
      {children}
    </div>
  );
}
