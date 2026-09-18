import { useState } from 'react';
import type { AssetCategory, AssetRenewalIntervalMonths, HomeAsset } from '@family/contracts';
import {
  ASSET_CATEGORY_LABELS,
  WARRANTY_CATEGORIES,
  shiftDays,
  todayISO,
  useUpsertAsset,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Checkbox, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

const INTERVALS: { value: AssetRenewalIntervalMonths; label: string }[] = [
  { value: 1, label: '月付' },
  { value: 3, label: '季付' },
  { value: 6, label: '半年' },
  { value: 12, label: '年付' },
];

/** 可选日期：先勾「记录…」再出日期框——不勾就是明确的 null，不是「忘了填」。 */
function OptionalDate({
  name,
  enabled,
  onToggle,
  value,
  onChange,
}: {
  name: string;
  enabled: boolean;
  onToggle: () => void;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Checkbox checked={enabled} onChange={onToggle} label={`记录${name}`} />
        <span className="text-[13px]">记录{name}</span>
      </div>
      {enabled ? (
        <Input
          type="date"
          value={value}
          aria-label={name}
          className="mt-2"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}

export function AssetForm({ editing, onClose }: { editing: HomeAsset | null; onClose: () => void }) {
  const save = useUpsertAsset();
  const [name, setName] = useState(editing?.name ?? '');
  const [category, setCategory] = useState<AssetCategory>(editing?.category ?? 'appliance');
  const [location, setLocation] = useState(editing?.location ?? '');
  const [brand, setBrand] = useState(editing?.brand ?? '');
  const [model, setModel] = useState(editing?.model ?? '');
  const [serialNumber, setSerialNumber] = useState(editing?.serialNumber ?? '');
  const [purchaseOn, setPurchaseOn] = useState(Boolean(editing?.purchaseDate));
  const [purchaseDate, setPurchaseDate] = useState(editing?.purchaseDate ?? todayISO());
  const [purchasePrice, setPurchasePrice] = useState(
    editing?.purchasePrice ? String(Number(editing.purchasePrice)) : '',
  );
  const [warrantyOn, setWarrantyOn] = useState(Boolean(editing?.warrantyExpiresOn));
  const [warrantyExpiresOn, setWarrantyExpiresOn] = useState(
    editing?.warrantyExpiresOn ?? shiftDays(todayISO(), 365),
  );
  const [renewalOn, setRenewalOn] = useState(Boolean(editing?.renewsOn));
  const [renewsOn, setRenewsOn] = useState(editing?.renewsOn ?? shiftDays(todayISO(), 30));
  const [renewInterval, setRenewInterval] = useState<AssetRenewalIntervalMonths>(
    editing?.renewalIntervalMonths ?? 1,
  );
  const [note, setNote] = useState(editing?.note ?? '');
  const [message, setMessage] = useState<string | null>(null);

  const price = purchasePrice.trim() ? Number(purchasePrice) : null;
  const isSubscription = category === 'subscription';
  const hasWarranty = WARRANTY_CATEGORIES.includes(category);

  function submit() {
    if (!name.trim()) return setMessage('先给这件东西起个名字');
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return setMessage('购买价格填个数字');
    }
    setMessage(null);
    // 每次都发全字段：把分类改成家电时，原来的续费信息要被显式清成 null，
    // 不然订阅那套日期会留在库里，详情页还按订阅算。
    save.mutate(
      {
        id: editing?.id,
        body: {
          name: name.trim(),
          category,
          location: location.trim() || null,
          brand: brand.trim() || null,
          model: model.trim() || null,
          serialNumber: serialNumber.trim() || null,
          purchaseDate: purchaseOn ? purchaseDate : null,
          purchasePrice: purchaseOn ? price : null,
          warrantyExpiresOn: hasWarranty && warrantyOn ? warrantyExpiresOn : null,
          renewsOn: isSubscription && renewalOn ? renewsOn : null,
          renewalIntervalMonths: isSubscription && renewalOn ? renewInterval : null,
          note: note.trim() || null,
        },
      },
      {
        onSuccess: (saved) => {
          pushToast(editing ? `「${saved.name}」的档案已更新` : `已登记「${saved.name}」`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.name}」` : '登记家庭资产'}
      maxWidth={560}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : '保存资产'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>名称</span>
          <Input
            autoFocus
            value={name}
            maxLength={120}
            aria-label="资产名称"
            placeholder="比如：客厅空调"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <div>
          <span className={label}>分类</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ASSET_CATEGORY_LABELS) as AssetCategory[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                className={chip(category === value)}
                onClick={() => setCategory(value)}
              >
                {ASSET_CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>存放位置</span>
            <Input
              value={location}
              maxLength={80}
              aria-label="存放位置"
              placeholder="客厅、厨房"
              onChange={(event) => setLocation(event.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>品牌</span>
            <Input
              value={brand}
              maxLength={80}
              aria-label="品牌"
              placeholder="选填"
              onChange={(event) => setBrand(event.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>型号</span>
            <Input
              value={model}
              maxLength={120}
              aria-label="型号"
              placeholder="选填"
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>序列号</span>
            <Input
              value={serialNumber}
              maxLength={120}
              aria-label="序列号"
              placeholder="选填"
              onChange={(event) => setSerialNumber(event.target.value)}
            />
          </label>
        </div>

        <div className="rounded-lg border border-border px-3 py-2.5">
          <OptionalDate
            name="购买日期"
            enabled={purchaseOn}
            onToggle={() => setPurchaseOn(!purchaseOn)}
            value={purchaseDate}
            onChange={setPurchaseDate}
          />
          {purchaseOn ? (
            <label className="mt-2 block">
              <span className={label}>购买价格（选填）</span>
              <Input
                inputMode="decimal"
                value={purchasePrice}
                aria-label="购买价格"
                placeholder="3299"
                onChange={(event) => setPurchasePrice(event.target.value)}
              />
            </label>
          ) : null}
        </div>

        {isSubscription ? (
          <div className="rounded-lg border border-border px-3 py-2.5">
            <OptionalDate
              name="续费日期"
              enabled={renewalOn}
              onToggle={() => setRenewalOn(!renewalOn)}
              value={renewsOn}
              onChange={setRenewsOn}
            />
            {renewalOn ? (
              <div className="mt-2">
                <span className={label}>续费周期</span>
                <div className="flex flex-wrap gap-1.5">
                  {INTERVALS.map((one) => (
                    <button
                      key={one.value}
                      type="button"
                      aria-pressed={renewInterval === one.value}
                      className={chip(renewInterval === one.value)}
                      onClick={() => setRenewInterval(one.value)}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : hasWarranty ? (
          <div className="rounded-lg border border-border px-3 py-2.5">
            <OptionalDate
              name="保修到期日"
              enabled={warrantyOn}
              onToggle={() => setWarrantyOn(!warrantyOn)}
              value={warrantyExpiresOn}
              onChange={setWarrantyExpiresOn}
            />
          </div>
        ) : null}

        <label className="block">
          <span className={label}>备注（选填）</span>
          <textarea
            value={note}
            rows={3}
            maxLength={1000}
            placeholder="安装信息、注意事项等"
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </label>
      </div>
    </Dialog>
  );
}
