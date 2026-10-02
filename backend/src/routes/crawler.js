const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { v4: uuidv4 } = require('uuid');
const { getDb, getPool, nowISO } = require('../db/database');
const { withTenant } = require('../db/tenantContext');
const { launchBrowser, isServerless } = require('../lib/browser');

// Serverless functions are capped at 60s here, and a cold start spends several
// of those unpacking Chromium. Keep a hosted crawl small enough to finish
// inside that; anything larger needs to run locally.
const SERVERLESS_MAX_PAGES = 5;
const { authenticate } = require('../middleware/auth');
const { requireProject } = require('../middleware/project');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

// Until now `authenticate` was the only check on this router: any signed-in
// user could reach the crawler for ANY project id, whether or not they belong
// to it. Every other project-scoped router gates on membership (see
// routes/projects.js), and this one has to as well - it reaches stored
// credentials for other systems.
async function requireProjectAccess(req, res, next) {
  try {
    // Matches the rule used elsewhere: a global admin or viewer sees every
    // project; everyone else needs a membership row.
    if (req.user.role === 'admin' || req.user.role === 'viewer') return next();
    const db = getDb();
    const member = await db
      .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
      .get(req.params.projectId, req.user.id);
    if (!member) return res.status(403).json({ error: 'You do not have access to this project' });
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Stored credentials are secrets for other systems, so changing one is an
// admin action. This matters most for url_pattern and login_url: whoever can
// edit those decides where the saved password gets typed.
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can manage crawler credentials' });
  }
  next();
}

router.use(requireProjectAccess);

// requireProjectAccess answers "may this person reach this project", and
// returns early for a global admin or viewer - so it never confirms the project
// exists in this workspace at all. requireProject does, which stops a write
// naming another workspace's project id.
router.use(requireProject);

// In-memory job store
const jobs = new Map();

// â”€â”€ HTTP fetch helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fetchUrl(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(new Error(`Invalid URL: ${urlStr}`)); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'QualChek-Crawler/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...(opts.headers || {}),
      },
      rejectUnauthorized: false,
    }, res => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : new URL(loc, urlStr).href;
        return resolve(fetchUrl(next, { ...opts, method: 'GET' }));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: data,
      }));
    });

    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// â”€â”€ Page analyser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function analysePage(urlStr, html) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const parsed = new URL(urlStr);
  const path = parsed.pathname;

  const title = $('title').text().trim() ||
    $('h1').first().text().trim() ||
    $('[role="heading"]').first().text().trim() ||
    path;

  // Forms
  const forms = [];
  $('form').each((_, el) => {
    const form = $(el);
    const inputs = [];
    form.find('input, textarea, select').each((_, inp) => {
      const input = $(inp);
      const type = (input.attr('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) return;
      inputs.push({
        type,
        name: input.attr('name') || input.attr('id') || input.attr('placeholder') || type,
        required: input.attr('required') !== undefined || input.attr('aria-required') === 'true',
        placeholder: input.attr('placeholder') || '',
      });
    });

    const submitText = (form.find('[type="submit"]').first().val() ||
      form.find('button[type="submit"], button:not([type])').first().text() ||
      'Submit').trim();

    const hasPassword = inputs.some(i => i.type === 'password');
    const hasEmail = inputs.some(i => i.type === 'email' || /email|mail/i.test(i.name));
    const hasUser = inputs.some(i => /user|login|username/i.test(i.name));
    const hasSearch = inputs.some(i => i.type === 'search' || /search|query|q\b/i.test(i.name));

    let kind = 'generic';
    if (hasPassword && (hasEmail || hasUser)) kind = 'login';
    else if (hasPassword && /register|signup|sign.up/i.test(path + submitText)) kind = 'registration';
    else if (hasPassword) kind = 'password';
    else if (hasSearch) kind = 'search';
    else if (/register|signup/i.test(submitText)) kind = 'registration';

    if (inputs.length > 0) {
      forms.push({ kind, inputs, submitText, method: (form.attr('method') || 'GET').toUpperCase() });
    }
  });

  // Nav links
  const navLinks = [];
  $('nav a, header a, [role="navigation"] a, .nav a, .navbar a, .menu a, .sidebar a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (text && href && !/^(#|javascript|mailto|tel)/i.test(href)) {
      navLinks.push({ text: text.slice(0, 60), href });
    }
  });

  // Tables
  const tables = [];
  $('table, [role="grid"], [role="table"]').each((i, el) => {
    const cap = $(el).find('caption').text().trim() ||
      $(el).find('th').first().text().trim() ||
      `Table ${i + 1}`;
    tables.push(cap.slice(0, 60));
  });

  // Headings for context
  const headings = [];
  $('h1, h2').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length < 100) headings.push(t);
  });

  // Collect same-origin links for crawling
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/^(#|javascript|mailto|tel)/i.test(href)) return;
    try {
      const resolved = new URL(href, urlStr).href;
      links.add(resolved);
    } catch (_) {}
  });

  return { title, path, forms, navLinks, tables, headings, links: [...links] };
}

