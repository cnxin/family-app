import { useState } from 'react';
import type { KnowledgeArticle } from '@family/contracts';
import {
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_CHANGE_LABELS,
  knowledgeKey,
  useKnowledgeRevisions,
  useRestoreKnowledgeRevision,
  useSetKnowledgeArchived,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog } from './ui';

function stamp(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function KnowledgeDetail({
  article,
  onChanged,
  onEdit,
  onClose,
}: {
  article: KnowledgeArticle;
  onChanged: (article: KnowledgeArticle) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [asking, setAsking] = useState<{ kind: 'archive' } | { kind: 'revision'; version: number } | null>(
    null,
  );
  const revisions = useKnowledgeRevisions(showHistory ? article.id : undefined);
  const setArchived = useSetKnowledgeArchived();
  const restore = useRestoreKnowledgeRevision();

  const archived = Boolean(article.archivedAt);
  const busy = setArchived.isPending || restore.isPending;

  function confirm() {
    if (!asking) return;
    if (asking.kind === 'archive') {
      setArchived.mutate(
        {
          id: article.id,
          archived: !archived,
          expectedVersion: article.version,
          idempotencyKey: knowledgeKey(`knowledge:${archived ? 'restore' : 'archive'}:${article.id}`),
        },
        {
          onSuccess: (saved) => {
            setAsking(null);
            onChanged(saved);
            pushToast(archived ? '已经恢复回「使用中」' : '已归档，置顶也一起取消了');
          },
        },
      );
    } else {
      restore.mutate(
        {
          id: article.id,
          version: asking.version,
          expectedVersion: article.version,
          idempotencyKey: knowledgeKey(`knowledge:restore-revision:${article.id}:${asking.version}`),
        },
        {
          onSuccess: (saved) => {
            setAsking(null);
            setShowHistory(false);
            onChanged(saved);
            pushToast(`已经还原到 v${asking.version}，现在的内容也留在历史里`);
          },
        },
      );
    }
  }

  return (
    <Dialog
      title={showHistory ? `「${article.title}」的版本历史` : article.title}
      maxWidth={720}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {showHistory ? (
            <Button variant="outline" className="h-9 px-3 text-[13px]" onClick={() => setShowHistory(false)}>
              ← 回到正文
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="h-9 px-3 text-[13px]"
                onClick={() => setShowHistory(true)}
              >
                版本历史 v{article.version}
              </Button>
              {article.canEdit && !archived ? (
                <Button variant="outline" className="h-9 px-3 text-[13px]" onClick={onEdit}>
                  编辑
                </Button>
              ) : null}
              {article.canEdit ? (
                <Button
                  variant="ghost"
                  className={'h-9 px-3 text-[13px] ' + (archived ? 'text-accent' : 'text-danger')}
                  disabled={busy}
                  onClick={() => setAsking({ kind: 'archive' })}
                >
                  {archived ? '恢复使用' : '归档'}
                </Button>
              ) : null}
            </>
          )}
        </div>
      }
    >
      {showHistory ? (
        <div className="flex flex-col gap-2">
          {revisions.isPending ? (
            <p className="text-[13px] text-ink-soft">正在读历史…</p>
          ) : revisions.isError ? (
            <p className="text-[13px] text-danger">版本历史没读出来，关掉重开试试。</p>
          ) : (
            (revisions.data ?? []).map((revision) => (
              <div
                key={revision.id}
                aria-label={`v${revision.version}`}
                className="flex items-start gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span
                  className={
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] ' +
                    (revision.version === article.version
                      ? 'bg-accent-soft text-accent'
                      : 'bg-muted text-ink-soft')
                  }
                >
                  v{revision.version}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px]">
                    {KNOWLEDGE_CHANGE_LABELS[revision.changeType]} · {revision.changedBy.name}
                  </p>
                  <p className="text-[12px] text-ink-soft">{stamp(revision.createdAt)}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] text-ink-soft">
                    {revision.summary || revision.content}
                  </p>
                </div>
                {article.canEdit && !archived && revision.version !== article.version ? (
                  <Button
                    variant="ghost"
                    className="h-8 shrink-0 px-2 text-[13px]"
                    aria-label={`还原到 v${revision.version}`}
                    disabled={busy}
                    onClick={() => setAsking({ kind: 'revision', version: revision.version })}
                  >
                    还原
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
              {KNOWLEDGE_CATEGORY_LABELS[article.category]}
            </span>
            {article.isPinned ? (
              <span className="rounded-full bg-warm-soft px-2 py-0.5 text-[11px] text-warm">置顶</span>
            ) : null}
            {archived ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">已归档</span>
            ) : null}
            {article.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">
                #{tag}
              </span>
            ))}
          </div>

          {article.summary ? (
            <p className="text-[14px] text-ink-soft">{article.summary}</p>
          ) : null}

          {/* 正文按纯文本存的，换行靠 whitespace-pre-wrap 还原，不做 markdown 渲染 */}
          <p className="whitespace-pre-wrap text-[14px] leading-7">{article.content}</p>

          {article.referenceUrl ? (
            <a
              href={article.referenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-[13px] text-accent hover:underline"
            >
              参考链接：{article.referenceUrl}
            </a>
          ) : null}

          <p className="text-[12px] text-ink-soft">
            v{article.version} · {article.updatedBy.name} 更新于 {stamp(article.updatedAt)}
          </p>
        </div>
      )}

      {asking ? (
        <Dialog
          title={
            asking.kind === 'archive'
              ? archived
                ? '恢复这篇？'
                : '归档这篇？'
              : `还原到 v${asking.version}？`
          }
          onClose={() => setAsking(null)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAsking(null)}>
                取消
              </Button>
              <Button className="flex-1" disabled={busy} onClick={confirm}>
                {asking.kind === 'archive' ? (archived ? '恢复使用' : '确认归档') : '确认还原'}
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            {asking.kind === 'archive'
              ? archived
                ? '恢复之后它会回到「使用中」的列表里，置顶不会自动加回来。'
                : '归档只是从「使用中」的列表里收起来，内容和历史都留着，随时能恢复；置顶会一起取消。'
              : '现在的内容会作为新的一版留在历史里，不会丢。'}
          </p>
        </Dialog>
      ) : null}
    </Dialog>
  );
}
