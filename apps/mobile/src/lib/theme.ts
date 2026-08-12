import { useColorScheme } from 'react-native';

const light = {
  bg: '#F2F2F7',
  card: '#FFFFFF',
  cardPressed: '#E5E5EA',
  label: '#1C1C1E',
  secondaryLabel: '#636366',
  tertiaryLabel: '#8E8E93',
  separator: '#C6C6C8',
  tint: '#007AFF',
  tintSoft: '#E8F2FF',
  green: '#248A3D',
  greenSoft: '#E8F7EC',
  orange: '#C93400',
  orangeSoft: '#FFF1E7',
  red: '#D70015',
  redSoft: '#FFE9E8',
  blue: '#007AFF',
  blueSoft: '#E8F2FF',
  accent: '#AF52DE',
  accentSoft: '#F6EAFC',
  fill: '#E5E5EA',
  fillStrong: '#D1D1D6',
  chrome: 'rgba(249, 249, 249, 0.78)',
  chromeStrong: 'rgba(249, 249, 249, 0.92)',
  scrim: 'rgba(0, 0, 0, 0.46)',
};

const dark: typeof light = {
  bg: '#000000',
  card: '#1C1C1E',
  cardPressed: '#2C2C2E',
  label: '#FFFFFF',
  secondaryLabel: '#AEAEB2',
  tertiaryLabel: '#8E8E93',
  separator: '#38383A',
  tint: '#0A84FF',
  tintSoft: '#102A43',
  green: '#30D158',
  greenSoft: '#15351D',
  orange: '#FF9F0A',
  orangeSoft: '#3D2A0C',
  red: '#FF453A',
  redSoft: '#3D1715',
  blue: '#64D2FF',
  blueSoft: '#12313B',
  accent: '#BF5AF2',
  accentSoft: '#32173F',
  fill: '#2C2C2E',
  fillStrong: '#3A3A3C',
  chrome: 'rgba(28, 28, 30, 0.78)',
  chromeStrong: 'rgba(28, 28, 30, 0.92)',
  scrim: 'rgba(0, 0, 0, 0.58)',
};

export type Palette = typeof light;

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { sm: 6, md: 8, lg: 8, full: 999 };

export const type = {
  largeTitle: { fontSize: 32, fontWeight: '700' as const, letterSpacing: 0 },
  title1: { fontSize: 26, fontWeight: '700' as const, letterSpacing: 0 },
  title2: { fontSize: 22, fontWeight: '700' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 17, fontWeight: '400' as const },
  subhead: { fontSize: 15, fontWeight: '400' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};

export const CATEGORY_EMOJI: Record<string, string> = {
  荤菜: '🍖',
  素菜: '🥬',
  汤: '🥣',
  主食: '🍚',
  甜品: '🍮',
};