// â”€â”€ Test case generator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function generateCases(analysis, origin, login) {
  const { title, path, forms, navLinks, tables } = analysis;
  const page = title || path;
  const cases = [];

  // Build login steps to prepend when the page requires authentication
  const isLoginPage = forms.some(f => f.kind === 'login');
  const loginSteps = (!isLoginPage && login?.username) ? [
    { action: `Open browser and navigate to ${login.url || origin}`, expected: 'Login page is displayed' },
    { action: `Enter username / email: "${login.username}"`, expected: 'Username field accepts input' },
    { action: 'Enter the account password', expected: 'Password is masked with asterisks' },
    { action: 'Click the "Sign In" button', expected: 'User is authenticated and redirected to the application' },
    { action: `Navigate to ${origin}${path}`, expected: `"${page}" page loads successfully` },
  ] : [
    { action: `Open browser and navigate to ${origin}${path}`, expected: 'Page loads with no errors in console' },
  ];

  const loginPrecondition = (!isLoginPage && login?.username)
    ? 'User must have a valid account. Browser must be able to reach the application login page.'
    : null;

  // Page load
  cases.push({
    title: `Verify "${page}" page loads successfully`,
    description: `Authenticate and navigate to ${origin}${path}, then verify the page loads without errors.`,
    preconditions: loginPrecondition,
    steps: [
      ...loginSteps,
      { action: 'Verify the main content area is visible', expected: `Page displays "${page}" content without errors` },
    ],
    priority: 'medium',
    tags: ['smoke', 'navigation'],
  });

  // Forms
  for (const form of forms) {
    if (form.kind === 'login') {
      cases.push({
        title: 'Login with valid credentials',
        description: 'Verify a registered user can log in successfully.',
        preconditions: 'A valid user account exists in the system.',
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Login page is displayed' },
          { action: 'Enter a valid email/username', expected: 'Field accepts input' },
          { action: 'Enter the correct password', expected: 'Password is masked with asterisks' },
          { action: `Click "${form.submitText}"`, expected: 'User is redirected to the dashboard or home page' },
        ],
        priority: 'critical',
        tags: ['auth', 'smoke'],
      });
      cases.push({
        title: 'Login with invalid password',
        description: 'Verify login is rejected with an incorrect password.',
        preconditions: 'A valid user account exists in the system.',
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Login page is displayed' },
          { action: 'Enter a valid email/username', expected: 'Field accepts input' },
          { action: 'Enter an incorrect password', expected: 'Password is masked' },
          { action: `Click "${form.submitText}"`, expected: 'Error message is shown (e.g. "Invalid credentials")' },
        ],
        priority: 'high',
        tags: ['auth', 'negative'],
      });
      cases.push({
        title: 'Login with empty fields shows validation error',
        description: 'Verify the login form validates required fields before submission.',
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Login page is displayed' },
          { action: `Click "${form.submitText}" without entering any credentials`, expected: 'Validation errors appear for the required fields' },
        ],
        priority: 'high',
        tags: ['auth', 'validation'],
      });
      cases.push({
        title: 'Login with non-existent user account',
        description: 'Verify login fails gracefully for an unregistered email.',
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Login page is displayed' },
          { action: 'Enter an email address not registered in the system', expected: 'Field accepts input' },
          { action: 'Enter any password', expected: 'Password is masked' },
          { action: `Click "${form.submitText}"`, expected: 'An error message is shown indicating the account does not exist' },
        ],
        priority: 'medium',
        tags: ['auth', 'negative'],
      });
    } else if (form.kind === 'registration') {
      const fieldSteps = form.inputs.slice(0, 5).map(inp => ({
        action: `Fill in the "${inp.placeholder || inp.name}" field with valid data`,
        expected: 'Field accepts valid input',
      }));
      cases.push({
        title: `Register a new user on "${page}"`,
        description: 'Verify that a new user can create an account successfully.',
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Registration form is displayed' },
          ...fieldSteps,
          { action: `Click "${form.submitText}"`, expected: 'Account is created; user is redirected or shown a success message' },
        ],
        priority: 'critical',
        tags: ['auth', 'registration'],
      });
      cases.push({
        title: 'Registration fails with duplicate email',
        description: 'Verify that registering with an already-used email shows an error.',
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Registration form is displayed' },
          { action: 'Enter an email address already registered in the system', expected: 'Field accepts input' },
          { action: 'Fill in remaining required fields with valid data', expected: 'Fields accept input' },
          { action: `Click "${form.submitText}"`, expected: 'Error message shows the email is already in use' },
        ],
        priority: 'high',
        tags: ['auth', 'validation', 'negative'],
      });
    } else if (form.kind === 'search') {
      cases.push({
        title: `Search returns relevant results on "${page}"`,
        description: 'Verify the search feature returns results matching the query.',
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Page loads with a search field visible' },
          { action: 'Enter a valid search term in the search field', expected: 'Search term is entered' },
          { action: 'Submit the search (press Enter or click the search button)', expected: 'Results relevant to the search term are displayed' },
        ],
        priority: 'high',
        tags: ['search', 'functionality'],
      });
      cases.push({
        title: `Search with no query on "${page}"`,
        description: 'Verify search behaviour when the query field is empty.',
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Page loads with search field' },
          { action: 'Submit the search without entering any query', expected: 'Either all results are shown, or a prompt to enter a search term is displayed' },
        ],
        priority: 'medium',
        tags: ['search', 'validation'],
      });
    } else if (form.kind === 'password') {
      cases.push({
        title: `Change password on "${page}"`,
        description: 'Verify that a user can update their password successfully.',
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Password form is displayed' },
          { action: 'Enter the current password', expected: 'Field accepts input' },
          { action: 'Enter a new strong password', expected: 'Field accepts input' },
          { action: 'Confirm the new password', expected: 'Field accepts input' },
          { action: `Click "${form.submitText}"`, expected: 'Password is changed and a success confirmation is shown' },
        ],
        priority: 'high',
        tags: ['auth', 'settings'],
      });
    } else if (form.inputs.length > 0 && form.method === 'POST') {
      const formName = form.submitText;
      const fieldSteps = form.inputs.slice(0, 4).map(inp => ({
        action: `Fill in the "${inp.placeholder || inp.name}" field`,
        expected: 'Field accepts valid input',
      }));
      cases.push({
        title: `Submit "${formName}" form on "${page}" with valid data`,
        description: `Verify the ${formName} form on ${path} can be submitted successfully.`,
        steps: [
          { action: `Navigate to ${origin}${path}`, expected: 'Page loads with the form visible' },
          ...fieldSteps,
          { action: `Click "${formName}"`, expected: 'Form is submitted; a success message or redirect occurs' },
        ],
        priority: 'high',
        tags: ['form', 'functionality'],
      });
      if (form.inputs.some(i => i.required)) {
        cases.push({
          title: `"${formName}" form validates required fields on "${page}"`,
          description: 'Verify that submitting without required fields shows validation errors.',
          steps: [
            { action: `Navigate to ${origin}${path}`, expected: 'Form is displayed' },
            { action: `Click "${formName}" without filling required fields`, expected: 'Validation errors appear for each missing required field' },
          ],
          priority: 'medium',
          tags: ['form', 'validation'],
        });
      }
    }
  }

  // Navigation coverage
  if (navLinks.length >= 3) {
    cases.push({
      title: `Navigation links are functional on "${page}"`,
      description: 'Verify that all main navigation links navigate to the correct destinations.',
      steps: [
        { action: `Navigate to ${origin}${path}`, expected: 'Page loads with the navigation menu visible' },
        ...navLinks.slice(0, 5).map(link => ({
          action: `Click the "${link.text}" navigation link`,
          expected: `Browser navigates to the "${link.text}" section or page`,
        })),
      ],
      priority: 'medium',
      tags: ['navigation', 'smoke'],
    });
  }

  // Data tables
  for (const table of tables.slice(0, 2)) {
    cases.push({
      title: `"${table}" data table displays correctly on "${page}"`,
      description: 'Verify the data table loads and shows the expected columns and rows.',
      steps: [
        { action: `Navigate to ${origin}${path}`, expected: 'Page loads with the data table visible' },
        { action: `Verify the "${table}" table is present`, expected: 'Table headers and at least one data row are displayed' },
        { action: 'Verify column headers are correct', expected: 'All expected columns are shown' },
      ],
      priority: 'medium',
      tags: ['data', 'table'],
    });
  }

  return cases;
}

