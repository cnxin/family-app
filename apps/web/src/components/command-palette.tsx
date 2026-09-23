import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSoftNavigate } from './soft-link';
import { useQueryClient } from '@tanstack/react-query';
import type { Dish } from '@family/contracts';
import { ACTIONS } from '../lib/actions';
import { coreSegments, shelfSegments, settingsSegments, legacyUrl } from '../lib/nav';
import { useAuth } from '../lib/auth';
import { prefetchSearchSources } from '../lib/prefetch';
import { useAgentStatus } from '../lib/queries';

/** 顶栏那个按钮也要能开，用一个自定义事件把两边接起来，免得再拉一层 context。 */
export function openPalette() {
  document.dispatchEvent(new CustomEvent('palette:open'));
}

interface Entry {
  id: string;
  label: string;
  hint: string;
  kind: 'action' | 'page' | 'dish' | 'agent';
  go: () => void;
}

function includes(text: string, keyword: string) {
  return text.toLowerCase().includes(keyword);
}

/**
 * ⌘K：功能一多，导航再怎么分也不如直接说出名字快。
 * 除了页面，还能搜菜品（搜到就直接跳菜谱），以后加成员、任务也是往这里塞。
 */
const NO_DISHES: Dish[] = [];

export function CommandPalette() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const navigate = useSoftNavigate();
  const client = useQueryClient();
  const agent = useAgentStatus(open);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开的同时把上次的输入清掉——放在打开动作里而不是 effect 里，少一次级联渲染
  const show = useCallback(() => {
    setQuery('');
    setCursor(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => {
          if (value) return false;
          setQuery('');
          setCursor(0);
          return true;
        });
      }
      if (event.key === 'Escape') setOpen(false);
    };
    const onOpen = () => show();
    document.addEventListener('keydown', onKey);
    document.addEventListener('palette:open', onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('palette:open', onOpen);
    };
  }, [show]);

  useEffect(() => {
    if (!open) return;
    prefetchSearchSources(client);
    // 等对话框挂上去再聚焦，否则 iOS 上键盘不弹
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, client]);

  const dishes = (client.getQueryData(['dishes']) as Dish[] | undefined) ?? NO_DISHES;

  const entries = useMemo<Entry[]>(() => {
    // shelf 不再常驻导航，但搜索必须完整；权限过滤与家里页共用分层模型。
    const pages: Entry[] = [
      ...coreSegments(), ...shelfSegments(session?.member), ...settingsSegments(session?.member),
    ].map((segment) => ({
      id: segment.key,
      label: segment.label,
      hint: segment.tier === 'settings' ? '设置' : '页面',
      kind: 'page',
      go: () => segment.ready && segment.path
        ? navigate(segment.path)
        : window.open(legacyUrl(segment.legacy ?? '/'), '_blank', 'noopener'),
    }));
    const dishEntries: Entry[] = dishes.slice(0, 200).map((dish) => ({
      id: `dish-${dish.id}`,
      label: dish.name,
      hint: dish.category ? `菜品 · ${dish.category}` : '菜品',
      kind: 'dish',
      go: () => navigate(`/eat/recipes?dish=${dish.id}`),
    }));
    return [...pages, ...dishEntries];
  }, [dishes, navigate, session?.member]);

  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const pages = entries.filter((entry) => entry.kind === 'page');
    const dishesOnly = entries.filter((entry) => entry.kind === 'dish');
    if (!keyword) return pages;
    const manager = session?.member.role === 'owner' || session?.member.role === 'admin';
    const actions = ACTIONS.filter((action) => action.domain !== 'finance' || manager);
    const named = actions.filter((action) => includes(action.label, keyword)).map((action) => ({
      id: action.id,
      label: action.label,
      hint: '动作',
      kind: 'action' as const,
      go: () => navigate(action.to),
    }));
    const aliased = actions.filter(
      (action) => !includes(action.label, keyword) && action.keywords.some((item) => includes(item, keyword)),
    ).map((action) => ({
      id: action.id,
      label: action.label,
      hint: '动作',
      kind: 'action' as const,
      go: () => navigate(action.to),
    }));
    const pageHits = pages.filter((entry) => includes(entry.label, keyword));
    const dishHits = dishesOnly.filter((entry) => includes(entry.label, keyword));
    const ask = agent.data?.enabled
      ? [{
          id: 'ask-agent',
          label: '交给小管家',
          hint: '把这句话带过去',
          kind: 'agent' as const,
          go: () => navigate(`/me/assistant?draft=${encodeURIComponent(query.trim())}`),
        }]
      : [];
    return [...named, ...pageHits, ...aliased, ...dishHits, ...ask].slice(0, 20);
  }, [agent.data?.enabled, entries, navigate, query, session?.member.role]);

  if (!open) return null;

  const pick = (entry: Entry | undefined) => {
    if (!entry) return;
    setOpen(false);
    entry.go();
  };

  const groups = [
    { title: '动作', items: results.filter((entry) => entry.kind === 'action') },
    { title: '页面', items: results.filter((entry) => entry.kind === 'page') },
    { title: '菜品', items: results.filter((entry) => entry.kind === 'dish') },
    { title: '小管家', items: results.filter((entry) => entry.kind === 'agent') },
  ];
  let shown = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-[2px] sm:items-start sm:p-4 sm:pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="快速跳转"
        className="flex max-h-[62vh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-card border border-border bg-surface shadow-xl sm:rounded-card"
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="去哪儿？输入页面或菜名"
          aria-label="搜索页面或菜品"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((value) => Math.min(value + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((value) => Math.max(value - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              pick(results[cursor]);
            }
          }}
          className="h-12 shrink-0 border-b border-border bg-transparent px-4 text-[15px] text-ink placeholder:text-ink-soft/70 focus:outline-none"
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {results.length ? (
            groups.map((group) =>
              group.items.length ? (
                <div key={group.title}>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-medium text-ink-soft">{group.title}</p>
                  {group.items.map((entry) => {
                    const index = shown;
                    shown += 1;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => pick(entry)}
                        className={
                          'flex min-h-11 w-full items-center gap-3 px-4 text-left transition-colors duration-100 ' +
                          (index === cursor ? 'bg-accent-soft' : '')
                        }
                      >
                        <span className="flex-1 truncate text-sm">{entry.label}</span>
                        <span className="shrink-0 text-[12px] text-ink-soft">{entry.hint}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null,
            )
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-ink-soft">没找到「{query}」</p>
          )}
        </div>
        <div className="shrink-0 border-t border-border px-4 py-2 pb-[max(8px,env(safe-area-inset-bottom))] text-[11px] text-ink-soft sm:pb-2">
          ↑↓ 选择 · Enter 打开 · Esc 关闭
        </div>
      </div>
    </div>
  );
}
