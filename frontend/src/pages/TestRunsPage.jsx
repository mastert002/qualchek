import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, PlayCircle, Clock, Trash2, Lock, Tag, Monitor, RefreshCw, Search, Zap } from 'lucide-react';
import api from '../utils/api';
import Modal from '../components/Modal';
import { STATUS_COLORS, PRIORITY_COLORS, fmtDate, fmtDateTime, passRate } from '../utils/helpers';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';

function RunCard({ run, projectId, onDelete, selected, onSelect, selectable }) {
  const total = run.total_cases || 0;
  const pr = passRate(run.passed || 0, total - (run.pending_count || 0));

  return (
    <div className="relative">
      {selectable && (
        <div className="absolute top-3 left-3 z-10">
          <input
            type="checkbox"
            checked={selected}
            onChange={e => { e.stopPropagation(); onSelect(run.id); }}
            className="w-4 h-4 rounded border-gray-300 cursor-pointer"
          />
        </div>
      )}
      <Link to={`/projects/${projectId}/runs/${run.id}`}
        className={`card p-5 block hover:shadow-md transition-shadow group ${selectable ? 'pl-10' : ''} ${selected ? 'ring-2 ring-brand-500' : ''}`}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`badge ${STATUS_COLORS[run.status]}`}>{run.status?.replace('_', ' ')}</span>
            {run.status === 'completed' && (
              <span className="badge bg-gray-100 text-gray-500 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Locked
              </span>
            )}
            {run.run_source === 'ci' && (
              <span className="badge bg-yellow-50 text-yellow-700 border border-yellow-200 flex items-center gap-1">
                <Zap className="w-3 h-3" /> Automated
              </span>
            )}
            {run.build_version && (
              // A CI build_version is often a full 40-char commit SHA, which is a
              // single unbreakable token and overflows the card in the 3-column
              // grid. Cap the width and ellipsis it; the full value is on hover.
              <span className="badge bg-pass-50 text-pass-500 flex items-center gap-1 max-w-[10rem] min-w-0"
                title={run.build_version}>
                <Tag className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{run.build_version}</span>
              </span>
            )}
            {run.environment && (
              <span className="badge bg-teal-50 text-teal-700 flex items-center gap-1">
                <Monitor className="w-3 h-3" /> {run.environment}
              </span>
            )}
          </div>
          {onDelete && !selectable && (
            <button onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(run.id); }}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <h3 className="font-semibold text-gray-900 mb-1 truncate" title={run.name}>{run.name}</h3>
        {run.parent_run_name && (
          <p className="text-xs text-orange-600 flex items-center gap-1 mb-1">
            <RefreshCw className="w-3 h-3" /> Retest of: {run.parent_run_name}
          </p>
        )}
        {run.description && !run.parent_run_name && (
          <p className="text-sm text-gray-500 mb-3 line-clamp-1">{run.description}</p>
        )}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{total} cases</span>
            <span>{pr}% passed</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 flex overflow-hidden">
            <div className="bg-green-500 h-full" style={{ width: `${passRate(run.passed || 0, total)}%` }} />
            <div className="bg-red-500 h-full" style={{ width: `${passRate(run.failed || 0, total)}%` }} />
            <div className="bg-orange-500 h-full" style={{ width: `${passRate(run.blocked || 0, total)}%` }} />
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-green-600">{run.passed || 0} passed</span>
            <span className="text-red-600">{run.failed || 0} failed</span>
            <span className="text-orange-600">{run.blocked || 0} blocked</span>
            <span className="text-gray-400 ml-auto flex items-center gap-1">
              <Clock className="w-3 h-3" />{fmtDateTime(run.created_at)}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}

