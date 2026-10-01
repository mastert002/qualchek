// The refresh-token cookie, and the flags that make it worth having.
//
// httpOnly is the whole point: script cannot read this value, so an XSS bug or
// a line typed into the console cannot carry the durable half of a session off
// the machine. Only the 15-minute access token is reachable from JavaScript.
//
// No maxAge or expires is set, and that is deliberate rather than an omission:
// a cookie with neither is a *session cookie*, which the browser drops when it
// closes. That preserves the rule the app already had - "the session must not
// survive the browser closing" - which sessionStorage enforces for the access
// token. Both halves now die together.

const COOKIE_NAME = 'tm_rt';

// Path scoping limits where the cookie is ever transmitted. '/api/auth' covers
// refresh and logout, and keeps it off the bulk of the API - projects, test
// cases, the crawler, Jira, CI - which never need it. Scoping it tighter than
// this would need the two endpoints moved under their own prefix, which is not
// worth the less conventional URLs.
const COOKIE_PATH = '/api/auth';

// Secure cookies are refused by browsers over plain http, and local dev is
// http://localhost - so the flag cannot simply be hardcoded on.
//
// Deliberately derived from the request rather than from an environment
// variable naming a particular host. Keying this off VERCEL or NODE_ENV means
// that moving to a host which sets neither silently downgrades the cookie to
// being sent in the clear, and nothing in the app would look wrong. req.secure
// is true for a direct https connection, and behind a proxy or CDN it follows
// X-Forwarded-Proto once 'trust proxy' is set (see index.js).
const isSecureRequest = req =>
  req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

const options = req => ({
  httpOnly: true,
  secure: isSecureRequest(req),
  // The SPA and the API are same-origin in dev (the Vite proxy) and in
  // production (one Vercel deployment), so Strict costs nothing and removes
  // CSRF from consideration: the cookie is never sent on a cross-site request.
  sameSite: 'strict',
  path: COOKIE_PATH,
});

function setSessionCookie(req, res, raw) {
  res.cookie(COOKIE_NAME, raw, options(req));
}

function clearSessionCookie(req, res) {
  // Attributes must match the ones it was set with or the browser keeps it.
  res.clearCookie(COOKIE_NAME, options(req));
}

const readSessionCookie = req => (req.cookies || {})[COOKIE_NAME] || null;

module.exports = { COOKIE_NAME, setSessionCookie, clearSessionCookie, readSessionCookie };