// â”€â”€ Extract page data in browser context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const EXTRACT_PAGE = () => {
  const title = document.title ||
    document.querySelector('h1')?.textContent?.trim() ||
    document.querySelector('[role="heading"]')?.textContent?.trim() ||
    location.pathname;

  const path = location.pathname;

  // Forms
  const forms = [...document.querySelectorAll('form')].map(form => {
    const inputs = [...form.querySelectorAll('input, textarea, select')]
      .filter(inp => {
        const t = (inp.type || 'text').toLowerCase();
        return !['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(t);
      })
      .map(inp => ({
        type: (inp.type || 'text').toLowerCase(),
        name: inp.name || inp.id || inp.placeholder || inp.type || 'field',
        required: inp.required || inp.getAttribute('aria-required') === 'true',
        placeholder: inp.placeholder || '',
      }));

    const submitEl = form.querySelector('[type="submit"], button[type="submit"], button:not([type])');
    const submitText = (submitEl?.textContent?.trim() || submitEl?.value || 'Submit').slice(0, 40);
    const method = (form.method || 'GET').toUpperCase();

    const hasPassword = inputs.some(i => i.type === 'password');
    const hasEmail = inputs.some(i => i.type === 'email' || /email|mail/i.test(i.name));
    const hasUser  = inputs.some(i => /user|login|username/i.test(i.name));
    const hasSearch = inputs.some(i => i.type === 'search' || /search|query/i.test(i.name));

    let kind = 'generic';
    if (hasPassword && (hasEmail || hasUser)) kind = 'login';
    else if (hasPassword) kind = 'password';
    else if (hasSearch) kind = 'search';
    else if (/register|sign.?up/i.test(submitText)) kind = 'registration';

    return { kind, inputs, submitText, method };
  }).filter(f => f.inputs.length > 0);

  // Nav links
  const navLinks = [
    ...document.querySelectorAll(
      'nav a, header a, [role="navigation"] a, .nav a, .navbar a, .menu a, .sidebar a, aside a'
    ),
  ].map(a => ({ text: a.textContent.trim().slice(0, 60), href: a.href }))
   .filter(l => l.text && l.href && !/^(javascript|mailto|tel)/.test(l.href));

  // Tables / data grids
  const tables = [...document.querySelectorAll('table, [role="grid"], [role="table"]')]
    .map((t, i) => {
      const caption = t.querySelector('caption')?.textContent?.trim();
      if (caption) return caption.slice(0, 60);
      // Find the first meaningful header (skip serial/index columns like "S N", "#", "No", "No.")
      const skip = /^(s[\s./]?n\.?|#|no\.?|sr\.?|id)$/i;
      const ths = [...t.querySelectorAll('th')];
      const meaningful = ths.find(th => {
        const text = th.textContent.trim();
        return text.length > 2 && !skip.test(text);
      });
      return (meaningful?.textContent?.trim() || `Table ${i + 1}`).slice(0, 60);
    });

  // Headings for context
  const headings = [...document.querySelectorAll('h1, h2')]
    .map(h => h.textContent.trim()).filter(t => t && t.length < 120);

  // All links for BFS queue
  const links = [...document.querySelectorAll('a[href]')]
    .map(a => a.href)
    .filter(h => h && !/^(javascript|mailto|tel)/.test(h));

  return { title, path, forms, navLinks, tables, headings, links };
};

// â”€â”€ Crawl runner â€” Puppeteer-based â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runCrawl(job, projectId, userId) {
  const { url: startUrl, login, max_pages = 15, max_depth = 2 } = job.config;
  const db = getDb();

  job.log.push(`Starting crawl of ${startUrl}`);
  job.log.push(`Mode: headless browser (supports React/Vue/Angular SPAs)`);
  job.log.push(`Settings: max ${max_pages} pages, depth ${max_depth}`);
  if (login?.username) job.log.push(`Using credential: ${login.username}`);

  let origin;
  try {
    origin = new URL(startUrl).origin;
  } catch (_) {
    job.status = 'error';
    job.log.push(`Invalid URL: ${startUrl}`);
    return;
  }

  let browser;
  try {
    browser = await launchBrowser(msg => job.log.push(msg));

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Spoof automation flags so the SPA doesn't detect headless Chrome and blank out
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      window.chrome = { runtime: {} };
    });

    // â”€â”€ Login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (login?.username && login?.password) {
      let loggedIn = false;

      // Navigate to login URL (or start URL) and follow wherever the app redirects â€”
      // SPAs will redirect unauthenticated users to their own login route automatically.
      const seedUrl = login.url || startUrl;
      job.log.push(`Navigating to: ${seedUrl}`);

      // Fire navigation without waiting â€” let waitForSelector be the gatekeeper.
      // This avoids timeout errors on SPAs that keep network connections open indefinitely.
      page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: 0 }).catch(() => {});

      // Wait for the login form to actually appear in the DOM (up to 30s)
      try {
        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 30000 });
        job.log.push(`  Login form appeared at: ${page.url()}`);
      } catch (_) {
        job.log.push(`  Login form did not appear at: ${page.url()}`);
        job.log.push(`  Tip: set the exact Login Page URL in Crawler Credentials`);
      }

      await new Promise(r => setTimeout(r, 1000));

      // Inspect what's on the page now
      {
        const loginUrl = page.url();
        job.log.push(`Checking for login form at: ${loginUrl}`);
        try {

          // Inspect all visible inputs for debugging
          const visibleInputs = await page.evaluate(() =>
            [...document.querySelectorAll('input')]
              .filter(i => !['hidden','submit','button','reset','image'].includes(i.type))
              .map(i => ({ type: i.type || 'text', name: i.name || '', id: i.id || '', placeholder: i.placeholder || '' }))
          );

          if (visibleInputs.length === 0) {
            job.log.push(`  No inputs found on this page â€” will crawl as guest`);
            throw new Error('no inputs');
          }
          job.log.push(`  Inputs found: ${visibleInputs.map(i => `${i.type}[${i.name || i.id || i.placeholder}]`).join(', ')}`);

          // Find the best username input
          const userInput = visibleInputs.find(i =>
            i.type === 'email' ||
            /email|user|login|username|uname/i.test(i.name + i.id + i.placeholder)
          ) || visibleInputs.find(i => i.type === 'text')
            || visibleInputs[0];

          const pwInput = visibleInputs.find(i => i.type === 'password') ||
            (login.password_field ? visibleInputs.find(i => i.name === login.password_field || i.id === login.password_field) : null);

          if (!pwInput) {
            job.log.push(`  No password field found â€” will crawl as guest`);
            throw new Error('no password field');
          }

          // Build selectors from discovered inputs
          const toSel = inp => {
            if (!inp) return null;
            if (inp.name) return `input[name="${inp.name}"]`;
            if (inp.id)   return `#${inp.id}`;
            if (inp.placeholder) return `input[placeholder="${inp.placeholder}"]`;
            return `input[type="${inp.type}"]`;
          };

          const userSel = login.username_field
            ? `[name="${login.username_field}"], [id="${login.username_field}"]`
            : toSel(userInput);

          const pwSel = login.password_field
            ? `[name="${login.password_field}"], [id="${login.password_field}"]`
            : toSel(pwInput);

          // Fill username
          if (userSel) {
            await page.click(userSel, { clickCount: 3 });
            await page.type(userSel, login.username, { delay: 40 });
            job.log.push(`  Filled username (${userSel})`);
          }

          // Fill password
          await page.click(pwSel, { clickCount: 3 });
          await page.type(pwSel, login.password, { delay: 40 });
          job.log.push(`  Filled password (${pwSel})`);

          // Submit
          const beforeUrl = page.url();
          const submitSel = 'button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])';
          try {
            await Promise.all([
              page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
              page.click(submitSel),
            ]);
          } catch (_) {
            // SPA client-side login â€” press Enter and wait for network to settle
            await page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 3000));
            try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }); } catch (_) {}
          }

          const afterLoginUrl = page.url();
          job.log.push(`  Submitted â†’ ${afterLoginUrl}`);

          // Verify login succeeded: URL changed or no longer shows a password field
          const stillHasPwField = await page.$('input[type="password"]').then(el => !!el).catch(() => false);
          if (afterLoginUrl !== beforeUrl || !stillHasPwField) {
            job.log.push(`  Login successful`);
            loggedIn = true;
          } else {
            job.log.push(`  Login may have failed (still on same page with password field)`);
            loggedIn = true; // proceed anyway â€” might be a SPA state change
          }
        } catch (err) {
          job.log.push(`  Error at ${loginUrl}: ${err.message}`);
        }
      }

      if (!loggedIn) job.log.push(`Could not log in â€” crawling as guest`);
    }

    // â”€â”€ BFS crawl â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const visited = new Set();
    const queue = [{ url: startUrl, depth: 0 }];
    const allCases = [];
    const seenTitles = new Set();

    while (queue.length > 0 && visited.size < max_pages) {
      if (job.cancelled) {
        job.log.push('Crawl stopped by user.');
        break;
      }
      const item = queue.shift();
      if (!item) break;
      const { url: currentUrl, depth } = item;

      let normUrl;
      try {
        const u = new URL(currentUrl);
        u.hash = '';
        normUrl = u.href;
      } catch (_) { continue; }

      if (visited.has(normUrl) || depth > max_depth) continue;
      if (!normUrl.startsWith(origin)) continue;
      if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|ttf|pdf|zip|xml|json)(\?|$)/i.test(normUrl)) continue;

      visited.add(normUrl);
      job.progress.current = visited.size;
      job.progress.total = Math.max(visited.size + queue.length, max_pages);
      job.log.push(`[${visited.size}/${max_pages}] ${normUrl}`);

      try {
        if (job.cancelled) break;

        // domcontentloaded fires early; then wait for React to render
        await page.goto(normUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Interruptible settle wait â€” checks cancelled every 500ms
        for (let i = 0; i < 6; i++) {
          if (job.cancelled) break;
          await new Promise(r => setTimeout(r, 500));
        }
        if (job.cancelled) break;

        const data = await page.evaluate(EXTRACT_PAGE);

        // Capture screenshot of this page
        try {
          const shot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60, fullPage: false });
          job.screenshots.push({ url: normUrl, title: data.title || normUrl, screenshot: shot });
        } catch (_) {}

        job.log.push(`  -> "${data.title}" | forms: ${data.forms.length}, nav: ${data.navLinks.length}, links: ${data.links.length}`);

        const pageCases = generateCases(
          { title: data.title, path: data.path, forms: data.forms, navLinks: data.navLinks, tables: data.tables },
          origin,
          login
        );
        for (const tc of pageCases) {
          if (!seenTitles.has(tc.title)) {
            seenTitles.add(tc.title);
            allCases.push(tc);
          }
        }

        if (depth < max_depth) {
          for (const link of data.links) {
            try {
              const lu = new URL(link);
              lu.hash = '';
              const ln = lu.href;
              if (!visited.has(ln) && ln.startsWith(origin)) {
                queue.push({ url: ln, depth: depth + 1 });
              }
            } catch (_) {}
          }
        }
      } catch (err) {
        job.log.push(`  Error: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, 300));
    }

    await browser.close();
    browser = null;

    // â”€â”€ Save test cases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const stopReason = job.cancelled ? 'Crawl stopped' : 'Crawl complete';
    job.log.push(`\n${stopReason}. ${visited.size} page(s) visited, ${allCases.length} test case(s) generated.`);
    job.log.push('Saving to databaseâ€¦');

    let suite;
    try {
      suite = await db.prepare(`SELECT id FROM test_suites WHERE project_id = ? AND name = ?`).get(projectId, 'Auto-Crawled');
    } catch (_) {}

    if (!suite) {
      const sid = uuidv4();
      await db.prepare(`INSERT INTO test_suites (id, project_id, name, description) VALUES (?, ?, ?, ?)`).run(
        sid, projectId, 'Auto-Crawled',
        `Auto-generated by Web Crawler on ${new Date().toISOString().slice(0, 10)}`
      );
      suite = { id: sid };
    }

    // Re-crawling the same site - at a greater depth, say - regenerates cases for
    // pages that were already covered. Inserting them again would leave two
    // copies of every earlier case, so existing titles are skipped and a deeper
    // crawl adds only what it newly found.
    const existingTitles = new Set(
      (await db.prepare(`SELECT title FROM test_cases WHERE project_id = ?`).all(projectId))
        .map(r => String(r.title).trim().toLowerCase())
    );

    let saved = 0, skipped = 0, failed = 0;
    for (const tc of allCases) {
      const key = String(tc.title || '').trim().toLowerCase();
      if (existingTitles.has(key)) { skipped++; continue; }
      try {
        await db.prepare(`
          INSERT INTO test_cases
            (id, suite_id, project_id, title, description, preconditions, steps, expected_result, priority, tags, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          uuidv4(), suite.id, projectId,
          tc.title, tc.description || null, tc.preconditions || null,
          JSON.stringify(tc.steps || []),
          tc.steps?.[tc.steps.length - 1]?.expected || null,
          tc.priority || 'medium',
          JSON.stringify(tc.tags || []),
          userId
        );
        existingTitles.add(key);   // guard against repeats within one crawl too
        saved++;
      } catch (err) {
        // Previously swallowed, so a crawl could report success having saved
        // nothing. Count it and say so.
        failed++;
        job.log.push(`  could not save "${tc.title}": ${err.message}`);
      }
    }

    // Say what actually happened, so a low "saved" number is never mistaken for
    // a failed crawl.
    const parts = [`Saved ${saved} new test case(s) to the "Auto-Crawled" suite.`];
    if (skipped) parts.push(`${skipped} already existed in this project and were skipped.`);
    if (failed) parts.push(`${failed} could not be saved.`);
    job.log.push(parts.join(' '));
    job.status = job.cancelled ? 'stopped' : 'done';
    job.result = {
      pages_crawled: visited.size,
      cases_generated: allCases.length,
      cases_saved: saved,
      cases_skipped: skipped,
      cases_failed: failed,
      suite_id: suite.id,
    };
  } catch (err) {
    job.status = 'error';
    job.log.push(`Fatal: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// â”€â”€ Credential CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/projects/:projectId/crawl/credentials
router.get('/credentials', async (req, res) => {
  const db = getDb();
  const rows = await db.prepare(
    `SELECT id, label, url_pattern, login_url, username, username_field, password_field, updated_at
     FROM crawler_credentials WHERE project_id = ? ORDER BY updated_at DESC`
  ).all(req.params.projectId);
  // has_password flag instead of raw password
  res.json(rows.map(r => ({ ...r, has_password: true })));
});

// POST /api/projects/:projectId/crawl/credentials
router.post('/credentials', requireAdmin, async (req, res) => {
  const { label, url_pattern, login_url = '', username, password, username_field = '', password_field = '' } = req.body;
  if (!url_pattern) return res.status(400).json({ error: 'url_pattern is required' });
  if (!username)    return res.status(400).json({ error: 'username is required' });
  if (!password)    return res.status(400).json({ error: 'password is required' });
  const db = getDb();
  const id = uuidv4();
  await db.prepare(`
    INSERT INTO crawler_credentials
      (id, project_id, label, url_pattern, login_url, username, password, username_field, password_field)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.projectId, label || url_pattern, url_pattern, login_url, username, password, username_field, password_field);
  res.status(201).json({ id });
});

