import { ShoppingView } from './shopping-view';

export function ShoppingPage() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 lg:mx-0 lg:px-8 pb-24 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">购物清单</h1>
        <p className="mt-1 text-sm text-ink-soft">这天要买什么，买回来记得入库</p>
      </header>
      <ShoppingView />
    </div>
  );
}
