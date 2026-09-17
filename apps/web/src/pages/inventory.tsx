import { InventoryView } from './inventory-view';

export function InventoryPage() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-24 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">家庭库存</h1>
        <p className="mt-1 text-sm text-ink-soft">家里还有什么，不够了会提醒补货</p>
      </header>
      <InventoryView />
    </div>
  );
}