// PUT /api/projects/:projectId/crawl/credentials/:credId
router.put('/credentials/:credId', requireAdmin, async (req, res) => {
  const { label, url_pattern, login_url = '', username, password, username_field = '', password_field = '' } = req.body;
  if (!url_pattern) return res.status(400).json({ error: 'url_pattern is required' });
  if (!username)    return res.status(400).json({ error: 'username is required' });
  const db = getDb();
  const existing = await db.prepare(
    `SELECT password, url_pattern, login_url FROM crawler_credentials WHERE id = ? AND project_id = ?`)
    .get(req.params.credId, req.params.projectId);
  if (!existing) return res.status(404).json({ error: 'Credential not found' });

  // Omitting the password keeps the stored one, which is what lets the form be
  // saved without retyping it. That is fine while the destination is unchanged
  // - but combined with an editable url_pattern it would let someone redirect a
  // password they do not know to a host they control, and the crawler would
  // type it into their login form. Moving the target therefore costs a password.
  const movingTarget =
    String(url_pattern) !== String(existing.url_pattern || '')
    || String(login_url) !== String(existing.login_url || '');
  if (movingTarget && !password) {
    return res.status(400).json({
      error: 'Re-enter the password to change the URL pattern or login URL for this credential',
    });
  }

  const passwordToSave = password && password !== '' ? password : existing.password;
  await db.prepare(`
    UPDATE crawler_credentials
    SET label=?, url_pattern=?, login_url=?, username=?, password=?,
        username_field=?, password_field=?, updated_at=?
    WHERE id=? AND project_id=?
  `).run(label || url_pattern, url_pattern, login_url, username, passwordToSave,
         username_field, password_field, nowISO(), req.params.credId, req.params.projectId);
  res.json({ ok: true });
});

