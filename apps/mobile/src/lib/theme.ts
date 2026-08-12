import { useColorScheme, ViewStyle } from 'react-native';

const light = {
  bg: '#F8F9FB',
  card: '#FFFFFF',
  cardPressed: '#F1F5F9',
  label: '#0F172A',
  secondaryLabel: '#475569',
  tertiaryLabel: '#94A3B8',
  separator: '#E2E8F0',
  tint: '#2563EB',
  tintSoft: '#EFF6FF',
  green: '#10B981',
  greenSoft: '#ECFDF5',
  orange: '#F97316',
  orangeSoft: '#FFF7ED',
  red: '#EF4444',
  redSoft: '#FEF2F2',
  blue: '#3B82F6',
  blueSoft: '#EFF6FF',
  accent: '#8B5CF6',
  accentSoft: '#F5F3FF',
  fill: '#F1F5F9',
  fillStrong: '#E2E8F0',
  chrome: 'rgba(255, 255, 255, 0.88)',
  chromeStrong: 'rgba(255, 255, 255, 0.96)',
  scrim: 'rgba(15, 23, 42, 0.45)',
  canteenAccent: '#FF6B35',
  canteenSoft: '#FFF5F0',
  canteenBorder: '#FFE2D8',
  mediaAccent: '#6366F1',
  mediaSoft: '#EEF2FF',
  mediaBorder: '#E0E7FF',
};

const dark: typeof light = {
  bg: '#0B0F17',
  card: '#151D2A',
  cardPressed: '#1E293B',
  label: '#FFFFFF',
  secondaryLabel: '#94A3B8',
  tertiaryLabel: '#64748B',
  separator: '#1E293B',
  tint: '#3B82F6',
  tintSoft: '#1E293B',
  green: '#10B981',
  greenSoft: '#064E3B',
  orange: '#F97316',
  orangeSoft: '#431407',
  red: '#EF4444',
  redSoft: '#450A0A',
  blue: '#60A5FA',
  blueSoft: '#172554',
  accent: '#A78BFA',
  accentSoft: '#2E1065',
  fill: '#1E293B',
  fillStrong: '#334155',
  chrome: 'rgba(21, 29, 42, 0.88)',
  chromeStrong: 'rgba(21, 29, 42, 0.96)',
  scrim: 'rgba(0, 0, 0, 0.72)',
  canteenAccent: '#FF7A45',
  canteenSoft: '#3D1C10',
  canteenBorder: '#5C2B18',
  mediaAccent: '#818CF8',
  mediaSoft: '#1E1B4B',
  mediaBorder: '#312E81',
};

export type Palette = typeof light;

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, full: 999 };

export const type = {
  largeTitle: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  title1: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.3 },
  title2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2 },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  subhead: { fontSize: 14, fontWeight: '500' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};

export const shadows = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  } as ViewStyle,
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  } as ViewStyle,
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  } as ViewStyle,
};

export const CATEGORY_EMOJI: Record<string, string> = {
  荤菜: '🍖',
  素菜: '🥬',
  汤: '🥣',
  主食: '🍚',
  甜品: '🍮',
};

