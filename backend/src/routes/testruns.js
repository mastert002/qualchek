const express = require('express');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const { getDb, nowISO } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const audit = require('../lib/audit');

function parseJUnitXml(xml) {
  const results = [];
  const tcRe = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g;
  let m;
  while ((m = tcRe.exec(xml)) !== null) {
    const attrs = m[1] || m[3] || '';
    const inner = m[2] || '';
    const name = (attrs.match(/name=["']([^"']*)["']/) || [])[1] || '';
    const classname = (attrs.match(/classname=["']([^"']*)["']/) || [])[1] || '';
    const time = parseFloat((attrs.match(/time=["']([^"']*)["']/) || [])[1]) || null;
    let status = 'passed';
    if (/<failure\b/i.test(inner)) status = 'failed';
    else if (/<error\b/i.test(inner)) status = 'failed';
    else if (/<skipped\b/i.test(inner)) status = 'skipped';
    const failMsg = (inner.match(/<(?:failure|error)\b[^>]*message=["']([^"']*)["']/) || [])[1] || '';
    const failText = (inner.match(/<(?:failure|error)\b[^>]*>([\s\S]*?)<\/(?:failure|error)>/) || [])[1]?.trim() || '';
    const notes = failMsg || failText || '';
    results.push({ name, classname, status, duration: time ? Math.round(time * 1000) : null, notes });
  }
  return results;
}

