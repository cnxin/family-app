import { describe, expect, it } from 'vitest';
import {
  DOMAIN_KEYS,
  PLUGIN_ALIASES,
  PLUGINS,
  renderTemplate,
  type AttentionItem,
  type PluginManifest,
} from '@family/contracts';
import { ACTIONS } from './actions';
import { attentionCopy } from './attention-copy';
import { DOMAIN_QUERY_KEYS } from './events';
import { allSegments, SCENES } from './nav';
import { MODULE_ICON, MODULE_LABEL } from './notification-meta';
import { toNewRoute } from './routes';

// J1：web 端登记（导航、⌘K、查询失效、旧路径、留意文案与落点、通知）对已迁插件必须与 manifest 一致。
// 静态的「没有手写残留」检查在 scripts/check-plugins.mjs。

describe('插件注册表 · 全局', () => {
  it('每个域都有查询失效登记', () => {
    for (const key of DOMAIN_KEYS) expect(DOMAIN_QUERY_KEYS[key], key).toBeInstanceOf(Array);
  });
});

/** 模板里的占位都有值才用模板，否则退回域的默认落点（与 attentionPath 的现行规则一致）。 */
function expectedPath(plugin: PluginManifest, template: string | undefined, values: Record<string, string | undefined>) {
  if (!template) return plugin.attention!.path;
  const names = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  return names.every((name) => values[name]) ? renderTemplate(template, values) : plugin.attention!.path;
}

describe.each(PLUGINS.map((plugin) => [plugin.key, plugin] as const))('插件注册表 · %s', (key, plugin) => {
  it('导航分段来自 manifest，并且在声明的场景里', () => {
    const keys = [key, ...(PLUGIN_ALIASES[plugin.key as keyof typeof PLUGIN_ALIASES].nav ?? [])];
    const actual = allSegments()
      .filter((segment) => keys.includes(segment.key))
      .map(({ key: segmentKey, label, glyph, path, tier, managerOnly }) => ({ key: segmentKey, label, glyph, path, tier, managerOnly: Boolean(managerOnly) }));
    const expected = plugin.nav.map((segment) => ({
      key: segment.key,
      label: segment.label,
      glyph: segment.glyph,
      path: segment.path,
      tier: segment.tier ?? plugin.tier,
      managerOnly: Boolean(segment.managerOnly),
    }));
    expect(actual).toEqual(expected);
    for (const segment of plugin.nav) {
      const scene = SCENES.find((one) => one.key === segment.scene);
      expect(scene?.segments.some((one) => one.key === segment.key), `${segment.key} 应在场景 ${segment.scene}`).toBe(true);
    }
  });

  it('⌘K 动作来自 manifest', () => {
    const expected = (plugin.actions ?? []).map((action) => ({
      id: action.id,
      label: action.label,
      keywords: [...action.keywords],
      domain: key,
      to: action.deepLink,
    }));
    expect(ACTIONS.filter((action) => action.domain === key)).toEqual(expected);
  });

  it('查询失效 key 来自 manifest', () => {
    expect([...DOMAIN_QUERY_KEYS[key as keyof typeof DOMAIN_QUERY_KEYS]]).toEqual([...plugin.events.queryKeys]);
  });

  it('旧路径能换到新路径', () => {
    for (const [from, to] of plugin.legacyPaths ?? []) expect(toNewRoute(from)).toBe(to);
  });

  it('通知 module 的名字与图标来自 manifest', () => {
    for (const module of plugin.notifications ?? []) {
      expect(MODULE_LABEL[module.key as keyof typeof MODULE_LABEL]).toBe(module.label);
      expect(MODULE_ICON[module.key as keyof typeof MODULE_ICON]).toBe(module.icon);
    }
  });

  it.runIf(Boolean(plugin.attention))('留意卡片的文案与落点来自 manifest', () => {
    const attention = plugin.attention!;
    const domain = key as AttentionItem['domain'];
    const today = '2026-10-07';
    for (const kind of attention.kinds) {
      const base = { key: `${key}:attention`, domain, kind: kind.kind, kinds: [kind.kind], overdue: false };
      // 单件，有截止日
      const single = attentionCopy({ ...base, count: 1, entity: { id: 'e1', name: '某物' }, dueOn: '2026-10-10' }, today);
      expect(single.domainLabel).toBe(attention.label);
      expect(single.title).toBe(renderTemplate(kind.title, { name: '某物', soon: '3 天后' }));
      expect(single.actionLabel).toBe(kind.actionLabel);
      expect(single.path).toBe(expectedPath(plugin, kind.path, { id: 'e1', dueOn: '2026-10-10' }));
      // 单件，没有截止日
      const undated = attentionCopy({ ...base, count: 1, entity: { id: 'e1', name: '某物' } }, today);
      expect(undated.title).toBe(renderTemplate(kind.titleNoDue ?? kind.title, { name: '某物', soon: '' }));
      // 同一种事合并
      const merged = attentionCopy({ ...base, count: 2, dueOn: '2026-10-10' }, today);
      expect(merged.title).toBe(renderTemplate(kind.mergedTitle ?? attention.mergedTitle, { n: 2 }));
      expect(merged.actionLabel).toBe(kind.actionLabel);
      expect(merged.path).toBe(expectedPath(plugin, kind.path, { dueOn: '2026-10-10' }));
    }
    // 混着几种事
    if (attention.kinds.length > 1) {
      const [first, second] = attention.kinds;
      const mixed = attentionCopy({ key: `${key}:attention`, domain, kind: first.kind, kinds: [first.kind, second.kind], count: 2, overdue: false }, today);
      expect(mixed.title).toBe(renderTemplate(attention.mixedTitle ?? attention.mergedTitle, { n: 2 }));
      expect(mixed.actionLabel).toBe(attention.listActionLabel);
      expect(mixed.path).toBe(attention.path);
    }
  });
});
