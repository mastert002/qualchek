// Guard for URLs that reach an href or window.open.
//
// React escapes text, but it does not stop `javascript:` in an href - that
// executes on click, in the viewer's session. The values guarded here come
// from the Jira base URL, which an admin types in, so validation at the API is
// the primary control (routes/jira.js). This is the second line: a value saved
// before that validation existed is still in the database, and a link built
// from it must not be clickable.

const SAFE_PROTOCOLS = ['http:', 'https:'];

/**
 * @param {string} url
 * @returns {string|null} the URL when it is an ordinary web address, else null
 */
export function safeHttpUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return null;
  }
  return SAFE_PROTOCOLS.includes(parsed.protocol) ? url : null;
}