// DELETE /api/projects/:projectId/crawl/credentials/:credId
router.delete('/credentials/:credId', requireAdmin, async (req, res) => {
  const db = getDb();
  await db.prepare(`DELETE FROM crawler_credentials WHERE id = ? AND project_id = ?`)
    .run(req.params.credId, req.params.projectId);
  res.json({ ok: true });
});

// â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/projects/:projectId/crawl/start
router.post('/start', async (req, res) => {
  const { projectId } = req.params;
  const { url, login: loginOverride, max_pages = 15, max_depth = 2 } = req.body;

  if (!url) return res.status(400).json({ error: 'url is required' });

  try { new URL(url); } catch (_) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Auto-match saved credential by URL pattern (longest match wins)
  const db = getDb();
  const allCreds = await db.prepare(
    `SELECT * FROM crawler_credentials WHERE project_id = ? ORDER BY length(url_pattern) DESC`
  ).all(projectId);
  const matchedCred = allCreds.find(c => {
    try {
      const targetOrigin = new URL(url).origin;
      const patternOrigin = new URL(
        c.url_pattern.startsWith('http') ? c.url_pattern : `https://${c.url_pattern}`
      ).origin;
      return targetOrigin === patternOrigin || url.startsWith(c.url_pattern);
    } catch (_) {
      return url.includes(c.url_pattern);
    }
  });
  const login = loginOverride || (matchedCred ? {
    url: matchedCred.login_url || '',
    username: matchedCred.username,
    password: matchedCred.password,
    username_field: matchedCred.username_field || '',
    password_field: matchedCred.password_field || '',
  } : null);

  const jobId = uuidv4();
  const job = {
    id: jobId,
    status: 'running',
    config: { url, login, max_pages: Math.min(Number(max_pages) || 15, 50), max_depth: Math.min(Number(max_depth) || 2, 5) },
    progress: { current: 0, total: 0 },
    log: [],
    result: null,
    screenshots: [],
    created_at: new Date().toISOString(),
  };
  jobs.set(jobId, job);
  
  // A serverless function is frozen the moment it responds, so a crawl left
  // running in the background never progresses - and the job lives in memory,
  // so a later status poll can land on an instance that has never heard of it.
  // Finish the work before replying, and hand the completed job back alongside
  // the id so the caller need not rely on polling reaching the same instance.
  if (isServerless()) {
    job.config.max_pages = Math.min(job.config.max_pages, SERVERLESS_MAX_PAGES);
    try {
      await runCrawl(job, projectId, req.user.id);
    } catch (err) {
      job.status = 'error';
      job.log.push(`Fatal error: ${err.message}`);
    }
    return res.json({ job_id: jobId, job });
  }
  
  // Locally the process persists, so the crawl can run in the background and
  // the client can poll it for progress.
  // This outlives the request, and therefore the request's tenant context.
  // Without re-establishing it the job has no app.tenant_id, so every row it
  // tries to save is rejected by row-level security - and the crawl would
  // report success having written nothing.
  const tenantId = req.user.tenant_id;
  withTenant(getPool(), tenantId, () => runCrawl(job, projectId, req.user.id))
    .catch(err => {
      job.status = 'error';
      job.log.push(`Fatal error: ${err.message}`);
    });
  
  res.json({ job_id: jobId });
});

