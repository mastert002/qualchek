const express = require('express');
const { jiraRequest, textToADF, getConfig, projectIssueTypes, preferredIssueType } = require('../lib/jira');
const { getDb } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const audit = require('../lib/audit');

const router = express.Router();
router.use(authenticate);

router.get('/config', async (req, res) => {
  try {
    const db = getDb();
    const config = await getConfig(db);
    if (!config) return res.json({ configured: false });
    res.json({ configured: true, base_url: config.base_url, email: config.email, api_token: '••••••••', default_project: config.default_project });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/config', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can configure Jira' });
    const { base_url, email, api_token, default_project } = req.body;
    if (!base_url || !email) return res.status(400).json({ error: 'base_url and email are required' });
    // This value is interpolated into link hrefs across the app, so a
    // javascript: or data: URL saved here would run as stored XSS in every
    // viewer's session. Only ordinary web URLs are a valid Jira site.
    let parsed;
    try { parsed = new URL(String(base_url)); }
    catch { return res.status(400).json({ error: 'base_url must be a valid URL, e.g. https://your-site.atlassian.net' }); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return res.status(400).json({ error: 'base_url must start with http:// or https://' });
    }
    const db = getDb();
    const existing = await db.prepare('SELECT api_token FROM jira_config').get();
    if (!api_token && !existing) return res.status(400).json({ error: 'api_token is required for initial setup' });
    const tokenToSave = api_token || existing.api_token;
    await db.prepare(`
      INSERT INTO jira_config (tenant_id, base_url, email, api_token, default_project)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET base_url=EXCLUDED.base_url, email=EXCLUDED.email,
        api_token=EXCLUDED.api_token, default_project=EXCLUDED.default_project
    `).run(req.user.tenant_id, base_url.replace(/\/$/, ''), email, tokenToSave, default_project || null);
    // The token itself is never recorded, only that it changed.
    await audit.record(req, 'jira.config_updated', { type: 'jira', label: base_url },
      { email, default_project: default_project || null, token_changed: !!api_token });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/config/test', async (req, res) => {
  let { base_url, email, api_token } = req.body;
  try {
    if (api_token === '__use_saved__') {
      const db = getDb();
      const saved = await db.prepare('SELECT api_token, base_url, email FROM jira_config').get();
      if (!saved) return res.status(400).json({ error: 'No saved config found' });
      api_token = saved.api_token;
      base_url = base_url || saved.base_url;
      email = email || saved.email;
    }
    const result = await jiraRequest({ base_url, email, api_token }, 'GET', '/rest/api/3/myself');
    // Only a genuine, authenticated response carries an accountId. Without it
    // we are anonymous, whatever the status code said.
    if (!result || !result.accountId) {
      return res.status(400).json({
        error: 'Connected to the site, but Jira did not recognise the credentials. Check the email address and paste a fresh API token.',
      });
    }
    res.json({ success: true, user: result.displayName || result.emailAddress || email, accountId: result.accountId });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Connection failed' });
  }
});

