const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, nowISO } = require('../db/database');
const { normaliseRows } = require('../lib/importCases');
const { authenticate } = require('../middleware/auth');
const { requireProject } = require('../middleware/project');
const audit = require('../lib/audit');
const { commentOnLinkedIssue } = require('../lib/jira');

const router = express.Router({ mergeParams: true });
router.use(authenticate);
// The project in the URL must belong to this workspace. Reads are already
// scoped by the policies; this closes writes naming a foreign project id.
router.use(requireProject);

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { suite_id, priority, status, search, automation_status } = req.query;
    let query = `
      SELECT tc.*, u.name as creator_name, ts.name as suite_name, jl.issue_key as jira_issue_key
      FROM test_cases tc
      LEFT JOIN users u ON tc.created_by = u.id
      LEFT JOIN test_suites ts ON tc.suite_id = ts.id
      LEFT JOIN jira_links jl ON jl.test_case_id = tc.id
      WHERE tc.project_id = ?
    `;
    const params = [req.params.projectId];
    if (suite_id) { query += ' AND tc.suite_id = ?'; params.push(suite_id); }
    if (priority) { query += ' AND tc.priority = ?'; params.push(priority); }
    if (status) { query += ' AND tc.status = ?'; params.push(status); }
    if (search) { query += ' AND tc.title ILIKE ?'; params.push(`%${search}%`); }
    if (automation_status) { query += ' AND tc.automation_status = ?'; params.push(automation_status); }
    query += ' ORDER BY tc.created_at DESC';
    const cases = await db.prepare(query).all(...params);
    res.json(cases.map(c => ({ ...c, steps: JSON.parse(c.steps || '[]'), tags: JSON.parse(c.tags || '[]') })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/projects/:projectId/test-cases/import
//
// Bulk create from a spreadsheet. The file was parsed in the browser, so this
// receives rows as JSON - see lib/importCases.js for why.
router.post('/import', async (req, res) => {
  try {
    if (req.user.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot import test cases' });

    const rows = Array.isArray(req.body.cases) ? req.body.cases : null;
    if (!rows) return res.status(400).json({ error: 'cases must be an array of rows' });
    if (rows.length === 0) return res.status(400).json({ error: 'The file had no rows to import' });

    const { accepted, rejected, truncated } = normaliseRows(rows);

    const db = getDb();
    const projectId = req.params.projectId;
    const suiteId = req.body.suite_id || null;

    if (suiteId) {
      const suite = await db.prepare('SELECT id FROM test_suites WHERE id = ? AND project_id = ?')
        .get(suiteId, projectId);
      if (!suite) return res.status(400).json({ error: 'That suite does not belong to this project' });
    }

    // Title-based duplicate detection, matching how the crawler decides what it
    // has already generated. Someone re-importing a corrected spreadsheet
    // expects the unchanged rows to be left alone, not duplicated.
    const skipDuplicates = req.body.skip_duplicates !== false;
    const existing = new Set(
      skipDuplicates
        ? (await db.prepare('SELECT title FROM test_cases WHERE project_id = ?').all(projectId))
            .map(r => String(r.title).trim().toLowerCase())
        : []
    );

    const now = nowISO();
    let created = 0, skipped = 0;
    const failed = [...rejected];

    for (const c of accepted) {
      const key = c.title.toLowerCase();
      if (skipDuplicates && existing.has(key)) { skipped++; continue; }
      try {
        await db.prepare(`
          INSERT INTO test_cases (id, suite_id, project_id, title, description, preconditions, steps,
                                  expected_result, priority, status, tags, created_by,
                                  automation_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), suiteId, projectId, c.title, c.description, c.preconditions,
          JSON.stringify(c.steps), c.expected_result, c.priority, c.status,
          JSON.stringify(c.tags), req.user.id, c.automation_status, now, now);
        created++;
        // Guards against the same title appearing twice within one file.
        existing.add(key);
      } catch (err) {
        failed.push({ title: c.title.slice(0, 60), reason: err.message });
      }
    }

    await audit.record(req, 'testcases.imported',
      { type: 'project', id: projectId },
      { created, skipped, failed: failed.length, suite_id: suiteId });

    res.json({
      created, skipped,
      failed: failed.length,
      // Capped: a file where everything failed should not return a response
      // larger than the file.
      errors: failed.slice(0, 50),
      truncated,
    });
  } catch (err) {
    console.error('import:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    if (req.user.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot create test cases' });
    const { suite_id, title, description, preconditions, steps = [], expected_result, priority = 'medium', tags = [],
      automation_status = 'manual', automation_framework, script_path } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const db = getDb();
    const id = uuidv4();
    const now = nowISO();
    await db.prepare(`
      INSERT INTO test_cases (id, suite_id, project_id, title, description, preconditions, steps, expected_result, priority, tags, created_by, automation_status, automation_framework, script_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, suite_id || null, req.params.projectId, title, description || null, preconditions || null,
      JSON.stringify(steps), expected_result || null, priority, JSON.stringify(tags), req.user.id,
      automation_status, automation_framework || null, script_path || null, now, now);
    const tc = await db.prepare('SELECT * FROM test_cases WHERE id = ?').get(id);
    res.status(201).json({ ...tc, steps: JSON.parse(tc.steps), tags: JSON.parse(tc.tags) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const tc = await db.prepare(`
      SELECT tc.*, u.name as creator_name, ts.name as suite_name
      FROM test_cases tc
      LEFT JOIN users u ON tc.created_by = u.id
      LEFT JOIN test_suites ts ON tc.suite_id = ts.id
      WHERE tc.id = ?
    `).get(req.params.id);
    if (!tc) return res.status(404).json({ error: 'Test case not found' });
    const comments = await db.prepare(`
      SELECT c.*, u.name as user_name FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.entity_type = 'test_case' AND c.entity_id = ?
      ORDER BY c.created_at
    `).all(req.params.id);
    res.json({ ...tc, steps: JSON.parse(tc.steps), tags: JSON.parse(tc.tags), comments });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/:id', async (req, res) => {
  try {
    if (req.user.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot edit test cases' });
    const { suite_id, title, description, preconditions, steps, expected_result, priority, status, tags,
      automation_status, automation_framework, script_path } = req.body;
    const db = getDb();
    const existing = await db.prepare('SELECT * FROM test_cases WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await db.prepare(`
      UPDATE test_cases SET suite_id=?, title=?, description=?, preconditions=?, steps=?,
      expected_result=?, priority=?, status=?, tags=?, automation_status=?, automation_framework=?,
      script_path=?, updated_at=? WHERE id=?
    `).run(
      suite_id ?? existing.suite_id, title ?? existing.title, description ?? existing.description,
      preconditions ?? existing.preconditions, JSON.stringify(steps ?? JSON.parse(existing.steps)),
      expected_result ?? existing.expected_result, priority ?? existing.priority,
      status ?? existing.status, JSON.stringify(tags ?? JSON.parse(existing.tags)),
      automation_status ?? existing.automation_status ?? 'manual',
      automation_framework !== undefined ? (automation_framework || null) : existing.automation_framework,
      script_path !== undefined ? (script_path || null) : existing.script_path,
      nowISO(), req.params.id
    );
    const tc = await db.prepare('SELECT * FROM test_cases WHERE id = ?').get(req.params.id);
    res.json({ ...tc, steps: JSON.parse(tc.steps), tags: JSON.parse(tc.tags) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete test cases' });
    const db = getDb();
    const goneCase = await db.prepare('SELECT id, title FROM test_cases WHERE id = ?').get(req.params.id);
    await db.prepare('DELETE FROM test_cases WHERE id = ?').run(req.params.id);
    await audit.record(req, 'test_case.deleted', { type: 'test_case', id: req.params.id, label: goneCase ? goneCase.title : null },
      { project_id: req.params.projectId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete test cases' });
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array is required' });
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    // Capture the titles before they are gone, so the entry names what was lost.
    const goneCases = await db.prepare(`SELECT title FROM test_cases WHERE id IN (${placeholders}) AND project_id = ?`).all(...ids, req.params.projectId);
    await db.prepare(`DELETE FROM test_cases WHERE id IN (${placeholders}) AND project_id = ?`).run(...ids, req.params.projectId);
    await audit.record(req, 'test_case.bulk_deleted', { type: 'test_case', label: `${ids.length} test case(s)` },
      { project_id: req.params.projectId, count: ids.length, titles: goneCases.map(c => c.title).slice(0, 25) });
    res.json({ deleted: ids.length });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:id/comments', async (req, res) => {
  try {
    const { content, send_to_jira } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const db = getDb();
    const id = uuidv4();
    await db.prepare('INSERT INTO comments (id, entity_type, entity_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'test_case', req.params.id, req.user.id, content, nowISO());
    const comment = await db.prepare(`SELECT c.*, u.name as user_name FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`).get(id);

    // Mirroring to Jira happens here rather than in a second request from the
    // browser, so the comment and its Jira copy succeed or fail together and
    // nothing depends on a second round trip surviving the network.
    let jira = null;
    if (send_to_jira) {
      jira = await commentOnLinkedIssue(db, req.params.id, content, req.user.name);
    }
    res.status(201).json({ ...comment, jira });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;