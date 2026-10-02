const express = require('express');
const { getDb } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { requireProject } = require('../middleware/project');

const router = express.Router({ mergeParams: true });
router.use(authenticate);
// The project in the URL must belong to this workspace. Reads are already
// scoped by the policies; this closes writes naming a foreign project id.
router.use(requireProject);

router.get('/summary', async (req, res) => {
  try {
    const db = getDb();
    const { projectId } = req.params;
    const testCaseStats = await db.prepare(`
      SELECT COUNT(*)::int as total,
        SUM(CASE WHEN priority='critical' THEN 1 ELSE 0 END)::int as critical,
        SUM(CASE WHEN priority='high' THEN 1 ELSE 0 END)::int as high,
        SUM(CASE WHEN priority='medium' THEN 1 ELSE 0 END)::int as medium,
        SUM(CASE WHEN priority='low' THEN 1 ELSE 0 END)::int as low,
        SUM(CASE WHEN status='active' THEN 1 ELSE 0 END)::int as active,
        SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END)::int as draft,
        SUM(CASE WHEN status='deprecated' THEN 1 ELSE 0 END)::int as deprecated
      FROM test_cases WHERE project_id = ?
    `).get(projectId);
    const runStats = await db.prepare(`
      SELECT COUNT(*)::int as total_runs,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int as completed,
        SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END)::int as in_progress,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)::int as pending
      FROM test_runs WHERE project_id = ?
    `).get(projectId);
    const executionStats = await db.prepare(`
      SELECT COUNT(tri.id)::int as total_executions,
        SUM(CASE WHEN tri.status='passed' THEN 1 ELSE 0 END)::int as passed,
        SUM(CASE WHEN tri.status='failed' THEN 1 ELSE 0 END)::int as failed,
        SUM(CASE WHEN tri.status='blocked' THEN 1 ELSE 0 END)::int as blocked,
        SUM(CASE WHEN tri.status='skipped' THEN 1 ELSE 0 END)::int as skipped
      FROM test_run_items tri
      JOIN test_runs tr ON tri.run_id = tr.id
      WHERE tr.project_id = ? AND tri.status != 'pending'
    `).get(projectId);
    const recentRuns = await db.prepare(`
      SELECT tr.id, tr.name, tr.status, tr.created_at,
        COUNT(tri.id)::int as total,
        SUM(CASE WHEN tri.status='passed' THEN 1 ELSE 0 END)::int as passed,
        SUM(CASE WHEN tri.status='failed' THEN 1 ELSE 0 END)::int as failed
      FROM test_runs tr
      LEFT JOIN test_run_items tri ON tri.run_id = tr.id
      WHERE tr.project_id = ?
      GROUP BY tr.id, tr.name, tr.status, tr.created_at
      ORDER BY tr.created_at DESC
      LIMIT 10
    `).all(projectId);
    const passRateTrend = await db.prepare(`
      SELECT tr.name, tr.created_at,
        ROUND(100.0 * SUM(CASE WHEN tri.status='passed' THEN 1 ELSE 0 END) / NULLIF(COUNT(tri.id),0), 1) as pass_rate
      FROM test_runs tr
      JOIN test_run_items tri ON tri.run_id = tr.id
      WHERE tr.project_id = ? AND tr.status = 'completed'
      GROUP BY tr.id, tr.name, tr.created_at
      ORDER BY tr.created_at
      LIMIT 20
    `).all(projectId);
    const suiteBreakdown = await db.prepare(`
      SELECT ts.name as suite_name, COUNT(tc.id) as total,
        SUM(CASE WHEN tc.status='active' THEN 1 ELSE 0 END) as active
      FROM test_suites ts
      LEFT JOIN test_cases tc ON tc.suite_id = ts.id
      WHERE ts.project_id = ?
      GROUP BY ts.id, ts.name
      ORDER BY total DESC
      LIMIT 10
    `).all(projectId);
    res.json({ test_cases: testCaseStats, runs: runStats, executions: executionStats, recent_runs: recentRuns, pass_rate_trend: passRateTrend, suite_breakdown: suiteBreakdown });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/run/:runId', async (req, res) => {
  try {
    const db = getDb();
    const run = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const items = await db.prepare(`
      SELECT tri.status, tri.notes, tri.executed_at, tri.duration,
        tc.title, tc.priority, u.name as executor_name
      FROM test_run_items tri
      JOIN test_cases tc ON tri.test_case_id = tc.id
      LEFT JOIN users u ON tri.executed_by = u.id
      WHERE tri.run_id = ?
      ORDER BY tri.status, tc.title
    `).all(req.params.runId);
    const summary = await db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status='passed' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) as skipped,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
        AVG(duration) as avg_duration
      FROM test_run_items WHERE run_id = ?
    `).get(req.params.runId);
    const byPriority = await db.prepare(`
      SELECT tc.priority,
        SUM(CASE WHEN tri.status='passed' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN tri.status='failed' THEN 1 ELSE 0 END) as failed,
        COUNT(*) as total
      FROM test_run_items tri
      JOIN test_cases tc ON tri.test_case_id = tc.id
      WHERE tri.run_id = ?
      GROUP BY tc.priority
    `).all(req.params.runId);
    res.json({ run, items, summary, by_priority: byPriority });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;