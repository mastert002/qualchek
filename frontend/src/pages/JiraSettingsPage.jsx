import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, ExternalLink, Settings, Loader } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import api from '../utils/api';
import { useRole } from '../hooks/useRole';
import { Navigate } from 'react-router-dom';

export default function JiraSettingsPage() {
  const { isAdmin } = useRole();
  const qc = useQueryClient();

  if (!isAdmin) return <Navigate to="/projects" replace />;

  const [form, setForm] = useState({ base_url: '', email: '', api_token: '', default_project: '' });
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ['jira-config'],
    queryFn: () => api.get('/jira/config').then(r => r.data),
  });

  useEffect(() => {
    if (config?.configured) {
      setForm(f => ({
        ...f,
        base_url: config.base_url || '',
        email: config.email || '',
        default_project: config.default_project || '',
      }));
    }
  }, [config]);

  const { data: jiraProjects = [] } = useQuery({
    queryKey: ['jira-projects'],
    queryFn: () => api.get('/jira/projects').then(r => r.data),
    enabled: config?.configured,
    retry: false,
  });

  const [saveError, setSaveError] = useState(null);

  const saveMutation = useMutation({
    mutationFn: () => api.post('/jira/config', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jira-config'] });
      qc.invalidateQueries({ queryKey: ['jira-projects'] });
      setSaved(true);
      setSaveError(null);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err) => {
      setSaveError(err.response?.data?.error || 'Failed to save configuration');
    },
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/jira/config/test', {
        ...form,
        api_token: form.api_token || '__use_saved__',
      });
      setTestResult({ ok: true, msg: `Connected as ${res.data.user}` });
    } catch (err) {
      setTestResult({ ok: false, msg: err.response?.data?.error || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) return <div className="p-6 animate-pulse"><div className="h-8 bg-gray-200 rounded w-64" /></div>;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
          <Settings className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Jira Integration</h1>
          <p className="text-gray-500 text-sm">Connect QualChek to your Jira workspace</p>
        </div>
        {config?.configured && (
          <span className="ml-auto badge bg-green-100 text-green-700 flex items-center gap-1 px-3 py-1">
            <CheckCircle className="w-3.5 h-3.5" /> Connected
          </span>
        )}
      </div>

      {/* How it works */}
      <div className="card p-5 mb-6 bg-brand-50 border-brand-200">
        <h2 className="font-semibold text-brand-900 mb-3">What you can do with Jira integration</h2>
        <ul className="space-y-1.5 text-sm text-brand-800">
          {[
            '🔗 Link any test case to an existing Jira issue (e.g. PROJ-123)',
            '🐛 Create a new Jira bug directly from a failed test run item',
            '📋 Push test run summary results as a comment on any Jira issue',
            '👁️ View live Jira issue status from within the test case detail page',
          ].map(t => <li key={t}>{t}</li>)}
        </ul>
      </div>

      <div className="card p-6 space-y-5">
        <h2 className="font-semibold text-gray-900">Jira Credentials</h2>

        <div>
          <label className="label">Jira Base URL *</label>
          <input className="input" placeholder="https://yourcompany.atlassian.net"
            value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} />
          <p className="text-xs text-gray-400 mt-1">Your Atlassian domain — no trailing slash</p>
        </div>

        <div>
          <label className="label">Email *</label>
          <input className="input" type="email" placeholder="you@yourcompany.com"
            value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        </div>

        <div>
          <label className="label">API Token {config?.configured ? '' : '*'}</label>
          <PasswordInput placeholder={config?.configured ? 'Leave blank to keep existing token' : 'Paste your API token'}
            value={form.api_token} onChange={e => setForm(f => ({ ...f, api_token: e.target.value }))} />
          {config?.configured && !form.api_token && (
            <p className="text-xs text-green-600 mt-1">Token saved — leave blank to keep it</p>
          )}
          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
            Generate at{' '}
            <a href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank" rel="noreferrer" className="text-brand-600 hover:underline flex items-center gap-0.5">
              id.atlassian.com/manage-profile/security/api-tokens
              <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>

        <div>
          <label className="label">Default Jira Project Key</label>
          {jiraProjects.length > 0 ? (
            <select className="input" value={form.default_project}
              onChange={e => setForm(f => ({ ...f, default_project: e.target.value }))}>
              <option value="">— Select a project —</option>
              {jiraProjects.map(p => (
                <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
              ))}
            </select>
          ) : (
            <input className="input" placeholder="e.g. PROJ"
              value={form.default_project} onChange={e => setForm(f => ({ ...f, default_project: e.target.value }))} />
          )}
          <p className="text-xs text-gray-400 mt-1">Used when creating bugs — can be overridden per issue</p>
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 rounded-lg p-3 text-sm ${testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {testResult.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
            {testResult.msg}
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-2 rounded-lg p-3 text-sm bg-green-50 text-green-700 border border-green-200">
            <CheckCircle className="w-4 h-4" /> Configuration saved successfully!
          </div>
        )}
        {saveError && (
          <div className="flex items-center gap-2 rounded-lg p-3 text-sm bg-red-50 text-red-700 border border-red-200">
            <XCircle className="w-4 h-4" /> {saveError}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={handleTest} disabled={testing || !form.base_url || !form.email || (!form.api_token && !config?.configured)}
            className="btn-secondary">
            {testing ? <><Loader className="w-4 h-4 animate-spin" /> Testing...</> : 'Test Connection'}
          </button>
          <button onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.base_url || !form.email || !form.api_token}
            className="btn-primary">
            {saveMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      <div className="card p-5 mt-6">
        <h2 className="font-semibold text-gray-900 mb-3">Setup Guide</h2>
        <ol className="space-y-3 text-sm text-gray-700">
          {[
            ['Get your API token', 'Go to Atlassian Account → Security → API tokens → Create API token'],
            ['Enter your base URL', 'e.g. https://mycompany.atlassian.net (no trailing slash)'],
            ['Enter your email', 'The email you use to log in to Jira'],
            ['Test the connection', 'Click "Test Connection" to verify credentials before saving'],
            ['Set a default project', 'Choose the Jira project where bugs will be created by default'],
            ['Start linking', 'Open any test case detail page → click "Link Jira Issue" to connect it'],
          ].map(([title, desc], i) => (
            <li key={i} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-gray-900">{title}</p>
                <p className="text-gray-500 text-xs">{desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