// GET /api/projects/:projectId/crawl/status/:jobId
router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    log: job.log,
    result: job.result,
    screenshots: job.screenshots,
  });
});

// POST /api/projects/:projectId/crawl/stop/:jobId
router.post('/stop/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'running') return res.json({ ok: true });
  job.cancelled = true;
  res.json({ ok: true });
});

// â”€â”€ Session Recording â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const sessions = new Map();

function generateCasesFromRecording(events) {
  const cases = [];
  const pages = [];
  let current = null;

  for (const e of events) {
    if (e.type === 'navigate') {
      if (current && current.events.length > 0) pages.push(current);
      current = { url: e.url, title: e.title || e.url, events: [] };
    } else if (current) {
      current.events.push(e);
    } else {
      current = { url: e.url || '', title: e.title || '', events: [e] };
    }
  }
  if (current) pages.push(current);

  for (const pg of pages) {
    const steps = [];
    const pageLabel = pg.title && pg.title !== pg.url ? pg.title : pg.url;
    steps.push({ action: `Navigate to ${pg.url}`, expected: `"${pageLabel}" page loads successfully` });

    let hasSubmit = false;
    for (const e of pg.events) {
      if (e.type === 'click') {
        steps.push({ action: `Click "${e.text}"`, expected: `The "${e.text}" action is triggered and the page responds` });
      } else if (e.type === 'input') {
        steps.push({ action: `Enter "${e.value}" into the "${e.field}" field`, expected: 'Field accepts the input' });
      } else if (e.type === 'submit') {
        const fieldNames = (e.fields || []).map(f => `"${f.name}"`).join(', ');
        if (fieldNames) steps.push({ action: `Fill in form fields: ${fieldNames}`, expected: 'All fields accept valid input' });
        steps.push({ action: 'Submit the form', expected: 'Form is submitted and a success response or page redirect occurs' });
        hasSubmit = true;
      }
    }

    if (steps.length > 1) {
      cases.push({
        title: hasSubmit ? `Submit form on "${pageLabel}"` : `Verify "${pageLabel}" page interactions`,
        description: `Recorded from manual browsing session on ${pg.url}`,
        preconditions: null,
        steps,
        priority: hasSubmit ? 'high' : 'medium',
        tags: ['recorded', 'manual'],
      });
    }
  }

  return cases;
}

