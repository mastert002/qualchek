const express = require('express');
const { getDb } = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

// â”€â”€â”€ Script generators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Strip leading articles and filler words from a field label
function cleanFieldName(raw) {
  return raw
    .replace(/^(the|a|an|your|this|that)\s+/gi, '')
    .replace(/\s+(field|input|box|area|textbox|textarea)$/gi, '')
    .replace(/['"]/g, '')
    .trim();
}

// Extract a URL from anywhere in a step string
function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s'"]+/);
  return match ? match[0].replace(/[.,)]+$/, '') : null;
}

// Extract first quoted value from a string
function extractQuoted(text) {
  const match = text.match(/"([^"]+)"/);
  return match ? match[1] : null;
}

// Parse "enter X into Y" / "enter X in Y" â€” returns { value, field } or null
function parseEnterStep(action) {
  const quoted = action.match(/(?:enter|type|fill|input)\s+"([^"]+)"\s+(?:in(?:to)?|on|in the|into the)\s+"?([^"]+)"?/i);
  if (quoted) return { value: quoted[1], field: cleanFieldName(quoted[2]) };

  const unquoted = action.match(/(?:enter|type|fill|input)\s+(.+?)\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)/i);
  if (unquoted) return { value: unquoted[1].trim(), field: cleanFieldName(unquoted[2]) };

  return null;
}

// Detect if a test case requires login
function needsLogin(tc) {
  const pre = (tc.preconditions || '').toLowerCase();
  const steps = tc.steps || [];
  return pre.includes('valid account') || pre.includes('login') || pre.includes('logged in') ||
    steps.some(s => /^(log in|login|sign in|enter.*email|enter.*password|enter.*username)/i.test(s.action || ''));
}

