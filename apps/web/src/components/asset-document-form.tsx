import { useRef, useState } from 'react';
import type { AssetDocumentType } from '@family/contracts';
import {
  ASSET_DOCUMENT_LABELS,
  useCreateAssetDocument,
  useUploadAssetDocument,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

/** 一条资料要么是外链，要么是上传的文件——选了一个就把另一个清掉，省得保存时还要猜。 */
export function DocumentForm({
  assetId,
  assetName,
  onClose,
}: {
  assetId: string;
  assetName: string;
  onClose: () => void;
}) {
  const createLink = useCreateAssetDocument();
  const upload = useUploadAssetDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<AssetDocumentType>('receipt');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const busy = createLink.isPending || upload.isPending;

  function done() {
    pushToast('资料已收好');
    onClose();
  }
  function fail(error: unknown) {
    setMessage(error instanceof Error ? error.message : '没保存成功');
  }

  function submit() {
    if (!title.trim()) return setMessage('给这份资料起个名字');
    if (!file && !url.trim()) return setMessage('传个文件，或者填一条链接');
    setMessage(null);
    if (file) {
      upload.mutate(
        { assetId, type, title: title.trim(), file },
        { onSuccess: done, onError: fail },
      );
    } else {
      createLink.mutate(
        { assetId, type, title: title.trim(), url: url.trim() },
        { onSuccess: done, onError: fail },
      );
    }
  }

  return (
    <Dialog
      title="添加资产资料"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={busy} onClick={submit}>
            {busy ? '保存中…' : '保存资料'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">{assetName}</p>

        <div>
          <span className={label}>类型</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ASSET_DOCUMENT_LABELS) as AssetDocumentType[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                className={chip(type === value)}
                onClick={() => setType(value)}
              >
                {ASSET_DOCUMENT_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={label}>名称</span>
          <Input
            autoFocus
            value={title}
            maxLength={120}
            aria-label="资料名称"
            placeholder="比如：京东电子发票"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div className="rounded-lg border border-border px-3 py-2.5">
          <span className={label}>上传文件</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            aria-label="选择资料文件"
            onChange={(event) => {
              const picked = event.target.files?.[0] ?? null;
              setFile(picked);
              if (picked) setUrl('');
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9 px-3 text-[13px]"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {file ? '换一个文件' : '选择图片或 PDF'}
            </Button>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">
              {file ? file.name : '不超过 10MB'}
            </span>
          </div>

          <p className="my-2 text-center text-[12px] text-ink-soft">或者</p>

          <label className="block">
            <span className={label}>填一条链接</span>
            <Input
              inputMode="url"
              value={url}
              maxLength={2000}
              aria-label="资料链接"
              placeholder="https://厂商的说明书地址"
              onChange={(event) => {
                setUrl(event.target.value);
                if (event.target.value) setFile(null);
              }}
            />
          </label>
        </div>
      </div>
    </Dialog>
  );
}
