const KEY = 'family-app.theme';
export type ThemeMode = 'light' | 'dark';

export function readTheme(): ThemeMode {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** 默认永远是暖色浅色；深色是手动选的，不跟随系统。 */
export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* 隐私模式记不住，本次会话仍然生效 */
  }
}
