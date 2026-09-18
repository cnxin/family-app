import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { KnowledgeArticle, KnowledgeArticleCategory } from '@family/contracts';
import { KNOWLEDGE_CATEGORY_LABELS, useKnowledgeArticles } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { KnowledgeDetail } from '../components/knowledge-detail';
import { KnowledgeEditor } from '../components/knowledge-editor';
import { ListSkeleton } from '../components/skeleton';
import { Button, EmptyState, Input, Page, Panel, Segmented } from '../components/ui';

type Status = 'active' | 'archived';
type CategoryFilter = KnowledgeArticleCategory | 'all';

const NO_ARTICLES: KnowledgeArticle[] = [];

function stamp(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(value));
}

export function KnowledgePage() {
  const { session } = useAuth();
  const canPin = session?.member.role !== 'member';
  const [params, setParams] = useSearchParams();

  const [status, setStatus] = useState<Status>('active');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<KnowledgeArticle | null>(null);
  const [editing, setEditing] = useState<KnowledgeArticle | null>(null);
  const [composing, setComposing] = useState(false);

  const list = useKnowledgeArticles({ status, category, q });
  const rows = list.data ?? NO_ARTICLES;

  // 小管家给的链接是 /knowledge?articleId=…，搬过来这条深链要认得
  const wanted = params.get('articleId');
  if (wanted && !selected) {
    const hit = rows.find((one) => one.id === wanted);
    if (hit) {
      setSelected(hit);
      setParams({}, { replace: true });
    }
  }

  return (
    <Page
      title="家庭知识库"
      subtitle="流程、说明、家里的各种「怎么弄」"
      actions={
        <Button className="h-9 px-3 text-[13px]" onClick={() => setComposing(true)}>
          + 写一篇
        </Button>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              aria-label="搜索知识库"
              placeholder="搜标题或正文"
              className="h-9 w-[200px]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setQ(draft);
              }}
            />
            <Button
              variant="outline"
              className="h-9 shrink-0 px-3 text-[13px]"
              onClick={() => setQ(draft)}
            >
              搜索
            </Button>
            {q ? (
              <Button
                variant="ghost"
                className="h-9 shrink-0 px-2 text-[13px]"
                onClick={() => {
                  setDraft('');
                  setQ('');
                }}
              >
                清除
              </Button>
            ) : null}
          </div>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active' as const, label: '使用中' },
              { value: 'archived' as const, label: '已归档' },
            ]}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="按分类筛选">
            {(['all', ...Object.keys(KNOWLEDGE_CATEGORY_LABELS)] as CategoryFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                className={
                  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
                  (category === value
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-ink-soft hover:bg-muted')
                }
                onClick={() => setCategory(value)}
              >
                {value === 'all' ? '全部分类' : KNOWLEDGE_CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <Panel className="p-3">
        {list.isPending ? (
          <ListSkeleton rows={4} />
        ) : list.isError ? (
          <EmptyState emoji="📚" title="知识库读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : rows.length === 0 ? (
          <EmptyState
            emoji="📚"
            title={
              q
                ? '没搜到'
                : status === 'archived'
                  ? '没有归档的文章'
                  : '还没有写下什么'
            }
            hint="家里的流程、说明书、常用电话，写一篇就不用每次都问了"
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((article) => (
              <button
                key={article.id}
                type="button"
                aria-label={article.title}
                onClick={() => setSelected(article)}
                className="flex flex-col rounded-card border border-border px-3.5 py-3 text-left transition-colors duration-150 hover:bg-muted"
              >
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                    {KNOWLEDGE_CATEGORY_LABELS[article.category]}
                  </span>
                  {article.isPinned ? <span className="text-[12px] text-warm">置顶</span> : null}
                  <span className="ml-auto text-[11px] text-ink-soft">v{article.version}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[15px] font-semibold">{article.title}</p>
                <p className="mt-1 line-clamp-2 text-[13px] text-ink-soft">
                  {article.summary || article.content}
                </p>
                <p className="mt-2 text-[12px] text-ink-soft">
                  {article.updatedBy.name} · {stamp(article.updatedAt)}
                </p>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {selected ? (
        <KnowledgeDetail
          article={selected}
          onChanged={setSelected}
          onEdit={() => setEditing(selected)}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {composing || editing ? (
        <KnowledgeEditor
          editing={editing}
          canPin={canPin}
          onSaved={(article) => {
            setEditing(null);
            setComposing(false);
            setSelected(article);
          }}
          onClose={() => {
            setEditing(null);
            setComposing(false);
          }}
        />
      ) : null}
    </Page>
  );
}