// POST /record/start
router.post('/record/start', async (req, res) => {
  const { url } = req.body;
  const sessionId = uuidv4();
  const session = {
    id: sessionId,
    status: 'recording',
    events: [],
    currentUrl: url || '',
    currentTitle: '',
    browser: null,
  };
  sessions.set(sessionId, session);

  try {
    const browser = await launchBrowser(() => {}, { visible: true });
    session.browser = browser;

    const page = (await browser.pages())[0];

    // Expose function so injected scripts can send events to Node
    await page.exposeFunction('__captureEvent', event => {
      session.events.push({ ...event, timestamp: Date.now() });
      if (event.url) session.currentUrl = event.url;
      if (event.title) session.currentTitle = event.title;
    });

    // Inject event listeners on every page load
    await page.evaluateOnNewDocument(() => {
      // track form inputs on blur
      document.addEventListener('focusout', e => {
        const el = e.target;
        if (!['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) return;
        if (['hidden','submit','button','reset','image'].includes(el.type)) return;
        const val = el.type === 'password' ? '[password entered]' : (el.value || '').slice(0, 100);
        if (!val) return;
        window.__captureEvent({ type: 'input', field: el.placeholder || el.name || el.id || el.type, value: val, url: location.href, title: document.title });
      }, true);

      // track meaningful clicks
      document.addEventListener('click', e => {
        const el = e.target.closest('button, a, [role="button"], input[type="submit"], input[type="button"]') || e.target;
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
        if (!text || text.length < 2) return;
        window.__captureEvent({ type: 'click', text, tag: el.tagName.toLowerCase(), url: location.href, title: document.title });
      }, true);

      // track form submits
      document.addEventListener('submit', e => {
        const form = e.target;
        const fields = [...form.querySelectorAll('input:not([type="hidden"]),textarea,select')]
          .map(i => ({ name: i.placeholder || i.name || i.id || i.type, type: i.type, value: i.type === 'password' ? '[password]' : (i.value || '').slice(0, 100) }))
          .filter(f => f.name);
        window.__captureEvent({ type: 'submit', fields, url: location.href, title: document.title });
      }, true);
    });

    // Track page navigation
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return;
      const navUrl = frame.url();
      if (navUrl === 'about:blank') return;
      session.events.push({ type: 'navigate', url: navUrl, title: '', timestamp: Date.now() });
      session.currentUrl = navUrl;
    });

    // If browser is closed by user
    browser.on('disconnected', () => {
      if (session.status === 'recording') session.status = 'stopped';
    });

    if (url) {
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (_) {}
    }

    res.json({ session_id: sessionId });
  } catch (err) {
    session.status = 'error';
    res.status(500).json({ error: err.message });
  }
});

