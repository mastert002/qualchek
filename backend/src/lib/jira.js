// Shared Jira client.
//
// Lives here rather than in routes/jira.js so that other routes - notably the
// test-case comment route - can post to Jira without a second HTTP round trip
// from the browser.

const https = require('https');
const http = require('http');

function jiraRequest(config, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.base_url);
    const auth = Buffer.from(`${config.email}:${config.api_token}`).toString('base64');
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : {}; } catch { json = null; }

        // The status code decides success, never whether the body parses: Jira
        // serves an HTML login or error page in some failure modes, and
        // treating that as data made a broken connection look healthy.
        if (res.statusCode >= 400) {
          // Jira reports problems in two places: errorMessages for general
          // failures, and a separate errors object keyed by field for rejected
          // create/update payloads. Only reading the first left field errors
          // invisible behind a bare "Jira returned 400".
          const fieldErrors = json && json.errors && typeof json.errors === 'object'
            ? Object.entries(json.errors).map(([f, m]) => `${f}: ${m}`)
            : [];
          const msg =
            [...(json?.errorMessages || []), ...fieldErrors].join('; ') ||
            json?.message ||
            `Jira returned ${res.statusCode}`;
          return reject({ status: res.statusCode, message: msg });
        }
        if (json === null) {
          return reject({ status: res.statusCode, message: 'Jira returned an unexpected (non-JSON) response' });
        }
        resolve(json);
      });
    });
    req.on('error', err => reject({ status: 500, message: err.message }));
    if (data) req.write(data);
    req.end();
  });
}

// Jira Cloud v3 accepts Atlassian Document Format, not plain text: one
// paragraph per line, with blank lines preserved as empty paragraphs.
function textToADF(text) {
  return {
    version: 1,
    type: 'doc',
    content: String(text).split('\n').map(line =>
      line.trim() === ''
        ? { type: 'paragraph', content: [] }
        : { type: 'paragraph', content: [{ type: 'text', text: line }] }),
  };
}

// What a project will actually accept when creating an issue. Issue types are
// per-project - a team-managed project often has no "Bug" at all - and Epics and
// subtasks typically reject priority, so both have to be read rather than assumed.
async function projectIssueTypes(config, projectKey) {
  const meta = await jiraRequest(
    config, 'GET',
    `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes.fields`);
  const project = (meta.projects || [])[0];
  return (project?.issuetypes || []).map(it => ({
    name: it.name,
    subtask: !!it.subtask,
    allowsPriority: !!(it.fields && it.fields.priority),
  }));
}

// Prefer a bug-shaped type when the project has one, else an ordinary work item.
function preferredIssueType(types) {
  const byName = n => types.find(t => t.name.toLowerCase() === n);
  return byName('bug') || byName('task') || byName('story') || types.find(t => !t.subtask) || types[0];
}

async function getConfig(db) {
  // No tenant filter needed: RLS scopes this table to the current tenant,
  // so there is at most one row visible here.
  return await db.prepare('SELECT * FROM jira_config').get();
}

// Mirror a comment onto the Jira issue linked to a test case.
// Returns {key, url} on success, or {error} describing why not - it never
// throws, because the caller has already saved the in-app comment and must not
// fail that on account of Jira.
async function commentOnLinkedIssue(db, testCaseId, text, authorName) {
  try {
    const config = await getConfig(db);
    if (!config) return { error: 'Jira is not configured' };

    const link = await db.prepare('SELECT issue_key FROM jira_links WHERE test_case_id = ?').get(testCaseId);
    if (!link || !link.issue_key) return { error: 'This test case is not linked to a Jira issue' };

    // Jira attributes every comment to the token owner, so name the real author.
    const attributed = authorName ? `${text}\n\n- ${authorName} via QualChek` : text;
    await jiraRequest(config, 'POST', `/rest/api/3/issue/${link.issue_key}/comment`, { body: textToADF(attributed) });

    return { key: link.issue_key, url: `${config.base_url}/browse/${link.issue_key}` };
  } catch (err) {
    return { error: (err && err.message) || 'Could not post to Jira' };
  }
}

module.exports = { jiraRequest, textToADF, getConfig, commentOnLinkedIssue, projectIssueTypes, preferredIssueType };
