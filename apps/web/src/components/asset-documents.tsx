import { useState } from 'react';
import type { AssetDocument, HomeAsset } from '@family/contracts';
import {
  ASSET_DOCUMENT_LABELS,
  useAssetDocumentAccess,
  useRemoveAssetDocument,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { DocumentForm } from './asset-document-form';
import { Button, Dialog, Panel } from './ui';

export function AssetDocumentsPanel({ asset }: { asset: HomeAsset }) {
  const access = useAssetDocumentAccess();
  const remove = useRemoveAssetDocument();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AssetDocument | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  async function open(document: AssetDocument) {
    setOpeningId(document.id);
    // 先开一个空标签页再填地址：等接口回来再 window.open 会被浏览器当成弹窗拦掉。
    // 上传的文件拿到的是 60 秒签名地址，所以也不能预先取好存着。
    const tab = window.open('', '_blank', 'noopener,noreferrer');
    try {
      const target = await access.mutateAsync(document.id);
      const url = target.url.startsWith('http') ? target.url : `/api${target.url}`;
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      tab?.close();
      pushToast(error instanceof Error ? error.message : `「${document.title}」暂时打不开`);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <Panel
      title={`凭证与资料 ${asset.documents.length}`}
      grow={false}
      right={
        <Button variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setAdding(true)}>
          + 添加
        </Button>
      }
    >
      {asset.documents.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-[13px] text-ink-soft">
          发票、说明书、保修卡都可以收在这儿。
        </p>
      ) : (
        asset.documents.map((document, index) => (
          <div
            key={document.id}
            aria-label={document.title}
            className={
              'flex items-center gap-1 px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')
            }
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px]">{document.title}</p>
              <p className="text-[12px] text-ink-soft">
                {ASSET_DOCUMENT_LABELS[document.type]} · {document.createdBy.name}
              </p>
            </div>
            <Button
              variant="ghost"
              className="h-8 shrink-0 px-2 text-[13px]"
              aria-label={`打开资料${document.title}`}
              disabled={openingId === document.id}
              onClick={() => void open(document)}
            >
              {openingId === document.id ? '打开中…' : '打开'}
            </Button>
            <Button
              variant="ghost"
              className="h-8 shrink-0 px-2 text-[13px] text-danger"
              aria-label={`删除资料${document.title}`}
              onClick={() => setRemoving(document)}
            >
              删除
            </Button>
          </div>
        ))
      )}

      {adding ? (
        <DocumentForm assetId={asset.id} assetName={asset.name} onClose={() => setAdding(false)} />
      ) : null}

      {removing ? (
        <Dialog
          title={`删除「${removing.title}」？`}
          onClose={() => setRemoving(null)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRemoving(null)}>
                取消
              </Button>
              <Button
                className="flex-1"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    { assetId: asset.id, documentId: removing.id },
                    {
                      onSuccess: () => {
                        setRemoving(null);
                        pushToast('这条资料已删除');
                      },
                    },
                  )
                }
              >
                删除
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            只删这一条资料记录，资产档案和维护历史都不动。上传的文件会一起删掉。
          </p>
        </Dialog>
      ) : null}
    </Panel>
  );
}
