const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, nowISO } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const audit = require('../lib/audit');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const suites = await db.prepare(`
      SELECT ts.*, (SELECT COUNT(*) FROM test_cases tc WHERE tc.suite_id = ts.id) as test_case_count
      FROM test_suites ts WHERE ts.project_id = ? ORDER BY ts.name
    `).all(req.params.projectId);
    res.json(suites);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const db = getDb();
    const id = uuidv4();
    await db.prepare('INSERT INTO test_suites (id, project_id, name, description, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.params.projectId, name, description || null, parent_id || null, nowISO());
    res.status(201).json(await db.prepare('SELECT * FROM test_suites WHERE id = ?').get(id));
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, parent_id } = req.body;
    const db = getDb();
    await db.prepare('UPDATE test_suites SET name = ?, description = ?, parent_id = ? WHERE id = ?').run(name, description || null, parent_id || null, req.params.id);
    res.json(await db.prepare('SELECT * FROM test_suites WHERE id = ?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const goneSuite = await db.prepare('SELECT id, name FROM test_suites WHERE id = ?').get(req.params.id);
    await db.prepare('DELETE FROM test_suites WHERE id = ?').run(req.params.id);
    await audit.record(req, 'suite.deleted', { type: 'suite', id: req.params.id, label: goneSuite ? goneSuite.name : null },
      { project_id: req.params.projectId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;