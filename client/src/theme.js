// Theme helpers — light/dark. The theme is applied via a `data-theme`
// attribute on <html>, and mirrored to localStorage so it survives reloads
// and is available before login (the API-stored preference syncs in later).

const STORAGE_KEY = 'applymate_theme';
export const THEMES = ['light', 'dark'];

export function normalizeTheme(theme) {
  return theme === 'dark' ? 'dark' : 'light';
}

export function getStoredTheme() {
  try {
    return normalizeTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'light';
  }
}

export function applyTheme(theme) {
  const t = normalizeTheme(theme);
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    // ignore storage failures (private mode, etc.)
  }
  return t;
}
