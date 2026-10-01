import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, RefreshCw, Trash2, Key, Terminal, CheckCircle, Zap } from 'lucide-react';
import api from '../utils/api';
import { useToast } from '../context/ToastContext';

// Use the origin the app is actually served from. Hardcoding :3001 generated
// snippets pointing at https://<host>:3001/api — a port Vercel does not serve.
// Those requests hang rather than being refused, so CI jobs sat there until
// they timed out (curl exit 28) with nothing reaching the server logs.
// In local dev the Vite dev server proxies /api to 3001, so origin works there too.
const BASE_URL = typeof window !== 'undefined'
  ? `${window.location.origin}/api`
  : 'http://localhost:3001/api';

function CodeBlock({ code, language = 'bash' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function Tab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
        active
          ? 'border-brand-600 text-brand-600 bg-brand-50'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  );
}

function snippets(apiKey, projectId, baseUrl) {
  const runName = '${RUN_NAME}';
  const buildVer = '${BUILD_VERSION}';
  const env = '${ENVIRONMENT}';

  return {
    'GitHub Actions': `name: Run Tests & Report to QualChek

on: [push, pull_request]

env:
  TM_API_KEY: \${{ secrets.TM_API_KEY }}
  TM_PROJECT_ID: ${projectId}
  TM_BASE_URL: ${baseUrl}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: npm ci

      - name: Create test run
        id: create_run
        run: |
          RUN_ID=$(curl -s -X POST "$TM_BASE_URL/ci/projects/$TM_PROJECT_ID/runs" \\
            -H "X-API-Key: $TM_API_KEY" \\
            -H "Content-Type: application/json" \\
            -d '{"name":"CI Run #\${{ github.run_number }}","build_version":"\${{ github.sha }}","environment":"CI"}' \\
            | jq -r '.id')
          echo "run_id=$RUN_ID" >> $GITHUB_OUTPUT

      - name: Run Playwright tests
        run: npx playwright test --reporter=json > results.json
        continue-on-error: true

      - name: Push results
        run: |
          node -e "
            const fs = require('fs');
            const data = JSON.parse(fs.readFileSync('results.json'));
            const results = data.suites.flatMap(s => s.specs).map(spec => ({
              title: spec.title,
              status: spec.ok ? 'passed' : 'failed',
              duration_ms: spec.duration,
              notes: spec.tests?.[0]?.results?.[0]?.error?.message || ''
            }));
            fetch('$TM_BASE_URL/ci/runs/\${{ steps.create_run.outputs.run_id }}/results', {
              method: 'POST',
              headers: { 'X-API-Key': '$TM_API_KEY', 'Content-Type': 'application/json' },
              body: JSON.stringify({ results })
            }).then(r => r.json()).then(console.log);
          "

      - name: Complete run
        run: |
          curl -s -X POST "$TM_BASE_URL/ci/runs/\${{ steps.create_run.outputs.run_id }}/complete" \\
            -H "X-API-Key: $TM_API_KEY"`,

    Cypress: `// cypress.config.js — push results after each spec
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  reporter: 'junit',
  reporterOptions: { mochaFile: 'results/[hash].xml' },
  e2e: {
    setupNodeEvents(on, config) {
      // After all specs finish, push results to QualChek
      on('after:run', async (results) => {
        const TM_API_KEY = process.env.TM_API_KEY || '${apiKey || '<your-api-key>'}';
        const TM_BASE_URL = '${baseUrl}';
        const PROJECT_ID = '${projectId}';

        // 1. Create a run
        const runRes = await fetch(\`\${TM_BASE_URL}/ci/projects/\${PROJECT_ID}/runs\`, {
          method: 'POST',
          headers: { 'X-API-Key': TM_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: \`Cypress — \${new Date().toISOString().slice(0,10)}\`,
            environment: process.env.ENV || 'CI',
          }),
        }).then(r => r.json());

        // 2. Map Cypress results
        const mapped = results.runs.flatMap(r =>
          r.tests.map(t => ({
            title: t.title.join(' '),
            status: t.state === 'passed' ? 'passed' : t.state === 'pending' ? 'skipped' : 'failed',
            duration_ms: t.duration,
            notes: t.displayError || '',
          }))
        );

        // 3. Push results
        await fetch(\`\${TM_BASE_URL}/ci/runs/\${runRes.id}/results\`, {
          method: 'POST',
          headers: { 'X-API-Key': TM_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ results: mapped }),
        });

        // 4. Complete the run
        await fetch(\`\${TM_BASE_URL}/ci/runs/\${runRes.id}/complete\`, {
          method: 'POST',
          headers: { 'X-API-Key': TM_API_KEY },
        });
      });
    },
  },
});`,

    Playwright: `// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['json', { outputFile: 'results.json' }]],
  // ... your other config
});

// push-results.js — run this after playwright test
import fs from 'fs';

const TM_API_KEY = process.env.TM_API_KEY || '${apiKey || '<your-api-key>'}';
const TM_BASE_URL = '${baseUrl}';
const PROJECT_ID = '${projectId}';

const data = JSON.parse(fs.readFileSync('results.json', 'utf-8'));

const mapped = data.suites.flatMap(suite =>
  suite.specs.map(spec => ({
    title: spec.title,
    status: spec.ok ? 'passed' : 'failed',
    duration_ms: spec.duration,
    notes: spec.tests?.[0]?.results?.[0]?.error?.message || '',
  }))
);

async function run() {
  const { id: runId } = await fetch(\`\${TM_BASE_URL}/ci/projects/\${PROJECT_ID}/runs\`, {
    method: 'POST',
    headers: { 'X-API-Key': TM_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: \`Playwright — \${new Date().toISOString().slice(0,10)}\` }),
  }).then(r => r.json());

  await fetch(\`\${TM_BASE_URL}/ci/runs/\${runId}/results\`, {
    method: 'POST',
    headers: { 'X-API-Key': TM_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ results: mapped }),
  });

  await fetch(\`\${TM_BASE_URL}/ci/runs/\${runId}/complete\`, {
    method: 'POST', headers: { 'X-API-Key': TM_API_KEY },
  });

  console.log('Results pushed. Run ID:', runId);
}
run();`,

    Pytest: `# conftest.py — push results to QualChek after pytest run
import pytest, requests, os, json
from datetime import date

TM_API_KEY = os.environ.get("TM_API_KEY", "${apiKey || '<your-api-key>'}")
TM_BASE_URL = "${baseUrl}"
PROJECT_ID = "${projectId}"

_run_id = None
_results = []

def pytest_sessionstart(session):
    global _run_id
    resp = requests.post(
        f"{TM_BASE_URL}/ci/projects/{PROJECT_ID}/runs",
        headers={"X-API-Key": TM_API_KEY},
        json={"name": f"Pytest — {date.today()}", "environment": os.environ.get("ENV", "CI")},
    )
    _run_id = resp.json()["id"]

@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if rep.when == "call":
        _results.append({
            "title": item.name,
            "status": "passed" if rep.passed else "skipped" if rep.skipped else "failed",
            "duration_ms": int(rep.duration * 1000),
            "notes": str(rep.longrepr) if rep.failed else "",
        })

def pytest_sessionfinish(session, exitstatus):
    if not _run_id:
        return
    requests.post(
        f"{TM_BASE_URL}/ci/runs/{_run_id}/results",
        headers={"X-API-Key": TM_API_KEY},
        json={"results": _results},
    )
    requests.post(
        f"{TM_BASE_URL}/ci/runs/{_run_id}/complete",
        headers={"X-API-Key": TM_API_KEY},
    )
    print(f"\\n✅ Results pushed to QualChek. Run ID: {_run_id}")`,

    'cURL / Shell': `#!/bin/bash
# Generic shell script — works in any CI (Jenkins, GitLab CI, Bitbucket, etc.)
TM_API_KEY="${apiKey || '<your-api-key>'}"
TM_BASE_URL="${baseUrl}"
PROJECT_ID="${projectId}"

# 1. Create a test run
RUN_ID=$(curl -s -X POST "$TM_BASE_URL/ci/projects/$PROJECT_ID/runs" \\
  -H "X-API-Key: $TM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"My CI Run","build_version":"'"$BUILD_NUMBER"'","environment":"'"$ENV"'"}' \\
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "Created run: $RUN_ID"

# 2. Run your tests here (replace with your test command)
# ./run-tests.sh

# 3. Push individual results (repeat for each test)
curl -s -X POST "$TM_BASE_URL/ci/runs/$RUN_ID/results" \\
  -H "X-API-Key: $TM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "results": [
      {"title": "Login with valid credentials", "status": "passed", "duration_ms": 1200},
      {"title": "Login with invalid password", "status": "failed", "notes": "Expected 401, got 200"}
    ]
  }'

# 4. Complete the run
curl -s -X POST "$TM_BASE_URL/ci/runs/$RUN_ID/complete" \\
  -H "X-API-Key: $TM_API_KEY"

echo "Done! View results at ${baseUrl.replace(/\/api$/, '')}/projects/$PROJECT_ID/runs/$RUN_ID"`,
  };
}

