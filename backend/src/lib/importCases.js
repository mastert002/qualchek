// Turning spreadsheet rows into test cases.
//
// The file itself is parsed in the browser, so what arrives here is already
// JSON. That keeps multipart handling, temp files and upload limits out of a
// serverless function entirely, and lets the person see a preview without a
// round trip. It also means this module can be about meaning rather than
// format: everything below is concerned with what a human typed into a cell.

const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['active', 'draft', 'deprecated'];
const AUTOMATION = ['manual', 'automated', 'planned'];

// A spreadsheet has as many rows as somebody felt like pasting. This bounds one
// request to something a single transaction and a serverless timeout can both
// survive; a larger file is imported in more than one go.
const MAX_ROWS = 2000;

const clean = v => (v === undefined || v === null ? '' : String(v).trim());

/** Pick from a known set, case- and space-insensitively, or fall back. */
function oneOf(value, allowed, fallback) {
  const v = clean(value).toLowerCase().replace(/\s+/g, '');
  const hit = allowed.find(a => a === v);
  return hit || fallback;
}

/**
 * Steps as a person actually writes them in a cell.
 *
 * Accepts a numbered or bulleted list across several lines, and an optional
 * expected result per step after a `->`, `=>` or `|`. A single unnumbered
 * paragraph becomes one step rather than being split on sentences - guessing
 * sentence boundaries produces nonsense far more often than it helps.
 */
function parseSteps(raw) {
  const text = clean(raw);
  if (!text) return [];

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const stripLeader = l => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim();

  return lines.map(line => {
    const body = stripLeader(line);
    const split = body.split(/\s*(?:->|=>|\|)\s*/);
    return split.length > 1
      ? { action: split[0].trim(), expected: split.slice(1).join(' ').trim() }
      : { action: body, expected: '' };
  }).filter(s => s.action);
}

/** Tags from a comma, semicolon or pipe separated cell. */
function parseTags(raw) {
  return clean(raw)
    .split(/[,;|]/)
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Validate and normalise one row.
 *
 * @returns {{ok: true, value: object} | {ok: false, reason: string}}
 */
function normaliseRow(row) {
  const title = clean(row.title);
  if (!title) return { ok: false, reason: 'No title' };
  if (title.length > 500) return { ok: false, reason: 'Title is longer than 500 characters' };

  return {
    ok: true,
    value: {
      title,
      description: clean(row.description) || null,
      preconditions: clean(row.preconditions) || null,
      steps: parseSteps(row.steps),
      expected_result: clean(row.expected_result) || null,
      priority: oneOf(row.priority, PRIORITIES, 'medium'),
      status: oneOf(row.status, STATUSES, 'active'),
      tags: parseTags(row.tags),
      automation_status: oneOf(row.automation_status, AUTOMATION, 'manual'),
    },
  };
}

/**
 * Normalise a whole sheet, reporting per-row problems rather than failing the
 * import. A spreadsheet with one bad row in two hundred should import the other
 * hundred and ninety-nine and say which one it skipped - rejecting the file
 * wholesale makes the person hunt for the problem with no clue where it is.
 */
function normaliseRows(rows) {
  const accepted = [];
  const rejected = [];
  rows.slice(0, MAX_ROWS).forEach((row, i) => {
    const out = normaliseRow(row);
    // +2 so the number matches what the person sees in the spreadsheet: rows
    // are 1-based and the first one is the header.
    if (out.ok) accepted.push(out.value);
    else rejected.push({ row: i + 2, title: clean(row.title).slice(0, 60), reason: out.reason });
  });
  return { accepted, rejected, truncated: rows.length > MAX_ROWS };
}

module.exports = { normaliseRows, normaliseRow, parseSteps, parseTags, MAX_ROWS, PRIORITIES, STATUSES, AUTOMATION };