function stepToPlaywright(step) {
  const a = (step.action || '').trim();
  const lower = a.toLowerCase();

  if (/^(navigate|go to|open|visit|launch|open browser|browse to)/.test(lower)) {
    const url = extractUrl(a);
    if (url) return `  await page.goto('${url}');`;
    return `  // TODO: await page.goto('URL_HERE'); â€” ${a}`;
  }
  if (/^click/.test(lower)) {
    const raw = a.replace(/^click\s*(on\s+)?(the\s+)?/i, '').replace(/['"]/g, '').trim();
    if (/button|btn|submit|sign in|login|log in/i.test(raw)) {
      const label = raw.replace(/\s*button$/i, '').trim();
      return `  await page.getByRole('button', { name: '${label}' }).click();`;
    }
    return `  await page.click('text=${raw}');`;
  }
  if (/^(enter|type|fill|input)/.test(lower) && /password/.test(lower)) {
    const value = extractQuoted(a);
    if (value) return `  await page.fill('input[type="password"]', '${value}');`;
    return `  await page.fill('input[type="password"]', process.env.PASSWORD || '');`;
  }
  if (/^(enter|type|fill|input)/.test(lower) && /(email|username|user name)/.test(lower)) {
    const value = extractQuoted(a);
    if (value) return `  await page.fill('input[type="email"], input[name="email"]', '${value}');`;
    return `  await page.fill('input[type="email"], input[name="email"]', process.env.EMAIL || '');`;
  }
  if (/^(enter|type|fill|input)/.test(lower)) {
    const parsed = parseEnterStep(a);
    if (parsed) {
      return `  await page.fill('[placeholder*="${parsed.field}" i], [name="${parsed.field}"], [aria-label*="${parsed.field}" i]', '${parsed.value}');`;
    }
    const value = extractQuoted(a);
    if (value) return `  await page.fill('input', '${value}');`;
    return `  // TODO: await page.fill('selector', 'value'); â€” ${a}`;
  }
  if (/^select/.test(lower)) {
    const match = a.match(/select\s+"?([^"]+?)"?\s+from\s+(?:the\s+)?"?([^"]+?)"?$/i);
    if (match) return `  await page.selectOption('[name="${cleanFieldName(match[2])}"]', '${match[1].trim()}');`;
    return `  // TODO: ${a}`;
  }
  if (/^wait for|^wait until/.test(lower)) {
    const target = a.replace(/^(wait for|wait until)\s*/i, '').trim();
    return `  await page.waitForSelector('text=${target}');`;
  }
  if (/^verify|^check|^assert|^confirm|^should|^expect/.test(lower)) {
    const what = a.replace(/^(verify|check|assert|confirm|should|expect)\s*/i, '').trim();
    return `  await expect(page.locator('body')).toContainText('${what}');`;
  }
  if (/^scroll/.test(lower)) {
    return `  await page.evaluate(() => window.scrollBy(0, 500));`;
  }
  if (/^submit/.test(lower)) {
    return `  await page.click('[type="submit"]');`;
  }
  if (/^log in|^login|^sign in/.test(lower)) {
    return `  // TODO: perform login â€” fill credentials and submit`;
  }
  return `  // ${a}`;
}

function stepToCypress(step) {
  const a = (step.action || '').trim();
  const lower = a.toLowerCase();

  // Navigate / visit â€” extract actual URL from step text
  if (/^(navigate|go to|open|visit|launch|open browser|browse to)/.test(lower)) {
    const url = extractUrl(a);
    if (url) return `  cy.visit('${url}');`;
    return `  // TODO: cy.visit('URL_HERE'); â€” ${a}`;
  }

  // Click â€” strip quotes and detect buttons vs links
  if (/^click/.test(lower)) {
    const raw = a.replace(/^click\s*(on\s+)?(the\s+)?/i, '').replace(/['"]/g, '').trim();
    if (/button|btn|submit|sign in|login|log in/i.test(raw)) {
      const label = raw.replace(/\s*button$/i, '').trim();
      return `  cy.contains('button', '${label}').click();`;
    }
    return `  cy.contains('${raw}').click();`;
  }

  // Enter password â€” use input[type="password"]
  if (/^(enter|type|fill|input)/.test(lower) && /password/.test(lower)) {
    const value = extractQuoted(a);
    if (value) return `  cy.get('input[type="password"]').type('${value}');`;
    return `  cy.get('input[type="password"]').type(Cypress.env('password'));`;
  }

  // Enter email / username
  if (/^(enter|type|fill|input)/.test(lower) && /(email|username|user name|user id)/.test(lower)) {
    const value = extractQuoted(a);
    if (value) return `  cy.get('input[type="email"], input[name="email"], input[name="username"]').first().type('${value}');`;
    return `  cy.get('input[type="email"], input[name="email"], input[name="username"]').first().type(Cypress.env('email'));`;
  }

  // Enter generic field
  if (/^(enter|type|fill|input)/.test(lower)) {
    const parsed = parseEnterStep(a);
    if (parsed) {
      return `  cy.get('[placeholder*="${parsed.field}" i], [name="${parsed.field}"], [aria-label*="${parsed.field}" i]').first().type('${parsed.value}');`;
    }
    const value = extractQuoted(a);
    if (value) return `  cy.get('input').first().type('${value}');`;
    return `  // TODO: cy.get('selector').type('value'); â€” ${a}`;
  }

  // Select dropdown
  if (/^select/.test(lower)) {
    const match = a.match(/select\s+"?([^"]+?)"?\s+from\s+(?:the\s+)?"?([^"]+?)"?$/i);
    if (match) return `  cy.get('[name="${cleanFieldName(match[2])}"]').select('${match[1].trim()}');`;
    return `  // TODO: ${a}`;
  }

  // Wait
  if (/^wait for|^wait until/.test(lower)) {
    const target = a.replace(/^(wait for|wait until)\s*/i, '').replace(/['"]/g, '').trim();
    return `  cy.contains('${target}', { timeout: 10000 }).should('be.visible');`;
  }

  // Verify / assert
  if (/^(verify|check|assert|confirm|should|expect)/.test(lower)) {
    const what = a.replace(/^(verify|check|assert|confirm|should|expect)\s*/i, '').trim();
    const url = extractUrl(what);
    if (url) return `  cy.url().should('include', '${url}');`;
    if (/url|page loads|redirect|navigat/i.test(what)) return `  cy.url().should('not.include', 'login');`;
    const quoted = extractQuoted(what);
    if (quoted) return `  cy.contains('${quoted}').should('be.visible');`;
    return `  cy.get('body').should('be.visible'); // TODO: assert â€” ${what}`;
  }

  // Scroll
  if (/^scroll/.test(lower)) {
    return `  cy.scrollTo('bottom');`;
  }

  // Submit
  if (/^submit/.test(lower)) {
    return `  cy.get('[type="submit"]').click();`;
  }

  // Login step
  if (/^(log in|login|sign in)/.test(lower)) {
    return `  // Login handled by beforeEach`;
  }

  return `  // TODO: ${a}`;
}

function stepToPytest(step) {
  const a = (step.action || '').trim();
  const lower = a.toLowerCase();

  if (/^navigate to|^go to|^open|^visit/.test(lower)) {
    const url = a.replace(/^(navigate to|go to|open|visit)\s*/i, '').trim();
    return `    page.goto("${url}")`;
  }
  if (/^click/.test(lower)) {
    const target = a.replace(/^click\s*(on\s+)?(the\s+)?/i, '').trim();
    return `    page.get_by_text("${target}").click()`;
  }
  if (/^enter|^type|^fill|^input/.test(lower)) {
    const parsed = parseEnterStep(a);
    if (parsed) return `    page.fill('[placeholder="${parsed.field}"], [name="${parsed.field}"], [aria-label="${parsed.field}"]', "${parsed.value}")`;
    const val = a.replace(/^(enter|type|fill|input)\s*/i, '').trim();
    return `    page.fill('input', "${val}")`;
  }
  if (/^select/.test(lower)) {
    const match = a.match(/select\s+"?([^"]+?)"?\s+from\s+(?:the\s+)?"?([^"]+?)"?$/i);
    if (match) return `    page.select_option('[name="${cleanFieldName(match[2])}"]', "${match[1].trim()}")`;
    return `    # TODO: ${a}`;
  }
  if (/^wait for|^wait until/.test(lower)) {
    const target = a.replace(/^(wait for|wait until)\s*/i, '').trim();
    return `    page.wait_for_selector(f'text="${target}"')`;
  }
  if (/^verify|^check|^assert|^confirm|^should|^expect/.test(lower)) {
    const what = a.replace(/^(verify|check|assert|confirm|should|expect)\s*/i, '').trim();
    return `    expect(page.locator("body")).to_contain_text("${what}")`;
  }
  if (/^scroll/.test(lower)) {
    return `    page.evaluate("window.scrollBy(0, 500)")`;
  }
  if (/^submit/.test(lower)) {
    return `    page.click('[type="submit"]')`;
  }
  if (/^log in|^login|^sign in/.test(lower)) {
    return `    # TODO: perform login â€” fill credentials and submit`;
  }
  return `    # ${a}`;
}

function safeName(title) {
  return title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function generatePlaywright(testCases, projectName) {
  const lines = [
    `// Playwright test suite â€” auto-generated by QualChek`,
    `// Project: ${projectName}`,
    `// Generated: ${new Date().toISOString()}`,
    `// Run with: npx playwright test`,
    ``,
    `import { test, expect } from '@playwright/test';`,
    ``,
  ];

  for (const tc of testCases) {
    const steps = tc.steps || [];
    lines.push(`test('${tc.title.replace(/'/g, "\\'")}', async ({ page }) => {`);

    if (tc.preconditions) {
      lines.push(`  // Preconditions: ${tc.preconditions}`);
    }

    if (steps.length === 0) {
      lines.push(`  // No steps defined â€” add your automation logic here`);
    } else {
      steps.forEach((step, i) => {
        lines.push(`  // Step ${i + 1}: ${step.action}`);
        lines.push(stepToPlaywright(step));
        if (step.expected) {
          lines.push(`  // Expected: ${step.expected}`);
        }
        lines.push('');
      });
    }

    if (tc.expected_result) {
      lines.push(`  // Overall expected result: ${tc.expected_result}`);
    }

    lines.push(`});`);
    lines.push('');
  }

  return lines.join('\n');
}

function generateCypress(testCases, projectName) {
  const anyNeedsLogin = testCases.some(needsLogin);

  // Find login URL from steps
  let loginUrl = null;
  for (const tc of testCases) {
    for (const step of (tc.steps || [])) {
      const lower = (step.action || '').toLowerCase();
      if (/login|sign.?in/.test(lower)) {
        loginUrl = extractUrl(step.action || '');
        if (loginUrl) break;
      }
    }
    if (loginUrl) break;
  }
  if (!loginUrl) loginUrl = 'https://your-app.com/login';

  const lines = [
    `// Cypress test suite â€” auto-generated by QualChek`,
    `// Project: ${projectName}`,
    `// Generated: ${new Date().toISOString()}`,
    `// Run with: npx cypress run`,
    `//`,
    `// Before running, create cypress.env.json at your repo root:`,
    `// {`,
    `//   "email": "your@email.com",`,
    `//   "password": "yourpassword"`,
    `// }`,
    `// Add cypress.env.json to .gitignore â€” never commit credentials.`,
    ``,
    `describe('${projectName.replace(/'/g, "\\'")}', () => {`,
    ``,
  ];

  // Add beforeEach login using cy.session for session caching
  if (anyNeedsLogin) {
    lines.push(`  beforeEach(() => {`);
    lines.push(`    cy.session('authenticated', () => {`);
    lines.push(`      cy.visit('${loginUrl}');`);
    lines.push(`      cy.get('input[type="email"], input[name="email"], input[name="username"]').first().type(Cypress.env('email'));`);
    lines.push(`      cy.get('input[type="password"]').type(Cypress.env('password'));`);
    lines.push(`      cy.contains('button', /sign in|login|log in/i).click();`);
    lines.push(`      cy.url().should('not.include', 'login');`);
    lines.push(`    });`);
    lines.push(`  });`);
    lines.push(``);
  }

  const loginStepPattern = /^(enter|type|fill).*(email|username|password)|^(log in|login|sign in)|^click.*(sign in|login)/i;

  for (const tc of testCases) {
    const steps = tc.steps || [];
    const tcNeedsLogin = needsLogin(tc);

    lines.push(`  it('${tc.title.replace(/'/g, "\\'")}', () => {`);

    if (tc.preconditions) {
      lines.push(`    // Preconditions: ${tc.preconditions}`);
    }

    if (steps.length === 0) {
      lines.push(`    // No steps defined â€” add your automation logic here`);
    } else {
      steps.forEach((step, i) => {
        const action = step.action || '';
        // Skip login steps when beforeEach already handles login
        if (anyNeedsLogin && tcNeedsLogin && loginStepPattern.test(action)) {
          lines.push(`    // Step ${i + 1}: ${action} â€” handled by beforeEach`);
          lines.push('');
          return;
        }
        lines.push(`    // Step ${i + 1}: ${action}`);
        lines.push('  ' + stepToCypress(step));
        if (step.expected) lines.push(`    // Expected: ${step.expected}`);
        lines.push('');
      });
    }

    if (tc.expected_result) {
      lines.push(`    // Overall expected result: ${tc.expected_result}`);
    }

    lines.push(`  });`);
    lines.push('');
  }

  lines.push(`});`);
  return lines.join('\n');
}

function generatePytest(testCases, projectName) {
  const lines = [
    `# Pytest + Playwright test suite â€” auto-generated by QualChek`,
    `# Project: ${projectName}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Run with: pytest --headed`,
    `# Requires: pip install pytest pytest-playwright && playwright install`,
    ``,
    `import pytest`,
    `from playwright.sync_api import Page, expect`,
    ``,
    ``,
  ];

  for (const tc of testCases) {
    const steps = tc.steps || [];
    const fnName = `test_${safeName(tc.title) || 'case'}`;
    lines.push(`def ${fnName}(page: Page):`);
    lines.push(`    """${tc.title}"""`);

    if (tc.preconditions) {
      lines.push(`    # Preconditions: ${tc.preconditions}`);
    }

    if (steps.length === 0) {
      lines.push(`    # No steps defined â€” add your automation logic here`);
      lines.push(`    pass`);
    } else {
      steps.forEach((step, i) => {
        lines.push(`    # Step ${i + 1}: ${step.action}`);
        lines.push(stepToPytest(step));
        if (step.expected) {
          lines.push(`    # Expected: ${step.expected}`);
        }
        lines.push('');
      });
    }

    if (tc.expected_result) {
      lines.push(`    # Overall expected result: ${tc.expected_result}`);
    }

    lines.push('');
    lines.push('');
  }

  return lines.join('\n');
}

// â”€â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// POST /api/projects/:projectId/scripts/export
router.post('/export', async (req, res) => {
  const { test_case_ids, framework = 'playwright', mark_automated = true } = req.body;

  if (!test_case_ids || !test_case_ids.length) {
    return res.status(400).json({ error: 'test_case_ids is required' });
  }
  if (!['playwright', 'cypress', 'pytest'].includes(framework)) {
    return res.status(400).json({ error: 'framework must be playwright, cypress, or pytest' });
  }

  const db = getDb();
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const placeholders = test_case_ids.map(() => '?').join(',');
  const testCases = await db.prepare(
    `SELECT * FROM test_cases WHERE id IN (${placeholders}) AND project_id = ?`
  ).all(...test_case_ids, req.params.projectId);

  if (!testCases.length) return res.status(404).json({ error: 'No matching test cases found' });

  const parsed = testCases.map(tc => ({
    ...tc,
    steps: JSON.parse(tc.steps || '[]'),
    tags: JSON.parse(tc.tags || '[]'),
  }));

  let content, filename, language;
  if (framework === 'playwright') {
    content = generatePlaywright(parsed, project.name);
    filename = `${safeName(project.name) || 'tests'}.spec.js`;
    language = 'javascript';
  } else if (framework === 'cypress') {
    content = generateCypress(parsed, project.name);
    filename = `${safeName(project.name) || 'tests'}.cy.js`;
    language = 'javascript';
  } else {
    content = generatePytest(parsed, project.name);
    filename = `test_${safeName(project.name) || 'cases'}.py`;
    language = 'python';
  }

  // Optionally update automation_status on the test cases
  if (mark_automated) {
    const update = await db.prepare(
      `UPDATE test_cases SET automation_status = 'automated', automation_framework = ? WHERE id = ?`
    );
    for (const tc of testCases) await update.run(framework, tc.id);
  }

  res.json({
    filename,
    language,
    framework,
    content,
    test_cases_exported: testCases.length,
  });
});

// GET /api/projects/:projectId/scripts/preview/:id â€” preview single test case
router.get('/preview/:id', async (req, res) => {
  const { framework = 'playwright' } = req.query;
  const db = getDb();
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  const tc = await db.prepare('SELECT * FROM test_cases WHERE id = ? AND project_id = ?').get(req.params.id, req.params.projectId);
  if (!tc) return res.status(404).json({ error: 'Test case not found' });

  const parsed = { ...tc, steps: JSON.parse(tc.steps || '[]'), tags: JSON.parse(tc.tags || '[]') };
  let content;
  if (framework === 'playwright') content = generatePlaywright([parsed], project?.name || 'Project');
  else if (framework === 'cypress') content = generateCypress([parsed], project?.name || 'Project');
  else content = generatePytest([parsed], project?.name || 'Project');

  res.json({ content, framework });
});

module.exports = router;