export default function TestRunsPage() {
  const { projectId } = useParams();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', build_version: '', environment: '', test_case_ids: [] });
  const [caseSearch, setCaseSearch] = useState('');
  const [casePriority, setCasePriority] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const qc = useQueryClient();
  const { canCreate, canDelete, isViewer } = useRole();
  const toast = useToast();
  const { confirm } = useConfirm();

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => api.get(`/projects/${projectId}/runs`).then(r => r.data),
  });

  const { data: cases = [] } = useQuery({
    queryKey: ['test-cases', projectId, {}],
    queryFn: () => api.get(`/projects/${projectId}/test-cases`).then(r => r.data),
    enabled: showCreate,
  });

  const createMutation = useMutation({
    mutationFn: data => api.post(`/projects/${projectId}/runs`, data),
    onSuccess: () => {
      qc.invalidateQueries(['runs', projectId]);
      setShowCreate(false);
      setForm({ name: '', description: '', build_version: '', environment: '', test_case_ids: [] });
      setCaseSearch('');
      setCasePriority('');
      toast.success('Test run created successfully', 'Run Created');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create test run'),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/projects/${projectId}/runs/${id}`),
    onSuccess: () => { qc.invalidateQueries(['runs', projectId]); },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to delete test run'),
  });

  const toggleSelect = id => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const selectAll = () => setSelectedIds(runs.map(r => r.id));
  const clearSelection = () => setSelectedIds([]);

  const handleBulkDelete = async () => {
    const ok = await confirm({
      title: 'Delete Test Runs',
      message: `Delete ${selectedIds.length} selected run${selectedIds.length > 1 ? 's' : ''} and all their results? This cannot be undone.`,
      confirmLabel: 'Delete Runs',
      variant: 'danger',
    });
    if (!ok) return;
    await Promise.all(selectedIds.map(id => deleteMutation.mutateAsync(id)));
    qc.invalidateQueries(['runs', projectId]);
    toast.success(`${selectedIds.length} run${selectedIds.length > 1 ? 's' : ''} deleted`);
    setSelectedIds([]);
  };

  const toggleCase = id => setForm(f => ({
    ...f,
    test_case_ids: f.test_case_ids.includes(id) ? f.test_case_ids.filter(x => x !== id) : [...f.test_case_ids, id],
  }));

  const selectable = !isViewer;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Test Runs</h1>
          <p className="text-gray-500 mt-1">{runs.length} runs</p>
        </div>
        <div className="flex items-center gap-2">
          {canDelete && runs.length > 0 && (
            <button
              onClick={selectable ? clearSelection : selectAll}
              className="btn-secondary text-sm"
            >
              {selectable ? `Clear (${selectedIds.length})` : 'Select'}
            </button>
          )}
          {canCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> New Test Run
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
          <span className="text-sm text-brand-700 font-medium">{selectedIds.length} run{selectedIds.length > 1 ? 's' : ''} selected</span>
          <button onClick={selectAll} className="text-xs text-brand-600 hover:underline">Select all</button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={clearSelection} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleBulkDelete} className="btn-danger text-sm flex items-center gap-1">
              <Trash2 className="w-4 h-4" /> Delete {selectedIds.length} run{selectedIds.length > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="card h-40 animate-pulse bg-gray-100" />)}
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <PlayCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="mb-4">No test runs yet.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Create Test Run
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {runs.map(run => (
            <RunCard
              key={run.id}
              run={run}
              projectId={projectId}
              selected={selectedIds.includes(run.id)}
              onSelect={toggleSelect}
              selectable={selectable}
              onDelete={canDelete ? async id => {
                const ok = await confirm({ title: 'Delete Test Run', message: 'Delete this run and all its results? This cannot be undone.', confirmLabel: 'Delete Run', variant: 'danger' });
                if (ok) deleteMutation.mutate(id);
              } : null}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New Test Run" onClose={() => { setShowCreate(false); setCaseSearch(''); setCasePriority(''); }} size="lg">
          <form onSubmit={e => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Run Name *</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
                  placeholder="e.g. Sprint 12 Regression" />
              </div>
              <div>
                <label className="label">Build / Version</label>
                <input className="input" value={form.build_version}
                  onChange={e => setForm(f => ({ ...f, build_version: e.target.value }))}
                  placeholder="e.g. v2.3.1 or Build-42" />
              </div>
              <div>
                <label className="label">Environment</label>
                <select className="input" value={form.environment}
                  onChange={e => setForm(f => ({ ...f, environment: e.target.value }))}>
                  <option value="">— Select environment —</option>
                  {['Development', 'Staging', 'UAT', 'Pre-Production', 'Production'].map(env => (
                    <option key={env} value={env}>{env}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Description</label>
                <input className="input" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">
                Select Test Cases
                <span className={`ml-2 text-xs font-normal ${form.test_case_ids.length === 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {form.test_case_ids.length === 0 ? '⚠ At least 1 case required' : `✓ ${form.test_case_ids.length} selected`}
                </span>
              </label>
              <div className="flex gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    className="input pl-9 text-sm"
                    placeholder="Search test cases..."
                    value={caseSearch}
                    onChange={e => setCaseSearch(e.target.value)}
                  />
                </div>
                <select className="input w-36 text-sm" value={casePriority} onChange={e => setCasePriority(e.target.value)}>
                  <option value="">All priorities</option>
                  {['critical', 'high', 'medium', 'low'].map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
                  <div className="flex gap-3 text-xs">
                    <button type="button" className="text-brand-600 hover:underline"
                      onClick={() => {
                        const filtered = cases.filter(c =>
                          (!caseSearch || c.title.toLowerCase().includes(caseSearch.toLowerCase())) &&
                          (!casePriority || c.priority === casePriority)
                        );
                        setForm(f => ({ ...f, test_case_ids: [...new Set([...f.test_case_ids, ...filtered.map(c => c.id)])] }));
                      }}>
                      Select all{caseSearch || casePriority ? ' filtered' : ''}
                    </button>
                    {form.test_case_ids.length > 0 && (
                      <button type="button" className="text-gray-500 hover:underline"
                        onClick={() => setForm(f => ({ ...f, test_case_ids: [] }))}>
                        Clear ({form.test_case_ids.length})
                      </button>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {cases.filter(c =>
                      (!caseSearch || c.title.toLowerCase().includes(caseSearch.toLowerCase())) &&
                      (!casePriority || c.priority === casePriority)
                    ).length} shown · {form.test_case_ids.length} selected
                  </span>
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-100">
                  {cases
                    .filter(c =>
                      (!caseSearch || c.title.toLowerCase().includes(caseSearch.toLowerCase())) &&
                      (!casePriority || c.priority === casePriority)
                    )
                    .map(tc => (
                      <label key={tc.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={form.test_case_ids.includes(tc.id)} onChange={() => toggleCase(tc.id)} className="flex-shrink-0" />
                        <span className="text-sm text-gray-700 flex-1 leading-snug">{tc.title}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {tc.suite_name && <span className="text-xs text-gray-400 hidden sm:inline">{tc.suite_name}</span>}
                          <span className={`badge text-xs ${PRIORITY_COLORS[tc.priority]}`}>{tc.priority}</span>
                        </div>
                      </label>
                    ))
                  }
                  {cases.filter(c =>
                    (!caseSearch || c.title.toLowerCase().includes(caseSearch.toLowerCase())) &&
                    (!casePriority || c.priority === casePriority)
                  ).length === 0 && (
                    <p className="p-4 text-sm text-gray-400 text-center">
                      {cases.length === 0 ? 'No test cases in this project.' : 'No test cases match your search.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit"
                disabled={createMutation.isPending || form.test_case_ids.length === 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                {createMutation.isPending ? 'Creating...' : 'Create Run'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
