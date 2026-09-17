import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Segmented } from '../components/ui';
import { ShoppingView } from './shopping-view';
import { InventoryView } from './inventory-view';

type View = 'shopping' | 'inventory';

/**
 * 采购和库存是一件事的两头：清单买回来要入库，库存不够要进清单，
 * 所以跟旧客户端一样放在同一页用分段控件切，而不是拆成两个导航位。
 */
export function SuppliesPage() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(params.get('view') === 'inventory' ? 'inventory' : 'shopping');

  const change = (next: View) => {
    setView(next);
    setParams(next === 'inventory' ? { view: 'inventory' } : {}, { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-24 pt-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">采购与库存</h1>
          <p className="mt-1 text-sm text-ink-soft">买什么、家里还有什么，都在这儿</p>
        </div>
        <Segmented
          value={view}
          onChange={change}
          options={[
            { value: 'shopping', label: '购物清单' },
            { value: 'inventory', label: '家庭库存' },
          ]}
        />
      </header>

      {view === 'shopping' ? <ShoppingView /> : <InventoryView />}
    </div>
  );
}
