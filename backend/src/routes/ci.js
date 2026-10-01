const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, getPool, nowISO } = require('../db/database');
const { withTenant } = require('../db/tenantContext');
const { enforceSubscription } = require('../middleware/subscription');

const router = express.Router();

// Express 4 does not catch rejections from async handlers: an unhandled
// rejection sends no response at all, so the caller (a CI job, say) hangs until
// it times out rather than seeing an error. Wrapping every handler turns a
// throw into a normal 500 that CI can read and fail fast on.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// â”€â”€ API Key auth middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function ciAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'X-API-Key header required' });

  // A pipeline presents only a key, so which workspace it belongs to is the
  // thing being looked up - and `users` is policy-scoped. Querying it directly
  // here finds nothing no matter how valid the key is, which is exactly how
  // this broke: every CI call answered "Invalid API key".
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM find_api_key($1)', [key]);
  const found = rows[0];
  if (!found) return res.status(401).json({ error: 'Invalid API key' });
  if (found.is_active === false) return res.status(401).json({ error: 'This account has been deactivated' });
  if (found.tenant_status === 'suspended') {
    return res.status(403).json({ error: 'This workspace has been suspended.' });
  }

  // Everything downstream runs inside the key's workspace. Held until the
  // response finishes rather than until next() returns: next() hands off to the
  // route and comes straight back, and releasing the connection there would
  // clear the tenant while the handler was still querying.
  return await withTenant(pool, found.tenant_id, async () => {
    const db = getDb();
    const tenant = await db.prepare(
      'SELECT id, name, slug, status, plan, plan_code, max_users, trial_ends_at FROM tenants WHERE id = ?'
    ).get(found.tenant_id);

    req.user = {
      id: found.user_id, tenant_id: found.tenant_id, name: found.name,
      email: found.email, role: found.role, is_active: found.is_active,
    };
    req.tenant = tenant;

    return await new Promise((resolve, reject) => {
      res.on('finish', resolve);
      res.on('close', resolve);
      // A lapsed trial makes a pipeline read-only too. Reporting results is a
      // write, so CI fails loudly rather than appearing to pass while nothing
      // is recorded.
      try { enforceSubscription(req, res, next); } catch (err) { reject(err); }
    });
  });
}

router.use(wrap(ciAuth));

// â”€â”€ GET /api/ci/projects/:projectId/cases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// List test cases so CI can map titles â†’ IDs
router.get('/projects/:projectId/cases', wrap(async (req, res) => {
  const db = getDb();
  const cases = await db.prepare(`
    SELECT tc.id, tc.title, tc.priority, tc.automation_status, tc.automation_framework, tc.script_path,
      ts.name as suite_name
    FROM test_cases tc
    LEFT JOIN test_suites ts ON tc.suite_id = ts.id
    WHERE tc.project_id = ? AND tc.status = 'active'
    ORDER BY tc.title
  `).all(req.params.projectId);
  res.json(cases);
}));

