import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, Link2Off, Plus, Loader, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { safeHttpUrl } from '../utils/url';

const STATUS_COLORS = {
  'blue-grey': 'bg-gray-100 text-gray-700',
  'yellow': 'bg-yellow-100 text-yellow-800',
  'green': 'bg-green-100 text-green-800',
  'red': 'bg-red-100 text-red-800',
};

function JiraStatusBadge({ status, category }) {
  const cls = STATUS_COLORS[category] || 'bg-brand-100 text-brand-700';
  return <span className={`badge ${cls} text-xs`}>{status}</span>;
}

export default function JiraPanel({ testCaseId, projectId, readOnly = false }) {
  const qc = useQueryClient();
  const [linkInput, setLinkInput] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [createForm, setCreateForm] = useState({ summary: '', priority: 'Medium', issue_type: '' });
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Check if Jira is configured
  const { data: jiraConfig } = useQuery({
    queryKey: ['jira-config'],
    queryFn: () => api.get('/jira/config').then(r => r.data),
    retry: false,
  });

  // The types this Jira project really offers. A team-managed project often has
  // no "Bug", and sending one that does not exist is rejected with a 400.
  const { data: issueTypes = [] } = useQuery({
    queryKey: ['jira-issue-types', jiraConfig?.default_project],
    queryFn: () => api.get('/jira/issue-types').then(r => r.data),
    enabled: jiraConfig?.configured,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Settle on a default once the real list arrives.
  useEffect(() => {
    if (!createForm.issue_type && issueTypes.length) {
      const preferred = issueTypes.find(t => /^bug$/i.test(t.name))
        || issueTypes.find(t => /^task$/i.test(t.name))
        || issueTypes[0];
      setCreateForm(f => ({ ...f, issue_type: preferred.name }));
    }
  }, [issueTypes, createForm.issue_type]);

  const selectedType = issueTypes.find(t => t.name === createForm.issue_type);

  // Get linked issue key
  const { data: linkData } = useQuery({
    queryKey: ['jira-link', testCaseId],
    queryFn: () => api.get(`/jira/link/test-case/${testCaseId}`).then(r => r.data),
    enabled: jiraConfig?.configured,
  });

  // Fetch issue details
  const { data: issue, isLoading: issueLoading, error: issueError } = useQuery({
    queryKey: ['jira-issue', linkData?.issue_key],
    queryFn: () => api.get(`/jira/issue/${linkData.issue_key}`).then(r => r.data),
    enabled: !!linkData?.issue_key,
    retry: false,
  });

  const linkMutation = useMutation({
    mutationFn: () => api.post('/jira/link/test-case', { test_case_id: testCaseId, issue_key: linkInput.trim().toUpperCase() }),
    onSuccess: () => { qc.invalidateQueries(['jira-link', testCaseId]); setShowLinkForm(false); setLinkInput(''); },
  });

  const unlinkMutation = useMutation({
    mutationFn: () => api.delete(`/jira/link/test-case/${testCaseId}`),
    onSuccess: () => { qc.invalidateQueries(['jira-link', testCaseId]); qc.removeQueries(['jira-issue']); },
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/jira/issue', { ...createForm, test_case_id: testCaseId, project_key: jiraConfig?.default_project }),
    onSuccess: (res) => {
      qc.invalidateQueries(['jira-link', testCaseId]);
      setShowCreateForm(false);
      setCreateForm(f => ({ summary: '', priority: 'Medium', issue_type: f.issue_type }));
    },
  });

  if (!jiraConfig?.configured) {
    return (
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <Link2 className="w-4 h-4" /> Jira
        </h2>
        <p className="text-xs text-gray-400">Jira is not configured. <a href="/settings/jira" className="text-brand-600 hover:underline">Set it up →</a></p>
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-brand-500" /> Jira Issue
        </h2>
        {linkData?.issue_key && !readOnly && (
          <button onClick={() => unlinkMutation.mutate()} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1">
            <Link2Off className="w-3 h-3" /> Unlink
          </button>
        )}
      </div>

      {!linkData?.issue_key ? (
        <div className="space-y-2">
          {readOnly ? (
            <p className="text-xs text-gray-400">No Jira issue linked.</p>
          ) : showLinkForm ? (
            <div className="flex gap-2">
              <input className="input text-sm flex-1" placeholder="e.g. PROJ-123"
                value={linkInput} onChange={e => setLinkInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && linkInput.trim()) linkMutation.mutate(); }} />
              <button onClick={() => linkMutation.mutate()} disabled={!linkInput.trim() || linkMutation.isPending}
                className="btn-primary py-1.5 text-sm">Link</button>
              <button onClick={() => setShowLinkForm(false)} className="btn-ghost py-1.5 text-sm">✕</button>
            </div>
          ) : !readOnly && showCreateForm ? (
            <div className="space-y-2">
              <input className="input text-sm" placeholder="Bug summary *"
                value={createForm.summary} onChange={e => setCreateForm(f => ({ ...f, summary: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <select className="input text-sm" value={createForm.issue_type}
                  onChange={e => setCreateForm(f => ({ ...f, issue_type: e.target.value }))}>
                  {issueTypes.length
                    ? issueTypes.map(t => <option key={t.name}>{t.name}</option>)
                    : <option value="">Loading types…</option>}
                </select>
                {selectedType && selectedType.allowsPriority === false ? (
                  <p className="text-xs text-gray-400 self-center">No priority on {selectedType.name}</p>
                ) : (
                  <select className="input text-sm" value={createForm.priority}
                    onChange={e => setCreateForm(f => ({ ...f, priority: e.target.value }))}>
                    {['Highest', 'High', 'Medium', 'Low', 'Lowest'].map(p => <option key={p}>{p}</option>)}
                  </select>
                )}
              </div>
              {createMutation.isError && (
                <p className="text-xs text-red-600">{createMutation.error?.response?.data?.error || 'Failed to create issue'}</p>
              )}
              <div className="flex gap-2">
                <button onClick={() => createMutation.mutate()} disabled={!createForm.summary || createMutation.isPending}
                  className="btn-primary py-1 text-xs">
                  {createMutation.isPending ? 'Creating...' : 'Create Issue'}
                </button>
                <button onClick={() => setShowCreateForm(false)} className="btn-ghost py-1 text-xs">Cancel</button>
              </div>
            </div>
          ) : !readOnly ? (
            <div className="flex gap-2">
              <button onClick={() => setShowLinkForm(true)} className="btn-secondary py-1.5 text-xs flex-1">
                <Link2 className="w-3.5 h-3.5" /> Link Existing Issue
              </button>
              <button onClick={() => setShowCreateForm(true)} className="btn-ghost py-1.5 text-xs flex-1">
                <Plus className="w-3.5 h-3.5" /> Create Issue
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div>
          {issueLoading && <div className="flex items-center gap-2 text-xs text-gray-400"><Loader className="w-3 h-3 animate-spin" /> Loading...</div>}
          {issueError && (
            <div className="text-xs text-red-500 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Could not load issue details
              <span className="text-gray-500 ml-1">({linkData.issue_key})</span>
            </div>
          )}
          {issue && safeHttpUrl(issue.url) && (
            <a href={safeHttpUrl(issue.url)} target="_blank" rel="noreferrer"
              className="block p-3 bg-gray-50 rounded-lg hover:bg-brand-50 transition-colors group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-brand-600">{issue.key}</span>
                    <span className="text-xs text-gray-400">{issue.issueType}</span>
                  </div>
                  <p className="text-sm text-gray-800 font-medium truncate">{issue.summary}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <JiraStatusBadge status={issue.status} category={issue.statusCategory} />
                    {issue.priority && <span className="text-xs text-gray-500">P: {issue.priority}</span>}
                    {issue.assignee && <span className="text-xs text-gray-500">👤 {issue.assignee}</span>}
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-gray-400 group-hover:text-brand-500 flex-shrink-0 mt-0.5" />
              </div>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
