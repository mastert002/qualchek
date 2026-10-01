import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, ChevronRight, FolderPlus, ListChecks, Edit2, Code2 } from 'lucide-react';
import api from '../utils/api';
import { safeHttpUrl } from '../utils/url';
import Modal from '../components/Modal';
import ExportScriptsModal from '../components/ExportScriptsModal';
import { PRIORITY_COLORS, STATUS_COLORS, fmtDate } from '../utils/helpers';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';

function StepEditor({ steps, onChange }) {
  const addStep = () => onChange([...steps, { action: '', expected: '' }]);
  const updateStep = (i, field, val) => {
    const s = [...steps];
    s[i] = { ...s[i], [field]: val };
    onChange(s);
  };
  const removeStep = i => onChange(steps.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <div key={i} className="flex gap-2 items-start">
          <span className="mt-2 text-xs font-bold text-gray-400 w-5 flex-shrink-0">{i + 1}</span>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <input className="input text-sm" placeholder="Action" value={step.action}
              onChange={e => updateStep(i, 'action', e.target.value)} />
            <input className="input text-sm" placeholder="Expected result" value={step.expected}
              onChange={e => updateStep(i, 'expected', e.target.value)} />
          </div>
          <button type="button" onClick={() => removeStep(i)} className="mt-2 text-gray-400 hover:text-red-500">×</button>
        </div>
      ))}
      <button type="button" onClick={addStep} className="btn-ghost text-sm py-1">
        <Plus className="w-3.5 h-3.5" /> Add Step
      </button>
    </div>
  );
}