export default function CIIntegrationPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('GitHub Actions');
  const [revealed, setRevealed] = useState(false);

  const { data: keyData, isLoading } = useQuery({
    queryKey: ['api-key'],
    queryFn: () => api.get('/auth/api-key').then(r => r.data),
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post('/auth/api-key').then(r => r.data),
    onSuccess: () => { qc.invalidateQueries(['api-key']); setRevealed(true); toast.success('API key generated'); },
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete('/auth/api-key'),
    onSuccess: () => { qc.invalidateQueries(['api-key']); setRevealed(false); toast.success('API key revoked'); },
  });

  const apiKey = keyData?.api_key || '';
  const tabs = Object.keys(snippets('', '', ''));
  const code = snippets(apiKey, projectId, BASE_URL)[activeTab] || '';

  const copyKey = () => {
    navigator.clipboard.writeText(apiKey);
    toast.success('API key copied to clipboard');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Zap className="w-6 h-6 text-yellow-500" /> CI / Automation Integration
        </h1>
        <p className="text-gray-500 mt-1">
          Connect your CI/CD pipeline to automatically create runs, push results, and track automation coverage — just like TestRail.
        </p>
      </div>

      {/* How it works */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[
            { step: '1', icon: '🔑', title: 'Generate API Key', desc: 'Create an API key below and add it to your CI secrets.' },
            { step: '2', icon: '🚀', title: 'Create Run', desc: 'CI calls the API to create a test run at the start of the pipeline.' },
            { step: '3', icon: '📤', title: 'Push Results', desc: 'After each test, CI pushes pass/fail results matched by test case title.' },
            { step: '4', icon: '✅', title: 'Complete Run', desc: 'CI closes the run. Results appear instantly in the dashboard.' },
          ].map(s => (
            <div key={s.step} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                {s.step}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">{s.icon} {s.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Key */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
          <Key className="w-4 h-4" /> Your API Key
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Add this as <code className="bg-gray-100 px-1 rounded">TM_API_KEY</code> in your CI environment secrets. Never commit it to source control.
        </p>

        {isLoading ? (
          <div className="h-10 bg-gray-100 rounded animate-pulse" />
        ) : apiKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono text-sm">
                <span className="flex-1 text-gray-800 break-all">
                  {revealed ? apiKey : apiKey.slice(0, 6) + '••••••••••••••••••••••••••••••••••••••••••'}
                </span>
                <button onClick={() => setRevealed(r => !r)} className="text-xs text-brand-600 hover:underline flex-shrink-0">
                  {revealed ? 'Hide' : 'Reveal'}
                </button>
              </div>
              <button onClick={copyKey} className="btn-secondary py-2 px-3">
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="btn-secondary text-sm">
                <RefreshCw className="w-3.5 h-3.5" /> Regenerate
              </button>
              <button onClick={() => revokeMutation.mutate()} disabled={revokeMutation.isPending} className="btn-danger text-sm">
                <Trash2 className="w-3.5 h-3.5" /> Revoke
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="btn-primary">
            <Key className="w-4 h-4" /> {generateMutation.isPending ? 'Generating...' : 'Generate API Key'}
          </button>
        )}
      </div>

      {/* API Reference */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4" /> API Endpoints
        </h2>
        <div className="space-y-2 text-xs font-mono">
          {[
            ['POST', `/api/ci/projects/${projectId}/runs`, 'Create a test run'],
            ['POST', '/api/ci/runs/:runId/results', 'Push test results'],
            ['POST', '/api/ci/runs/:runId/complete', 'Complete & lock the run'],
            ['GET',  '/api/ci/runs/:runId', 'Get run status'],
            ['GET',  `/api/ci/projects/${projectId}/cases`, 'List test cases'],
          ].map(([method, path, desc]) => (
            <div key={path} className="flex items-center gap-3 p-2 rounded bg-gray-50">
              <span className={`w-12 text-center font-bold text-xs rounded px-1 py-0.5 ${
                method === 'GET' ? 'bg-green-100 text-green-700' : 'bg-brand-100 text-brand-700'
              }`}>{method}</span>
              <span className="text-gray-800 flex-1">{path}</span>
              <span className="text-gray-400 hidden sm:inline">{desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          All endpoints require the header: <code className="bg-gray-100 px-1 rounded">X-API-Key: &lt;your-key&gt;</code>
        </p>
      </div>

      {/* Integration snippets */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Terminal className="w-4 h-4" /> Integration Snippets
        </h2>
        {!apiKey && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
            ⚠ Generate an API key above — the snippets below will include it automatically.
          </div>
        )}
        <div className="flex gap-1 border-b border-gray-200 mb-4 flex-wrap">
          {tabs.map(t => <Tab key={t} label={t} active={activeTab === t} onClick={() => setActiveTab(t)} />)}
        </div>
        <CodeBlock code={code} />
      </div>
    </div>
  );
}
