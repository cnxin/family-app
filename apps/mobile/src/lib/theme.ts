import { useColorScheme } from 'react-native';

const light = {
  bg: '#F4F6F3',
  card: '#FFFFFF',
  cardPressed: '#EDF1ED',
  label: '#19211C',
  secondaryLabel: '#627068',
  tertiaryLabel: '#96A098',
  separator: '#DDE4DE',
  tint: '#197A55',
  tintSoft: '#E2F1E9',
  green: '#2E8B57',
  greenSoft: '#E5F4EA',
  orange: '#C56A12',
  orangeSoft: '#FFF0D8',
  red: '#C8463D',
  redSoft: '#FCE8E6',
  blue: '#386FA4',
  blueSoft: '#E7F0F8',
  accent: '#D66A52',
  accentSoft: '#FBEAE5',
  fill: '#EDF1ED',
  fillStrong: '#D5DDD7',
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
