import { useColorScheme } from 'react-native';

const light = {
  bg: '#F5F7F5',
  card: '#FFFFFF',
  cardPressed: '#EDF1ED',
  label: '#19211C',
  secondaryLabel: '#4F5D54',
  tertiaryLabel: '#69766E',
  separator: '#D5DDD7',
  tint: '#176B4C',
  tintSoft: '#E2F1E9',
  green: '#1F754A',
  greenSoft: '#E5F4EA',
  orange: '#9B560F',
  orangeSoft: '#FFF0D8',
  red: '#B83A33',
  redSoft: '#FCE8E6',
  blue: '#2E6396',
  blueSoft: '#E7F0F8',
  accent: '#B84F3B',
  accentSoft: '#FBEAE5',
  fill: '#EDF1ED',
  fillStrong: '#D5DDD7',
  chrome: 'rgba(255, 255, 255, 0.82)',
  chromeStrong: 'rgba(255, 255, 255, 0.94)',
  scrim: 'rgba(17, 25, 20, 0.42)',
};

const dark: typeof light = {
  bg: '#101411',
  card: '#191F1B',
  cardPressed: '#252D28',
  label: '#F4F7F4',
  secondaryLabel: '#AEB8B1',
  tertiaryLabel: '#78837C',
  separator: '#303A33',
  tint: '#63C394',
  tintSoft: '#173B2A',
  green: '#63C394',
  greenSoft: '#173B2A',
  orange: '#F1A65A',
  orangeSoft: '#422D18',
  red: '#F07C72',
  redSoft: '#41211F',
  blue: '#7EB3E3',
  blueSoft: '#1D3042',
  accent: '#EE917C',
  accentSoft: '#442821',
  fill: '#242C27',
  fillStrong: '#3A463E',
  chrome: 'rgba(25, 31, 27, 0.82)',
  chromeStrong: 'rgba(25, 31, 27, 0.95)',
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