router.get('/issue/:key', async (req, res) => {
  try {
    const db = getDb();
    const config = await getConfig(db);
    if (!config) return res.status(400).json({ error: 'Jira not configured' });
    const issue = await jiraRequest(config, 'GET', `/rest/api/3/issue/${req.params.key}?fields=summary,status,priority,assignee,issuetype,description`);
    res.json({
      key: issue.key, summary: issue.fields.summary, status: issue.fields.status?.name,
      statusCategory: issue.fields.status?.statusCategory?.colorName, priority: issue.fields.priority?.name,
      assignee: issue.fields.assignee?.displayName, issueType: issue.fields.issuetype?.name,
      url: `${config.base_url}/browse/${issue.key}`,
    });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/issue', async (req, res) => {
  try {
    const db = getDb();
    const config = await getConfig(db);
    if (!config) return res.status(400).json({ error: 'Jira not configured' });
    const { summary, description, project_key, issue_type, priority = 'Medium', test_case_id, test_run_item_id, user_notes } = req.body;
    if (!summary) return res.status(400).json({ error: 'summary is required' });
    let existingKey = null;
    if (test_run_item_id) {
      const existing = await db.prepare('SELECT issue_key FROM jira_run_links WHERE run_item_id = ?').get(test_run_item_id);
      if (existing?.issue_key) existingKey = existing.issue_key;
    }
    if (!existingKey && test_case_id) {
      const existing = await db.prepare('SELECT issue_key FROM jira_links WHERE test_case_id = ?').get(test_case_id);
      if (existing?.issue_key) existingKey = existing.issue_key;
    }
    if (existingKey) {
      const commentBody = (user_notes && user_notes.trim()) || '';
      if (!commentBody) return res.json({ key: existingKey, url: `${config.base_url}/browse/${existingKey}`, updated: false, skipped: true });
      await jiraRequest(config, 'POST', `/rest/api/3/issue/${existingKey}/comment`, { body: textToADF(commentBody) });
      return res.json({ key: existingKey, url: `${config.base_url}/browse/${existingKey}`, updated: true });
    }
    const projectKey = project_key || config.default_project;
    if (!projectKey) return res.status(400).json({ error: 'No Jira project key specified' });
    const descBody = (user_notes && user_notes.trim()) ? user_notes.trim() : (description && description.trim()) || summary;
    const descADF = textToADF(descBody);

    // Ask the project what it accepts instead of assuming a "Bug" type and a
    // priority field exist. Sending either when the project has neither is a
    // 400 from Jira, and the reason used to be swallowed.
    const types = await projectIssueTypes(config, projectKey);
    let chosen = issue_type
      ? types.find(t => t.name.toLowerCase() === String(issue_type).toLowerCase())
      : preferredIssueType(types);

    if (!chosen) {
      const available = types.map(t => t.name).join(', ') || 'none visible to this account';
      return res.status(400).json({
        error: issue_type
          ? `Jira project ${projectKey} has no "${issue_type}" issue type. Available types: ${available}.`
          : `No usable issue type in Jira project ${projectKey}. Available types: ${available}.`,
      });
    }

    const fields = { project: { key: projectKey }, summary, description: descADF, issuetype: { name: chosen.name } };
    if (priority && chosen.allowsPriority) fields.priority = { name: priority };

    const result = await jiraRequest(config, 'POST', '/rest/api/3/issue', { fields });
    const issueKey = result.key;
    if (test_case_id) {
      await db.prepare('INSERT INTO jira_links (test_case_id, issue_key) VALUES (?, ?) ON CONFLICT (test_case_id) DO UPDATE SET issue_key = EXCLUDED.issue_key').run(test_case_id, issueKey);
    }
    if (test_run_item_id) {
      await db.prepare('INSERT INTO jira_run_links (run_item_id, issue_key) VALUES (?, ?) ON CONFLICT (run_item_id) DO UPDATE SET issue_key = EXCLUDED.issue_key').run(test_run_item_id, issueKey);
    }
    res.json({ key: issueKey, url: `${config.base_url}/browse/${issueKey}`, updated: false });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/link/test-case', async (req, res) => {
  try {
    const { test_case_id, issue_key } = req.body;
    if (!test_case_id || !issue_key) return res.status(400).json({ error: 'test_case_id and issue_key required' });
    const db = getDb();
    await db.prepare(`INSERT INTO jira_links (test_case_id, issue_key) VALUES (?, ?) ON CONFLICT (test_case_id) DO UPDATE SET issue_key = EXCLUDED.issue_key`).run(test_case_id, issue_key.toUpperCase());
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/link/test-case/:testCaseId', async (req, res) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM jira_links WHERE test_case_id = ?').run(req.params.testCaseId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/link/test-case/:testCaseId', async (req, res) => {
  try {
    const db = getDb();
    const link = await db.prepare('SELECT issue_key FROM jira_links WHERE test_case_id = ?').get(req.params.testCaseId);
    res.json(link || { issue_key: null });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/comment/:issueKey', async (req, res) => {
  try {
    const db = getDb();
    const config = await getConfig(db);
    if (!config) return res.status(400).json({ error: 'Jira not configured' });
    const { run_id } = req.body;
    if (!run_id) return res.status(400).json({ error: 'run_id required' });
    const run = await db.prepare('SELECT * FROM test_runs WHERE id = ?').get(run_id);
    const stats = await db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status='passed' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) as blocked
      FROM test_run_items WHERE run_id = ?
    `).get(run_id);
    const pr = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
    const commentText = `*Test Run Report: ${run.name}*\n\n| Metric | Value |\n|---|---|\n| Total Cases | ${stats.total} |\n| Passed | ${stats.passed} |\n| Failed | ${stats.failed} |\n| Blocked | ${stats.blocked} |\n| Pass Rate | ${pr}% |\n\n_Reported by QualChek_`;
    await jiraRequest(config, 'POST', `/rest/api/3/issue/${req.params.issueKey}/comment`, {
      body: textToADF(commentText),
    });
    res.json({ success: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Mirror an in-app test-case comment onto the linked Jira issue.
// The app's comment thread is deliberately separate from Jira's, so this is an
// explicit opt-in per comment rather than an automatic sync.
router.post('/test-case/:testCaseId/comment', async (req, res) => {
  try {
    const db = getDb();
    const config = await getConfig(db);
    if (!config) return res.status(400).json({ error: 'Jira not configured' });

    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'content is required' });

    const link = await db.prepare('SELECT issue_key FROM jira_links WHERE test_case_id = ?').get(req.params.testCaseId);
    if (!link || !link.issue_key) return res.status(400).json({ error: 'This test case is not linked to a Jira issue' });

    // Jira attributes every comment to the token owner, so name the real author.
    const attributed = `${content}\n\n- ${req.user.name} via QualChek`;
    await jiraRequest(config, 'POST', `/rest/api/3/issue/${link.issue_key}/comment`, { body: textToADF(attributed) });

    res.json({ success: true, key: link.issue_key, url: `${config.base_url}/browse/${link.issue_key}` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// The issue types a project really offers, so the UI can offer those rather
// than a hardcoded list that may not exist in Jira.
router.get('/issue-types', async (req, res) => {
  try {
    const db = getDb();
    const config = await getConfig(db);
    if (!config) return res.status(400).json({ error: 'Jira not configured' });

    const projectKey = req.query.project_key || config.default_project;
    if (!projectKey) return res.status(400).json({ error: 'No Jira project key specified' });

    const types = await projectIssueTypes(config, projectKey);
    res.json(types.filter(t => !t.subtask));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/projects', async (req, res) => {
  try {
    const db = getDb();
    const config = await getConfig(db);
    if (!config) return res.status(400).json({ error: 'Jira not configured' });
    const result = await jiraRequest(config, 'GET', '/rest/api/3/project/search?maxResults=50');
    res.json((result.values || []).map(p => ({ key: p.key, name: p.name })));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;