// GET /record/status/:sessionId
router.get('/record/status/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    id: session.id,
    status: session.status,
    currentUrl: session.currentUrl,
    currentTitle: session.currentTitle,
    eventCount: session.events.length,
    events: session.events.slice(-50), // last 50 events for live feed
  });
});

// POST /record/stop/:sessionId  â€” close browser, generate & save test cases
router.post('/record/stop/:sessionId', async (req, res) => {
  const { projectId } = req.params;
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.status = 'saving';
  try { if (session.browser) await session.browser.close(); } catch (_) {}

  const cases = generateCasesFromRecording(session.events);
  const db = getDb();

  let suite = await db.prepare(`SELECT id FROM test_suites WHERE project_id = ? AND name = ?`).get(projectId, 'Recorded Sessions');
  if (!suite) {
    const sid = uuidv4();
    await db.prepare(`INSERT INTO test_suites (id, project_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(sid, projectId, 'Recorded Sessions', 'Test cases generated from manual browser recording sessions', nowISO());
    suite = { id: sid };
  }

  let saved = 0;
  for (const tc of cases) {
    try {
      await db.prepare(`INSERT INTO test_cases (id, suite_id, project_id, title, description, preconditions, steps, expected_result, priority, tags, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), suite.id, projectId, tc.title, tc.description || null, tc.preconditions || null,
          JSON.stringify(tc.steps || []), tc.steps?.at(-1)?.expected || null,
          tc.priority || 'medium', JSON.stringify(tc.tags || []), req.user.id);
      saved++;
    } catch (_) {}
  }

  session.status = 'done';
  res.json({ cases_generated: cases.length, cases_saved: saved, suite_id: suite.id });
});

module.exports = router;
