require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const openApiSpec = require('./openapi.js');
const { initDb } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Behind a CDN, load balancer or serverless proxy, the TLS connection ends at
// that hop and Express sees plain http. Trusting the first proxy makes
// req.secure follow X-Forwarded-Proto, which is what decides whether the
// session cookie gets its Secure flag (lib/sessionCookie.js).
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '5mb' }));
// The refresh token travels as an httpOnly cookie, so req.cookies has to exist
// before the auth routes read it.
app.use(require('cookie-parser')());
// Security headers. vercel.json routes every request through this function,
// including the built frontend, so these cover the app as well as the API.
//
// The Content-Security-Policy is the containment layer: if a value ever does
// reach the page as markup, script-src 'self' means an injected <script>,
// inline handler or javascript: URL has nothing it is allowed to execute.
// Input validation is still the primary control - this is what catches the
// case where validation was missed.
const CSP = [
  "default-src 'self'",
  // No 'unsafe-inline' and no 'unsafe-eval': the Vite build emits one external
  // module and nothing inline, so the strict form costs nothing here.
  "script-src 'self'",
  // Styles are the exception. Several UI libraries inject a <style> element at
  // runtime, and inline CSS cannot execute script, so this is a much weaker
  // concession than it would be for script-src.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // data: carries the crawler's base64 screenshots.
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  // Swagger UI ships inline scripts and styles of its own, so the strict
  // policy would leave /api/docs blank. It renders a static spec and takes no
  // user content, so it is left to the other headers.
  if (!req.path.startsWith('/api/docs')) res.set('Content-Security-Policy', CSP);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  next();
});

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Start DB init immediately at module load so connection is ready before first request
let dbReady = false;
const dbInitPromise = initDb().then(() => { dbReady = true; }).catch(err => {
  console.error('DB init failed at startup:', err);
});

app.use(async (req, res, next) => {
  if (dbReady) return next();
  try {
    await dbInitPromise;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database initialization failed', detail: err.message });
  }
});

// Swagger UI
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customSiteTitle: 'QualChek API Docs',
  customCss: '.swagger-ui .topbar { background-color: #e81613; } .swagger-ui .topbar-wrapper img { content: none; }',
  swaggerOptions: { persistAuthorization: true },
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/projects/:projectId/suites', require('./routes/suites'));
app.use('/api/projects/:projectId/test-cases', require('./routes/testcases'));
app.use('/api/projects/:projectId/runs', require('./routes/testruns'));
app.use('/api/projects/:projectId/reports', require('./routes/reports'));

app.use('/api/jira', require('./routes/jira'));
app.use('/api/ci', require('./routes/ci'));
app.use('/api/projects/:projectId/crawl', require('./routes/crawler'));
app.use('/api/projects/:projectId/scripts', require('./routes/scripts'));
app.use('/api/import', require('./routes/import'));
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// Serve frontend build in production (local/Railway only — Vercel serves frontend separately)
const frontendDist = path.join(__dirname, '../../frontend/dist');
// Local dev serves the UI from Vite on :3100, so serving the built copy here
// as well puts a second — usually stale — app on :3001. Opt out with
// SERVE_FRONTEND=false in backend/.env. Defaults to serving, so production and
// any host that does not set the flag behave exactly as before.
const serveFrontend = process.env.SERVE_FRONTEND !== 'false';

if (serveFrontend && require('fs').existsSync(frontendDist)) {
  // Asset filenames are content-hashed, so they can be cached hard. index.html
  // must NOT be: a cached copy keeps pointing at the previous deploy's bundle,
  // which no longer exists after a redeploy.
  app.use(express.static(frontendDist, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.set('Cache-Control', 'no-store');
    },
  }));
  app.get('*', (req, res) => {
    // A request for a file that does not exist must 404 rather than fall
    // through to index.html — HTML returned for a .js request fails the
    // browser's strict MIME check and renders a blank page with no useful error.
    if (path.extname(req.path)) return res.status(404).end();
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Export for Vercel serverless
module.exports = app;

// Start server when run directly (local dev / Railway)
if (require.main === module) {
  app.listen(PORT, () => console.log(`QualChek API running on http://localhost:${PORT}`));
}