function TestCaseForm({ onSubmit, initial = {}, suites = [], loading }) {
  const [form, setForm] = useState({
    title: initial.title || '',
    description: initial.description || '',
    preconditions: initial.preconditions || '',
    suite_id: initial.suite_id || '',
    priority: initial.priority || 'medium',
    status: initial.status || 'active',
    expected_result: initial.expected_result || '',
    steps: initial.steps || [],
    tags: initial.tags?.join(', ') || '',
  });

  const handleSubmit = e => {
    e.preventDefault();
    onSubmit({
      ...form,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Title *</label>
          <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
        </div>
        <div>
          <label className="label">Priority</label>
          <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
            {['critical', 'high', 'medium', 'low'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {['active', 'draft', 'deprecated'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Suite</label>
          <select className="input" value={form.suite_id} onChange={e => setForm(f => ({ ...f, suite_id: e.target.value }))}>
            <option value="">— No suite —</option>
            {suites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Description</label>
          <textarea className="input" rows={2} value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <label className="label">Preconditions</label>
          <textarea className="input" rows={2} value={form.preconditions}
            onChange={e => setForm(f => ({ ...f, preconditions: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <label className="label">Test Steps</label>
          <StepEditor steps={form.steps} onChange={steps => setForm(f => ({ ...f, steps }))} />
        </div>
        <div className="col-span-2">
          <label className="label">Overall Expected Result</label>
          <textarea className="input" rows={2} value={form.expected_result}
            onChange={e => setForm(f => ({ ...f, expected_result: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <label className="label">Tags (comma separated)</label>
          <input className="input" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
            placeholder="e.g. login, smoke, regression" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Saving...' : initial.id ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  );
}

export default function TestCasesPage() {
  const { projectId } = useParams();
  const [showCreate, setShowCreate] = useState(false);
  const [showSuite, setShowSuite] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [suiteName, setSuiteName] = useState('');
  const [editSuite, setEditSuite] = useState(null);
  const [filters, setFilters] = useState({ search: '', priority: '', status: '', suite_id: '' });
  const [selected, setSelected] = useState([]);
  const qc = useQueryClient();
  const { canCreate, canDelete, canManage, isViewer } = useRole();
  const toast = useToast();
  const { confirm } = useConfirm();

  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));

  const { data: cases = [], isLoading } = useQuery({
    queryKey: ['test-cases', projectId, filters],
    queryFn: () => api.get(`/projects/${projectId}/test-cases`, { params }).then(r => r.data),
  });

  const { data: suites = [] } = useQuery({
    queryKey: ['suites', projectId],
    queryFn: () => api.get(`/projects/${projectId}/suites`).then(r => r.data),
  });

  const { data: jiraConfig } = useQuery({
    queryKey: ['jira-config'],
    queryFn: () => api.get('/jira/config').then(r => r.data),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: data => api.post(`/projects/${projectId}/test-cases`, data),
    onSuccess: () => {
      qc.invalidateQueries(['test-cases', projectId]);
      setShowCreate(false);
      toast.success('Test case created successfully', 'Test Case Created');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create test case'),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/projects/${projectId}/test-cases/${id}`),
    onSuccess: () => { qc.invalidateQueries(['test-cases', projectId]); toast.success('Test case deleted'); },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to delete test case'),
  });

  const createSuiteMutation = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/suites`, { name: suiteName }),
    onSuccess: () => {
      qc.invalidateQueries(['suites', projectId]);
      setShowSuite(false);
      setSuiteName('');
      toast.success(`Suite "${suiteName}" created`);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create suite'),
  });

  const updateSuiteMutation = useMutation({
    mutationFn: ({ id, name, description }) => api.put(`/projects/${projectId}/suites/${id}`, { name, description }),
    onSuccess: () => {
      qc.invalidateQueries(['suites', projectId]);
      setEditSuite(null);
      toast.success('Suite updated');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to update suite'),
  });

  const deleteSuiteMutation = useMutation({
    mutationFn: id => api.delete(`/projects/${projectId}/suites/${id}`),
    onSuccess: () => {
      qc.invalidateQueries(['suites', projectId]);
      qc.invalidateQueries(['test-cases', projectId]);
      toast.success('Suite deleted');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to delete suite'),
  });

  const handleDeleteSuite = async (suite) => {
    const ok = await confirm({
      title: 'Delete Suite',
      message: `Delete "${suite.name}"? Test cases in this suite will not be deleted but will be unassigned.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) deleteSuiteMutation.mutate(suite.id);
  };

  const toggleSelect = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const bulkDeleteMutation = useMutation({
    mutationFn: ids => api.delete(`/projects/${projectId}/test-cases`, { data: { ids } }),
    onSuccess: (_, ids) => {
      qc.invalidateQueries(['test-cases', projectId]);
      setSelected([]);
      toast.success(`${ids.length} test case${ids.length !== 1 ? 's' : ''} deleted`);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to delete'),
  });

  const handleBulkDelete = async () => {
    const ok = await confirm({
      title: 'Delete Test Cases',
      message: `Delete ${selected.length} selected test case${selected.length !== 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) bulkDeleteMutation.mutate(selected);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Test Cases</h1>
          <p className="text-gray-500 mt-1">{cases.length} cases found</p>
        </div>
        <div className="flex gap-2">
          {canCreate && (
            <button onClick={() => setShowSuite(true)} className="btn-secondary">
              <FolderPlus className="w-4 h-4" /> New Suite
            </button>
          )}
          {canCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> New Test Case
            </button>
          )}
        </div>
      </div>

      <div className="card p-4 mb-4 flex flex-wrap gap-3">
        <div className="flex-1 min-w-48 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9" placeholder="Search test cases..." value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
        </div>
        <select className="input w-auto" value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}>
          <option value="">All priorities</option>
          {['critical', 'high', 'medium', 'low'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="input w-auto" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          {['active', 'draft', 'deprecated'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <select className="input w-auto" value={filters.suite_id} onChange={e => setFilters(f => ({ ...f, suite_id: e.target.value }))}>
            <option value="">All suites</option>
            {suites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {canManage && suites.length > 0 && (
            <button onClick={() => setEditSuite('manage')} className="btn-ghost p-2" title="Manage suites">
              <Edit2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {selected.length > 0 && !isViewer && (
        <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-lg px-4 py-2.5 mb-2">
          <span className="text-sm font-medium text-brand-700">{selected.length} selected</span>
          <div className="flex-1" />
          <button onClick={() => setSelected([])} className="btn-ghost text-sm py-1">Clear</button>
          <button
            onClick={() => setShowExport(true)}
            className="btn-secondary text-sm py-1"
          >
            <Code2 className="w-4 h-4" />
            Export Scripts
          </button>
          {canDelete && (
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              className="btn-danger text-sm py-1"
            >
              <Trash2 className="w-4 h-4" />
              Delete {selected.length} selected
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="card h-16 animate-pulse bg-gray-100" />)}</div>
      ) : cases.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <ListChecks className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No test cases found. Create your first one!</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {!isViewer && <th className="w-8 p-3"><input type="checkbox" onChange={e => setSelected(e.target.checked ? cases.map(c => c.id) : [])} /></th>}
                <th className="text-left p-3 font-medium text-gray-700">Title</th>
                <th className="text-left p-3 font-medium text-gray-700 hidden sm:table-cell">Suite</th>
                <th className="text-left p-3 font-medium text-gray-700">Priority</th>
                <th className="text-left p-3 font-medium text-gray-700">Status</th>
                <th className="text-left p-3 font-medium text-gray-700 hidden md:table-cell">Automation</th>
                <th className="text-left p-3 font-medium text-gray-700 hidden md:table-cell">Created</th>
                <th className="w-10 p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cases.map(tc => (
                <tr key={tc.id} className="hover:bg-gray-50 group">
                  {!isViewer && <td className="p-3"><input type="checkbox" checked={selected.includes(tc.id)} onChange={() => toggleSelect(tc.id)} /></td>}
                  <td className="p-3">
                    <Link to={`/projects/${projectId}/test-cases/${tc.id}`} className="font-medium text-gray-900 hover:text-brand-600 flex items-center gap-1">
                      {tc.title}
                      <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                    </Link>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {tc.jira_issue_key && (
                        safeHttpUrl(jiraConfig?.base_url) ? (
                          <a
                            href={`${safeHttpUrl(jiraConfig.base_url)}/browse/${tc.jira_issue_key}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="badge bg-brand-50 text-brand-600 border border-brand-200 text-xs flex items-center gap-1 hover:bg-brand-100"
                          >
                            🔗 {tc.jira_issue_key}
                          </a>
                        ) : (
                          <span className="badge bg-brand-50 text-brand-600 border border-brand-200 text-xs flex items-center gap-1">
                            🔗 {tc.jira_issue_key}
                          </span>
                        )
                      )}
                      {tc.tags?.slice(0, 3).map(tag => (
                        <span key={tag} className="badge bg-gray-100 text-gray-600 text-xs">{tag}</span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-gray-500 hidden sm:table-cell">{tc.suite_name || '—'}</td>
                  <td className="p-3">
                    <span className={`badge ${PRIORITY_COLORS[tc.priority]}`}>{tc.priority}</span>
                  </td>
                  <td className="p-3">
                    <span className={`badge ${STATUS_COLORS[tc.status]}`}>{tc.status}</span>
                  </td>
                  <td className="p-3 hidden md:table-cell">
                    {tc.automation_status === 'automated' ? (
                      <span className="badge bg-purple-50 text-purple-700 text-xs flex items-center gap-1 w-fit">
                        <Code2 className="w-3 h-3" />
                        {tc.automation_framework || 'automated'}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">manual</span>
                    )}
                  </td>
                  <td className="p-3 text-gray-500 hidden md:table-cell">{fmtDate(tc.created_at)}</td>
                  <td className="p-3">
                    {canDelete && (
                      <button onClick={async () => {
                        const ok = await confirm({ title: 'Delete Test Case', message: `Delete "${tc.title}"? This cannot be undone.`, confirmLabel: 'Delete', variant: 'danger' });
                        if (ok) deleteMutation.mutate(tc.id);
                      }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal title="New Test Case" onClose={() => setShowCreate(false)} size="lg">
          <TestCaseForm suites={suites} onSubmit={createMutation.mutate} loading={createMutation.isPending} />
        </Modal>
      )}

      {showSuite && (
        <Modal title="New Suite" onClose={() => setShowSuite(false)} size="sm">
          <form onSubmit={e => { e.preventDefault(); createSuiteMutation.mutate(); }} className="space-y-4">
            <div>
              <label className="label">Suite Name *</label>
              <input className="input" value={suiteName} onChange={e => setSuiteName(e.target.value)} required autoFocus />
            </div>
            <button type="submit" disabled={createSuiteMutation.isPending} className="btn-primary">Create</button>
          </form>
        </Modal>
      )}

      {editSuite === 'manage' && (
        <Modal title="Manage Suites" onClose={() => setEditSuite(null)} size="sm">
          <div className="space-y-2">
            {suites.map(s => (
              <div key={s.id} className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg">
                <span className="flex-1 text-sm font-medium text-gray-800">{s.name}</span>
                <span className="text-xs text-gray-400">{s.test_case_count} case{s.test_case_count !== 1 ? 's' : ''}</span>
                <button onClick={() => setEditSuite(s)} className="btn-ghost p-1.5" title="Edit suite">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDeleteSuite(s)} className="btn-ghost p-1.5 text-red-400 hover:text-red-600" title="Delete suite">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {suites.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No suites yet.</p>}
          </div>
        </Modal>
      )}

      {showExport && (
        <ExportScriptsModal
          projectId={projectId}
          selectedIds={selected}
          allCases={cases}
          onClose={() => setShowExport(false)}
        />
      )}

      {editSuite && editSuite !== 'manage' && (
        <Modal title="Edit Suite" onClose={() => setEditSuite(null)} size="sm">
          <form onSubmit={e => {
            e.preventDefault();
            updateSuiteMutation.mutate({ id: editSuite.id, name: editSuite.name, description: editSuite.description });
          }} className="space-y-4">
            <div>
              <label className="label">Suite Name *</label>
              <input className="input" value={editSuite.name} onChange={e => setEditSuite(s => ({ ...s, name: e.target.value }))} required autoFocus />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={2} value={editSuite.description || ''} onChange={e => setEditSuite(s => ({ ...s, description: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={updateSuiteMutation.isPending} className="btn-primary">Save</button>
              <button type="button" onClick={() => setEditSuite('manage')} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
