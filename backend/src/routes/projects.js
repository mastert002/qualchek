const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, nowISO } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const audit = require('../lib/audit');

const router = express.Router();
router.use(authenticate);

async function projectRole(db, projectId, userId) {
  const m = await db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
  return m ? m.role : null;
}

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    let projects;
    console.log('[projects] GET / user:', req.user.id, 'role:', req.user.role);
    if (req.user.role === 'admin' || req.user.role === 'viewer') {
      projects = await db.prepare(`
        SELECT p.*, u.name as creator_name,
          (SELECT COUNT(*) FROM test_cases tc WHERE tc.project_id = p.id) as test_case_count,
          (SELECT COUNT(*) FROM test_runs tr WHERE tr.project_id = p.id) as test_run_count
        FROM projects p
        JOIN users u ON p.created_by = u.id
        ORDER BY p.created_at DESC
      `).all();
    } else {
      projects = await db.prepare(`
        SELECT p.*, u.name as creator_name,
          (SELECT COUNT(*) FROM test_cases tc WHERE tc.project_id = p.id) as test_case_count,
          (SELECT COUNT(*) FROM test_runs tr WHERE tr.project_id = p.id) as test_run_count
        FROM projects p
        JOIN users u ON p.created_by = u.id
        JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
        ORDER BY p.created_at DESC
      `).all(req.user.id);
    }
    res.json(projects);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can create projects' });
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const db = getDb();
    const id = uuidv4();
    await db.prepare('INSERT INTO projects (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, description || null, req.user.id, nowISO());
    await db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(id, req.user.id, 'admin');
    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    await audit.record(req, 'project.created', { type: 'project', id, label: name });
    res.status(201).json(project);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    if (req.user.role !== 'admin' && req.user.role !== 'viewer') {
      const member = await db.prepare('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!member) return res.status(404).json({ error: 'Project not found' });
    }
    const project = await db.prepare(`SELECT p.*, u.name as creator_name FROM projects p JOIN users u ON p.created_by = u.id WHERE p.id = ?`).get(req.params.id);
    const members = await db.prepare(`SELECT u.id, u.name, u.email, pm.role FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ?`).all(req.params.id);
    res.json({ ...project, members });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const role = await projectRole(db, req.params.id, req.user.id);
    if (req.user.role !== 'admin' && role !== 'admin') return res.status(403).json({ error: 'Only admins can edit this project' });
    const { name, description } = req.body;
    await db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?').run(name, description || null, req.params.id);
    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json(project);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete projects' });
    const db = getDb();
    const goneProject = await db.prepare('SELECT id, name FROM projects WHERE id = ?').get(req.params.id);
    await db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    await audit.record(req, 'project.deleted', { type: 'project', id: req.params.id, label: goneProject ? goneProject.name : null });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:id/members', async (req, res) => {
  try {
    const db = getDb();
    const role = await projectRole(db, req.params.id, req.user.id);
    if (req.user.role !== 'admin' && role !== 'admin') return res.status(403).json({ error: 'Only admins can manage team members' });
    const { user_id, role: memberRole = 'tester' } = req.body;
    await db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role').run(req.params.id, user_id, memberRole);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const db = getDb();
    const role = await projectRole(db, req.params.id, req.user.id);
    if (req.user.role !== 'admin' && role !== 'admin') return res.status(403).json({ error: 'Only admins can remove team members' });
    await db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;