// â”€â”€ POST /api/ci/projects/:projectId/runs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Create a new test run from CI (optionally with specific case titles)
router.post('/projects/:projectId/runs', wrap(async (req, res) => {
  const { name, description, build_version, environment, case_titles = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const db = getDb();

  // Resolve case IDs â€” if case_titles given, match; otherwise include all active cases
  let caseIds;
  if (case_titles.length > 0) {
    const rows = await db.prepare(`
      SELECT id, title FROM test_cases
      WHERE project_id = ? AND status = 'active'
    `).all(req.params.projectId);
    const normalise = s => s.toLowerCase().replace(/[\s_\-]/g, '');
    caseIds = case_titles
      .map(t => rows.find(r => normalise(r.title) === normalise(t))?.id)
      .filter(Boolean);
    if (caseIds.length === 0) {
      return res.status(400).json({ error: 'No matching test cases found for the given case_titles' });
    }
  } else {
    const activeRows = await db.prepare(`SELECT id FROM test_cases WHERE project_id = ? AND status = 'active'`)
      .all(req.params.projectId);
    caseIds = activeRows.map(r => r.id);
    if (caseIds.length === 0) {
      return res.status(400).json({ error: 'No active test cases in this project' });
    }
  }

  const runId = uuidv4();
  await db.prepare(`
    INSERT INTO test_runs (id, project_id, name, description, build_version, environment, created_by, run_source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ci', ?)
  `).run(runId, req.params.projectId, name, description || null, build_version || null, environment || null, req.user.id, nowISO());

  const insert = db.prepare('INSERT INTO test_run_items (id, run_id, test_case_id) VALUES (?, ?, ?)');
  for (const id of caseIds) await insert.run(uuidv4(), runId, id);

  res.status(201).json({ id: runId, name, case_count: caseIds.length });
}));

// â”€â”€ POST /api/ci/runs/:runId/results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Push results for test cases. Each result: { title, status, notes, duration_ms }
// status values: passed | failed | blocked | skipped
router.post('/runs/:runId/results', wrap(async (req, res) => {
  const { results = [] } = req.body;
  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'results array is required' });
  }

  const db = getDb();
  const run = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status === 'completed') return res.status(423).json({ error: 'Run is locked' });

  const items = await db.prepare(`
    SELECT tri.id, tc.title FROM test_run_items tri
    JOIN test_cases tc ON tri.test_case_id = tc.id
    WHERE tri.run_id = ?
  `).all(req.params.runId);

  const normalise = s => s.toLowerCase().replace(/[\s_\-\.]/g, '');
  const update = db.prepare(`
    UPDATE test_run_items SET status=?, notes=?, executed_by=?, executed_at=?, duration=?
    WHERE id=?
  `);

  let matched = 0, unmatched = 0;
  for (const result of results) {
    const norm = normalise(result.title || '');
    const item = items.find(i => normalise(i.title) === norm ||
      normalise(i.title).includes(norm) || norm.includes(normalise(i.title)));
    if (item) {
      const status = ['passed', 'failed', 'blocked', 'skipped'].includes(result.status) ? result.status : 'failed';
      await update.run(status, result.notes || null, req.user.id, nowISO(),
        result.duration_ms ? Math.round(result.duration_ms / 1000) : null, item.id);
      matched++;
    } else {
      unmatched++;
    }
  }

  // Move to in_progress on first result push
  if (matched > 0) {
    await db.prepare(`
      UPDATE test_runs SET status='in_progress', started_at=COALESCE(started_at, ?)
      WHERE id=? AND status='pending'
    `).run(nowISO(), req.params.runId);
  }

  res.json({ matched, unmatched, total_results: results.length });
}));

// â”€â”€ POST /api/ci/runs/:runId/complete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Mark the run as complete from CI (locks it)
router.post('/runs/:runId/complete', wrap(async (req, res) => {
  const db = getDb();
  const run = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status === 'completed') return res.status(400).json({ error: 'Run already completed' });

  // Force-complete from CI even if some cases are still pending (CI controls this)
  await db.prepare(`
    UPDATE test_run_items SET status='skipped', executed_by=?, executed_at=?
    WHERE run_id=? AND status='pending'
  `).run(req.user.id, nowISO(), req.params.runId);

  await db.prepare(`UPDATE test_runs SET status='completed', completed_at=? WHERE id=?`)
    .run(nowISO(), req.params.runId);

  const stats = await db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='passed' THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) as skipped
    FROM test_run_items WHERE run_id=?
  `).get(req.params.runId);

  res.json({ success: true, ...stats });
}));

// â”€â”€ DELETE /api/ci/runs/:runId â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Delete an orphan run created by a failed CI workflow setup
router.delete('/runs/:runId', wrap(async (req, res) => {
  const db = getDb();
  const run = await db.prepare('SELECT id, status FROM test_runs WHERE id = ?').get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status === 'completed') return res.status(423).json({ error: 'Cannot delete a completed run' });
  await db.prepare('DELETE FROM test_run_items WHERE run_id = ?').run(req.params.runId);
  await db.prepare('DELETE FROM test_runs WHERE id = ?').run(req.params.runId);
  res.json({ success: true, deleted: req.params.runId });
}));

// â”€â”€ GET /api/ci/runs/:runId â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Check run status (so CI can poll or verify)
router.get('/runs/:runId', wrap(async (req, res) => {
  const db = getDb();
  const run = await db.prepare('SELECT id, name, status, run_source, created_at, completed_at FROM test_runs WHERE id = ?').get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const stats = await db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='passed' THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) as skipped,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending
    FROM test_run_items WHERE run_id=?
  `).get(run.id);
  res.json({ ...run, ...stats });
}));

router.use((err, req, res, _next) => {
  console.error('CI route error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = router;
