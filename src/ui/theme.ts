// Light / dark theme: follows the system unless the visitor picks one (kept in localStorage).
const KEY = 'rutaviva-theme';

export function readTheme(): 'light' | 'dark' | 'auto' {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function isDark(theme = readTheme()): boolean {
  return theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
}

export function setTheme(theme: 'light' | 'dark'): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage blocked: still switch for this page */
  }
  document.documentElement.dataset.theme = theme;
}

/** Wire a toggle button; `onChange` runs after every switch (also when the system theme changes). */
export function wireThemeButton(btn: HTMLElement | null, render: (dark: boolean) => void): void {
  render(isDark());
  btn?.addEventListener('click', () => {
    setTheme(isDark() ? 'light' : 'dark');
    render(isDark());
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render(isDark()));
}
