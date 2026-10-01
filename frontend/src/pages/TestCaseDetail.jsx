import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Edit2, Trash2, Send, MessageSquare } from 'lucide-react';
import api from '../utils/api';
import { PRIORITY_COLORS, STATUS_COLORS, fmtDateTime } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../hooks/useRole';
import JiraPanel from '../components/JiraPanel';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';

export default function TestCaseDetail() {
  const { projectId, caseId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isViewer } = useRole();
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [alsoPostToJira, setAlsoPostToJira] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const { data: tc, isLoading } = useQuery({
    queryKey: ['test-case', caseId],
    queryFn: () => api.get(`/projects/${projectId}/test-cases/${caseId}`).then(r => r.data),
  });

  // Shares JiraPanel's query key, so the link is fetched once and both use it.
  const { data: jiraLink } = useQuery({
    queryKey: ['jira-link', caseId],
    queryFn: () => api.get(`/jira/link/test-case/${caseId}`).then(r => r.data),
    retry: false,
  });

  const { data: suites = [] } = useQuery({
    queryKey: ['suites', projectId],
    queryFn: () => api.get(`/projects/${projectId}/suites`).then(r => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: data => api.put(`/projects/${projectId}/test-cases/${caseId}`, data),
    onSuccess: () => { qc.invalidateQueries(['test-case', caseId]); setEditing(false); toast.success('Test case updated'); },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to update test case'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/test-cases/${caseId}`),
    onSuccess: () => { toast.success('Test case deleted'); navigate(`/projects/${projectId}/test-cases`); },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to delete test case'),
  });

  const commentMutation = useMutation({
    // One request: the backend saves the comment and, when asked, mirrors it to
    // the linked Jira issue. Previously the browser made a second call for the
    // Jira half, which is the request that kept failing.
    mutationFn: () => api.post(`/projects/${projectId}/test-cases/${caseId}/comments`, {
      content: comment,
      send_to_jira: alsoPostToJira && !!jiraLink?.issue_key,
    }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries(['test-case', caseId]);
      setComment('');
      if (data?.jira?.error) toast.warning(`Comment saved, but Jira was not updated: ${data.jira.error}`, 'Jira Not Updated');
      else if (data?.jira?.key) toast.success(`Comment saved and posted to ${data.jira.key}`, 'Posted to Jira');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to post comment'),
  });

  if (isLoading) return <div className="p-6 animate-pulse"><div className="h-8 bg-gray-200 rounded w-1/2 mb-4" /></div>;
  if (!tc) return <div className="p-6 text-gray-500">Not found</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link to={`/projects/${projectId}/test-cases`} className="btn-ghost py-1.5 px-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-xl font-bold text-gray-900 flex-1">{tc.title}</h1>
        {!isViewer && (
          <button onClick={() => { setEditing(true); setEditForm({ ...tc, tags: tc.tags?.join(', '), steps: tc.steps || [], expected_result: tc.expected_result || '' }); }} className="btn-secondary">
            <Edit2 className="w-4 h-4" /> Edit
          </button>
        )}
        {!isViewer && (
          <button onClick={async () => { const ok = await confirm({ title: 'Delete Test Case', message: `Delete "${tc.title}"? This cannot be undone.`, confirmLabel: 'Delete', variant: 'danger' }); if (ok) deleteMutation.mutate(); }} className="btn-danger">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {tc.description && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Description</h2>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{tc.description}</p>
            </div>
          )}

          {tc.preconditions && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Preconditions</h2>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{tc.preconditions}</p>
            </div>
          )}

          {tc.steps?.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Test Steps</h2>
              <div className="space-y-3">
                {tc.steps.map((step, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 grid grid-cols-2 gap-4 min-w-0">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-400 mb-0.5 font-medium">Action</p>
                        <p className="text-sm text-gray-700 break-words whitespace-pre-wrap">{step.action}</p>
                      </div>
                      <div className="min-w-0 pl-4 border-l border-gray-100">
                        <p className="text-xs text-gray-400 mb-0.5 font-medium">Expected</p>
                        <p className="text-sm text-gray-700 break-words whitespace-pre-wrap">{step.expected}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tc.expected_result && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Expected Result</h2>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{tc.expected_result}</p>
            </div>
          )}

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Comments ({tc.comments?.length || 0})
            </h2>
            <div className="space-y-3 mb-4">
              {tc.comments?.map(c => (
                <div key={c.id} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">
                    {c.user_name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-700">{c.user_name}</span>
                      <span className="text-xs text-gray-400">{fmtDateTime(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-700">{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
            {!isViewer && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input className="input flex-1 text-sm" placeholder="Add a comment..." value={comment}
                    onChange={e => setComment(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && comment.trim()) { e.preventDefault(); commentMutation.mutate(); } }} />
                  <button onClick={() => commentMutation.mutate()} disabled={!comment.trim() || commentMutation.isPending} className="btn-primary px-3">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                {jiraLink?.issue_key ? (
                  <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                    <input type="checkbox" className="rounded border-gray-300"
                      checked={alsoPostToJira} onChange={e => setAlsoPostToJira(e.target.checked)} />
                    Also post this comment to {jiraLink.issue_key}
                  </label>
                ) : (
                  <p className="text-xs text-gray-400">Comments stay in QualChek. Link a Jira issue to post them to Jira too.</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Details</h2>
            {[
              ['Priority', <span className={`badge ${PRIORITY_COLORS[tc.priority]}`}>{tc.priority}</span>],
              ['Status', <span className={`badge ${STATUS_COLORS[tc.status]}`}>{tc.status}</span>],
              ['Suite', tc.suite_name || '—'],
              ['Created by', tc.creator_name],
              ['Created', fmtDateTime(tc.created_at)],
              ['Updated', fmtDateTime(tc.updated_at)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="text-gray-900 font-medium">{value}</span>
              </div>
            ))}
          </div>

          {tc.tags?.length > 0 && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Tags</h2>
              <div className="flex flex-wrap gap-1">
                {tc.tags.map(tag => (
                  <span key={tag} className="badge bg-brand-50 text-brand-700">{tag}</span>
                ))}
              </div>
            </div>
          )}

          <JiraPanel testCaseId={tc.id} projectId={projectId} readOnly={isViewer} />
        </div>
      </div>

      {editing && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-lg font-semibold">Edit Test Case</h2>
              <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="overflow-y-auto p-5">
              <form onSubmit={e => {
                e.preventDefault();
                updateMutation.mutate({
                  ...editForm,
                  tags: editForm.tags ? editForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
                  steps: editForm.steps,
                  expected_result: editForm.expected_result,
                });
              }} className="space-y-4">
                <div><label className="label">Title</label>
                  <input className="input" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Priority</label>
                    <select className="input" value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}>
                      {['critical', 'high', 'medium', 'low'].map(p => <option key={p}>{p}</option>)}
                    </select></div>
                  <div><label className="label">Status</label>
                    <select className="input" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                      {['active', 'draft', 'deprecated'].map(s => <option key={s}>{s}</option>)}
                    </select></div>
                </div>
                <div><label className="label">Suite</label>
                  <select className="input" value={editForm.suite_id || ''} onChange={e => setEditForm(f => ({ ...f, suite_id: e.target.value }))}>
                    <option value="">— No suite —</option>
                    {suites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></div>
                <div><label className="label">Tags (comma separated)</label>
                  <input className="input" value={editForm.tags} onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))} /></div>

                <div>
                  <label className="label">Test Steps</label>
                  <div className="space-y-2">
                    {editForm.steps.map((step, i) => (
                      <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-500">Step {i + 1}</span>
                          <button type="button" onClick={() => setEditForm(f => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }))}
                            className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-0.5 block">Action</label>
                          <textarea className="input text-sm" rows={2} value={step.action}
                            onChange={e => setEditForm(f => ({ ...f, steps: f.steps.map((s, idx) => idx === i ? { ...s, action: e.target.value } : s) }))} />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-0.5 block">Expected Result</label>
                          <textarea className="input text-sm" rows={2} value={step.expected}
                            onChange={e => setEditForm(f => ({ ...f, steps: f.steps.map((s, idx) => idx === i ? { ...s, expected: e.target.value } : s) }))} />
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => setEditForm(f => ({ ...f, steps: [...f.steps, { action: '', expected: '' }] }))}
                      className="btn-secondary text-sm w-full">+ Add Step</button>
                  </div>
                </div>

                <div>
                  <label className="label">Overall Expected Result</label>
                  <textarea className="input" rows={3} value={editForm.expected_result}
                    onChange={e => setEditForm(f => ({ ...f, expected_result: e.target.value }))} />
                </div>

                <div className="flex gap-2 pt-2">
                  <button type="submit" disabled={updateMutation.isPending} className="btn-primary">Save</button>
                  <button type="button" onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