function textToADF(text) {
  const lines = text.split('\n');
  const content = [];
  for (const line of lines) {
    if (line.trim() === '') content.push({ type: 'paragraph', content: [] });
    else content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
  }
  return { version: 1, type: 'doc', content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

function postJiraComment(config, issueKey, text) {
  return new Promise((resolve) => {
    try {
      const url = new URL(`/rest/api/3/issue/${issueKey}/comment`, config.base_url);
      const body = JSON.stringify({ body: textToADF(text) });
      const auth = Buffer.from(`${config.email}:${config.api_token}`).toString('base64');
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(options, (r) => { r.resume(); resolve(); });
      req.on('error', () => resolve());
      req.write(body);
      req.end();
    } catch { resolve(); }
  });
}

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const runs = await db.prepare(`
      SELECT tr.id, tr.project_id, tr.name, tr.description, tr.status,
        tr.build_version, tr.environment, tr.parent_run_id, tr.run_source,
        tr.created_by, tr.created_at, tr.started_at, tr.completed_at,
        u.name as creator_name,
        pr.name as parent_run_name,
        COUNT(tri.id) as total_cases,
        SUM(CASE WHEN tri.status = 'passed' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN tri.status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN tri.status = 'blocked' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN tri.status = 'pending' THEN 1 ELSE 0 END) as pending_count
      FROM test_runs tr
      JOIN users u ON tr.created_by = u.id
      LEFT JOIN test_runs pr ON tr.parent_run_id = pr.id
      LEFT JOIN test_run_items tri ON tri.run_id = tr.id
      WHERE tr.project_id = ?
      GROUP BY tr.id, tr.project_id, tr.name, tr.description, tr.status,
        tr.build_version, tr.environment, tr.parent_run_id, tr.run_source,
        tr.created_by, tr.created_at, tr.started_at, tr.completed_at,
        u.name, pr.name
      ORDER BY tr.created_at DESC
    `).all(req.params.projectId);
    res.json(runs);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/', async (req, res) => {
  try {
    if (req.user.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot create test runs' });
    const { name, description, build_version, environment, test_case_ids = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!test_case_ids.length) return res.status(400).json({ error: 'At least one test case must be selected to create a run.' });
    const db = getDb();
    const id = uuidv4();
    await db.prepare(`INSERT INTO test_runs (id, project_id, name, description, build_version, environment, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.params.projectId, name, description || null, build_version || null, environment || null, req.user.id, nowISO());
    for (const tcId of test_case_ids) {
      await db.prepare('INSERT INTO test_run_items (id, run_id, test_case_id) VALUES (?, ?, ?)').run(uuidv4(), id, tcId);
    }
    const run = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id);
    res.status(201).json(run);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const run = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Test run not found' });
    const items = await db.prepare(`
      SELECT tri.*, tc.title, tc.priority, tc.steps, tc.expected_result, tc.description,
        u.name as executor_name,
        COALESCE(jrl.issue_key, jl.issue_key) AS jira_issue_key
      FROM test_run_items tri
      JOIN test_cases tc ON tri.test_case_id = tc.id
      LEFT JOIN users u ON tri.executed_by = u.id
      LEFT JOIN jira_run_links jrl ON jrl.run_item_id = tri.id
      LEFT JOIN jira_links jl ON jl.test_case_id = tc.id
      WHERE tri.run_id = ?
      ORDER BY tc.priority, tc.title
    `).all(req.params.id);
    res.json({ ...run, items: items.map(i => ({ ...i, steps: JSON.parse(i.steps || '[]') })) });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, status } = req.body;
    const db = getDb();
    const run = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Not found' });
    let started_at = run.started_at;
    let completed_at = run.completed_at;
    if (status === 'in_progress' && !started_at) started_at = new Date().toISOString();
    if (status === 'completed' && !completed_at) completed_at = new Date().toISOString();
    await db.prepare(`UPDATE test_runs SET name=?, description=?, status=?, started_at=?, completed_at=? WHERE id=?`)
      .run(name ?? run.name, description ?? run.description, status ?? run.status, started_at, completed_at, req.params.id);
    res.json(await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete test runs' });
    const db = getDb();
    const goneRun = await db.prepare('SELECT id, name FROM test_runs WHERE id = ?').get(req.params.id);
    await db.prepare('DELETE FROM test_runs WHERE id = ?').run(req.params.id);
    await audit.record(req, 'test_run.deleted', { type: 'test_run', id: req.params.id, label: goneRun ? goneRun.name : null },
      { project_id: req.params.projectId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/:id/items/:itemId', async (req, res) => {
  try {
    if (req.user.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot execute tests' });
    const { status, notes, duration } = req.body;
    const db = getDb();
    const runCheck = await db.prepare('SELECT status FROM test_runs WHERE id = ?').get(req.params.id);
    if (runCheck?.status === 'completed') {
      return res.status(423).json({ error: 'This test run is completed and locked. Create a new retest run to record further results.', locked: true });
    }
    await db.prepare(`UPDATE test_run_items SET status=?, notes=?, executed_by=?, executed_at=?, duration=? WHERE id=?`)
      .run(status, notes || null, req.user.id, nowISO(), duration || null, req.params.itemId);
    const runId = req.params.id;
    const anyExecuted = await db.prepare(`SELECT COUNT(*) as n FROM test_run_items WHERE run_id = ? AND status != 'pending'`).get(runId);
    if (anyExecuted.n > 0) {
      await db.prepare(`UPDATE test_runs SET status='in_progress', started_at=COALESCE(started_at, ?) WHERE id=? AND status='pending'`)
        .run(nowISO(), runId);
    }
    const updatedItem = await db.prepare('SELECT * FROM test_run_items WHERE id = ?').get(req.params.itemId);
    res.json(updatedItem);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:id/add-cases', async (req, res) => {
  try {
    const { test_case_ids = [] } = req.body;
    const db = getDb();
    for (const tcId of test_case_ids) {
      await db.prepare('INSERT INTO test_run_items (id, run_id, test_case_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .run(uuidv4(), req.params.id, tcId);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:id/complete', async (req, res) => {
  try {
    if (req.user.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot complete runs' });
    const db = getDb();
    const run = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status === 'completed') return res.status(400).json({ error: 'Run is already completed' });
    if (run.status === 'pending') return res.status(400).json({ error: 'Run has not been started yet. Execute at least one test case first.' });
    const pending = await db.prepare(`SELECT COUNT(*) as n FROM test_run_items WHERE run_id = ? AND status = 'pending'`).get(req.params.id);
    if (pending.n > 0) {
      return res.status(400).json({ error: `${pending.n} test case(s) have not been executed yet. Execute or skip all cases before marking complete.`, pending_count: pending.n });
    }
    await db.prepare(`UPDATE test_runs SET status='completed', completed_at=? WHERE id=?`).run(nowISO(), req.params.id);
    res.json(await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:id/retest', async (req, res) => {
  try {
    if (req.user.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot create test runs' });
    const db = getDb();
    const sourceRun = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.id);
    if (!sourceRun) return res.status(404).json({ error: 'Run not found' });
    const failedItems = await db.prepare(`SELECT test_case_id FROM test_run_items WHERE run_id = ? AND status IN ('failed', 'blocked')`).all(req.params.id);
    if (failedItems.length === 0) return res.status(400).json({ error: 'No failed or blocked cases to retest' });
    const { name, build_version, environment } = req.body;
    const newRunName = name || `Retest — ${sourceRun.name}`;
    const newId = uuidv4();
    await db.prepare(`INSERT INTO test_runs (id, project_id, name, description, build_version, environment, parent_run_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(newId, sourceRun.project_id, newRunName, `Retest of failed/blocked cases from: ${sourceRun.name}`,
        build_version || sourceRun.build_version || null, environment || sourceRun.environment || null,
        req.params.id, req.user.id, nowISO());
    for (const item of failedItems) {
      await db.prepare('INSERT INTO test_run_items (id, run_id, test_case_id) VALUES (?, ?, ?)').run(uuidv4(), newId, item.test_case_id);
    }
    const newRun = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(newId);
    res.status(201).json({ ...newRun, retest_count: failedItems.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:id/import-results', async (req, res) => {
  try {
    if (req.user.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot import results' });
    const { xml } = req.body;
    if (!xml || typeof xml !== 'string') return res.status(400).json({ error: 'xml body field required' });
    const db = getDb();
    const run = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status === 'completed') return res.status(423).json({ error: 'Run is locked' });
    const items = await db.prepare(`
      SELECT tri.id, tri.test_case_id, tc.title
      FROM test_run_items tri
      JOIN test_cases tc ON tri.test_case_id = tc.id
      WHERE tri.run_id = ?
    `).all(req.params.id);
    const parsed = parseJUnitXml(xml);
    let matched = 0, skippedCount = 0;
    const importedAt = nowISO();
    for (const item of items) {
      const normalise = s => s.toLowerCase().replace(/[\s_\-\.]/g, '');
      const titleNorm = normalise(item.title);
      const result = parsed.find(p => {
        const nameNorm = normalise(p.name);
        const classNorm = normalise(p.classname);
        return nameNorm === titleNorm || classNorm.endsWith(titleNorm) || nameNorm.includes(titleNorm) || titleNorm.includes(nameNorm);
      });
      if (result) {
        await db.prepare(`UPDATE test_run_items SET status=?, notes=?, executed_by=?, executed_at=?, duration=? WHERE id=?`)
          .run(result.status, result.notes || null, req.user.id, importedAt, result.duration, item.id);
        matched++;
      } else {
        skippedCount++;
      }
    }
    if (matched > 0) {
      await db.prepare(`UPDATE test_runs SET status='in_progress', started_at=COALESCE(started_at, ?) WHERE id=? AND status='pending'`).run(nowISO(), req.params.id);
    }
    res.json({ matched, skipped: skippedCount, total: items.length, parsed: parsed.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;