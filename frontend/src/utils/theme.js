// Light or dark, remembered on this device. Storage can be blocked (private
// windows, disabled site data), so every access is guarded and the app falls
// back to light.
const KEY = 'theme';

export function getTheme() {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function setTheme(theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered, but the choice still applies for this visit.
  }
}
