// Does the project in the URL belong to the caller's workspace?
//
// Row-level security already makes READS safe: a query scoped to another
// tenant's project returns nothing, because the rows it would match carry that
// tenant's id. Writes are the gap. tenant_id defaults to the session's tenant,
// so an INSERT naming a project id from another workspace succeeds - it lands
// in your own tenant, carrying a project_id you do not own.
//
// Nothing leaks: the other workspace still cannot see it. But it creates rows
// that belong to a project their owner cannot list, invisible to the UI and
// impossible to clean up from inside the app. That is corruption rather than a
// breach, and it is the sort that accumulates quietly.
//
// One middleware on each project-scoped router rather than a check in each
// handler, because the handler somebody adds next year is the one that will
// forget.

const { getDb } = require('../db/database');

async function requireProject(req, res, next) {
  const projectId = req.params.projectId;
  if (!projectId) return next();
  try {
    // No tenant clause needed: the policies already scope this table, so a
    // project from another workspace simply is not here.
    const project = await getDb()
      .prepare('SELECT id FROM projects WHERE id = ?')
      .get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    next();
  } catch (err) {
    console.error('requireProject:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { requireProject };
