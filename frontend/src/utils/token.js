// Auth token storage.
//
// Deliberately sessionStorage, not localStorage: the session must not survive
// the browser closing. sessionStorage is scoped to the tab, so a reload or an
// in-app navigation keeps the user signed in, but quitting the browser drops
// the token and the next visit to a protected route lands on /login.
//
// Access is wrapped because storage throws (not returns null) when the browser
// is set to block site data for the origin; without this an exception during
// AuthProvider's mount effect would leave the app stuck on its loading spinner.

const TOKEN_KEY = 'token';

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage blocked - the in-memory user state still carries this session */
  }
}

export function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    // Older builds persisted the token here; drop it so a pre-existing login
    // cannot outlive a browser restart.
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}
