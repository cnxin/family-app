import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 深色模式字色对比度守门（C2 批 1）：压在 accent / warm / danger 实底上的字和图标一律用 on-* 令牌。
// 直接读 index.css 里的 OKLCH 值 → OKLab → 线性 sRGB → 8 位 sRGB → WCAG 2.x 相对亮度，浅深两套都要 ≥ 4.5:1。

const SRC = resolve(__dirname, '..');
const css = readFileSync(join(SRC, 'index.css'), 'utf8');

/** 取某个选择器后面第一个 {...} 的内容（这几块里没有嵌套花括号） */
function block(selector: RegExp) {
  const match = selector.exec(css);
  if (!match) throw new Error(`index.css 里找不到 ${selector}`);
  const start = match.index + match[0].length;
  return css.slice(start, css.indexOf('}', start));
}

function tokens(body: string, base: Record<string, string> = {}) {
  const map: Record<string, string> = { ...base };
  for (const [, name, value] of body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)) map[name] = value.trim();
  for (const [name, value] of Object.entries(map)) {
    const ref = /^var\(--color-([\w-]+)\)$/.exec(value);
    if (ref) map[name] = map[ref[1]];
  }
  return map;
}

const light = tokens(block(/@theme\s*\{/));
const dark = tokens(block(/html\[data-theme='dark'\]\s*\{/), light);

function srgb(value: string) {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`不是 oklch(L C H)：${value}`);
  const [L, C, H] = match.slice(1).map(Number);
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return linear.map((x) => Math.round(clamp(x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255));
}

function luminance(value: string) {
  const [r, g, b] = srgb(value).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one: string, two: string) {
  const [high, low] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const PAIRS = [
  ['on-accent', 'accent'],
  ['on-warm', 'warm'],
  ['on-danger', 'danger'],
] as const;

for (const [label, theme] of [['浅色', light], ['深色', dark]] as const) {
  describe(`${label}：实底上的字`, () => {
    for (const [text, fill] of PAIRS) {
      it(`${text} 压在 ${fill} 上 ≥ 4.5:1`, () => {
        const ratio = contrast(theme[text], theme[fill]);
        console.log(`${label} ${text} / ${fill}：${ratio.toFixed(2)}`);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
}

/** 浏览器端源码（不含测试）；照 scripts/check-secure-context.mjs 的走法 */
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) yield path;
  }
}

// 以后真有字压在照片 / 黑色蒙层上要用白字，把「相对 src 的路径」或「路径:行号」加进这里（按前缀匹配），并写清底色
const ALLOWED_WHITE: string[] = [];

it('源码里不再用 text-white / stroke="white" 压在主题色上（改用 text-on-*）', () => {
  const hits: string[] = [];
  for (const path of sources(SRC)) {
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (/\btext-white\b|stroke="white"/.test(line)) hits.push(`${relative(SRC, path)}:${index + 1}`);
      });
  }
  expect(hits.filter((hit) => !ALLOWED_WHITE.some((allowed) => hit.startsWith(allowed)))).toEqual([]);
});
