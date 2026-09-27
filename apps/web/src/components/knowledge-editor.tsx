import { useState } from 'react';
import type { KnowledgeArticle, KnowledgeArticleCategory } from '@family/contracts';
import { KNOWLEDGE_CATEGORY_LABELS, knowledgeKey, useSaveKnowledgeArticle } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Checkbox, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');
const textarea =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

/** 中英文逗号都当分隔符，去空去重，最多 8 个——后端也是这么收的。 */
function parseTags(raw: string) {
  return [...new Set(raw.split(/[，,]/).map((one) => one.trim()).filter(Boolean))].slice(0, 8);
}

export function KnowledgeEditor({
  editing,
  canPin,
  onSaved,
  onClose,
}: {
  editing: KnowledgeArticle | null;
  canPin: boolean;
  onSaved: (article: KnowledgeArticle) => void;
  onClose: () => void;
}) {
  const save = useSaveKnowledgeArticle();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [category, setCategory] = useState<KnowledgeArticleCategory>(
    editing?.category ?? 'procedure',
  );
  const [summary, setSummary] = useState(editing?.summary ?? '');
  const [content, setContent] = useState(editing?.content ?? '');
  const [referenceUrl, setReferenceUrl] = useState(editing?.referenceUrl ?? '');
  const [tagText, setTagText] = useState((editing?.tags ?? []).join('，'));
  const [isPinned, setIsPinned] = useState(editing?.isPinned ?? false);
  const [message, setMessage] = useState<string | null>(null);
  // 一次挂载一个幂等键：保存超时后再点一次不会变成两篇
  const [idempotencyKey] = useState(() => knowledgeKey(editing ? `knowledge:update:${editing.id}` : 'knowledge:create'));

  function submit() {
    if (!title.trim()) return setMessage('先写个标题');
    if (!content.trim()) return setMessage('正文还是空的');
    const url = referenceUrl.trim();
    if (url && !/^https?:\/\/\S+$/.test(url)) {
      // 后端的 URL 校验报的是英文，拦在这里说人话
      return setMessage('参考链接要以 http:// 或 https:// 开头');
    }
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        expectedVersion: editing?.version,
        idempotencyKey,
        body: {
          title: title.trim(),
          category,
          summary: summary.trim() || null,
          content: content.trim(),
          referenceUrl: url || null,
          tags: parseTags(tagText),
          ...(canPin ? { isPinned } : {}),
        },
      },
      {
        onSuccess: (article) => {
          pushToast(editing ? '这篇已经更新' : `已写下「${article.title}」`);
          onSaved(article);
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.title}」` : '写一篇'}
      maxWidth={640}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : editing ? '保存修改' : '创建文章'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>标题</span>
          <Input
            autoFocus
            value={title}
            maxLength={120}
            aria-label="标题"
            placeholder="比如：洗衣机怎么用"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div>
          <span className={label}>分类</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(KNOWLEDGE_CATEGORY_LABELS) as KnowledgeArticleCategory[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                className={chip(category === value)}
                onClick={() => setCategory(value)}
              >
                {KNOWLEDGE_CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={label}>一句话摘要（选填）</span>
          <textarea
            value={summary}
            rows={2}
            maxLength={500}
            aria-label="摘要"
            placeholder="列表上会先看到这一句"
            className={textarea}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>

        <label className="block">
          <span className={label}>正文</span>
          <textarea
            value={content}
            rows={8}
            maxLength={20000}
            aria-label="正文"
            placeholder="步骤、注意事项、放在哪儿……"
            className={textarea}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>

        <label className="block">
          <span className={label}>参考链接（选填）</span>
          <Input
            inputMode="url"
            value={referenceUrl}
            maxLength={2000}
            aria-label="参考链接"
            placeholder="https://"
            onChange={(event) => setReferenceUrl(event.target.value)}
          />
        </label>

        <label className="block">
          <span className={label}>标签（选填）</span>
          <Input
            value={tagText}
            maxLength={200}
            aria-label="标签"
            placeholder="用逗号分隔，最多 8 个"
            onChange={(event) => setTagText(event.target.value)}
          />
        </label>

        {canPin ? (
          <div className="flex items-center gap-2">
            <Checkbox checked={isPinned} onChange={() => setIsPinned(!isPinned)} label="置顶这篇" />
            <span className="text-[13px]">置顶这篇（归档时会自动取消）</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
