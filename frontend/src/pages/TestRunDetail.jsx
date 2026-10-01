import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, XCircle, MinusCircle, SkipForward, Clock, Plus, Lock, RefreshCw, Tag, Monitor, Search, Upload, Zap } from 'lucide-react';
import api from '../utils/api';
import { safeHttpUrl } from '../utils/url';
import { PRIORITY_COLORS, STATUS_COLORS, fmtDateTime, passRate } from '../utils/helpers';
import Modal from '../components/Modal';
import { usePrint, PrintButton } from '../components/PrintReport';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import { useRole } from '../hooks/useRole';

function AddCasesModal({ allCases, existingCaseIds, selectedCases, setSelectedCases, onAdd, onClose, isPending }) {
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');

  const available = allCases.filter(c => !existingCaseIds.has(c.id));

  const filtered = available.filter(c => {
    const matchSearch = !search || c.title.toLowerCase().includes(search.toLowerCase());
    const matchPriority = !priorityFilter || c.priority === priorityFilter;
    return matchSearch && matchPriority;
  });

  const selectAll  = () => setSelectedCases(filtered.map(c => c.id));
  const clearAll   = () => setSelectedCases([]);
  const toggle     = (id) => setSelectedCases(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selectedCases.includes(c.id));

  return (
    <Modal title="Add Test Cases" onClose={onClose} size="lg">
      <div className="space-y-3">

        {/* Search + priority filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              className="input pl-9 text-sm"
              placeholder="Search test cases..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <select className="input w-36 text-sm" value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}>
            <option value="">All priorities</option>
            {['critical', 'high', 'medium', 'low'].map(p => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Select / clear bar */}
        <div className="flex items-center justify-between px-1">
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={selectAll}
              className="text-brand-600 hover:underline">
              Select all{search || priorityFilter ? ' filtered' : ''} ({filtered.length})
            </button>
            {selectedCases.length > 0 && (
              <button type="button" onClick={clearAll} className="text-gray-500 hover:underline">
                Clear ({selectedCases.length})
              </button>
            )}
          </div>
          <span className="text-xs text-gray-400">
            {available.length} available · {selectedCases.length} selected
          </span>
        </div>

        {/* Case list */}
        <div className="border border-gray-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              {available.length === 0
                ? 'All test cases are already in this run.'
                : 'No test cases match your search.'}
            </div>
          ) : (
            filtered.map(tc => (
              <label key={tc.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0">
                <input
                  type="checkbox"
                  checked={selectedCases.includes(tc.id)}
                  onChange={() => toggle(tc.id)}
                  className="flex-shrink-0"
                />
                <span className="text-sm text-gray-800 flex-1 leading-snug">{tc.title}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {tc.suite_name && (
                    <span className="text-xs text-gray-400 hidden sm:inline">{tc.suite_name}</span>
                  )}
                  <span className={`badge text-xs ${PRIORITY_COLORS[tc.priority]}`}>{tc.priority}</span>
                </div>
              </label>
            ))
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onAdd}
            disabled={selectedCases.length === 0 || isPending}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
            {isPending ? 'Adding...' : `Add ${selectedCases.length} Case${selectedCases.length !== 1 ? 's' : ''}`}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

const EXEC_STATUSES = [
  { value: 'passed', label: 'Pass', icon: CheckCircle, color: 'text-green-600 hover:bg-green-50' },
  { value: 'failed', label: 'Fail', icon: XCircle, color: 'text-red-600 hover:bg-red-50' },
  { value: 'blocked', label: 'Blocked', icon: MinusCircle, color: 'text-orange-600 hover:bg-orange-50' },
  { value: 'skipped', label: 'Skip', icon: SkipForward, color: 'text-gray-600 hover:bg-gray-50' },
];

function ExecuteModal({ item, onSave, onClose, onCreateJiraBug }) {
  const [status, setStatus] = useState(item.status !== 'pending' ? item.status : '');
  const [notes, setNotes] = useState(item.notes || '');
  const [duration, setDuration] = useState(item.duration || '');

  const hasJira = !!item.jira_issue_key;
  const showSaveAndUpdate = hasJira;

  return (
    <Modal title={`Execute: ${item.title}`} onClose={onClose} size="lg">
      {item.steps?.length > 0 && (
        <div className="mb-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Test Steps</h3>
          {item.steps.map((step, i) => (
            <div key={i} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
              <div className="flex-1 grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-xs text-gray-400">Action: </span>{step.action}</div>
                <div><span className="text-xs text-gray-400">Expected: </span>{step.expected}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-4">
        <div>
          <label className="label">Result *</label>
          <div className="grid grid-cols-4 gap-2">
            {EXEC_STATUSES.map(s => (
              <button key={s.value} type="button"
                onClick={() => setStatus(s.value)}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-sm font-medium ${
                  status === s.value ? 'border-current bg-opacity-10 ' + s.color : 'border-gray-200 text-gray-500 hover:border-gray-300'
                } ${s.color}`}>
                <s.icon className="w-5 h-5" />
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Bug IDs, observations, steps to reproduce..." />
        </div>
        <div>
          <label className="label">Duration (seconds)</label>
          <input className="input w-32" type="number" value={duration} onChange={e => setDuration(e.target.value)} />
        </div>
        <div className="flex gap-2 pt-2 flex-wrap">
          <button
            onClick={() => {
              if (!status) return;
              onSave({ status, notes, duration: duration ? Number(duration) : null });
              if (showSaveAndUpdate && onCreateJiraBug) {
                onCreateJiraBug({ notes, status });
              }
            }}
            disabled={!status}
            className="btn-primary">
            {showSaveAndUpdate
              ? `Save & Update ${item.jira_issue_key}`
              : 'Save Result'}
          </button>
          {/* Only show "Create Jira Bug" when no ticket is linked yet */}
          {(status === 'failed' || status === 'blocked') && !hasJira && onCreateJiraBug && (
            <button
              onClick={() => onCreateJiraBug({ notes, status })}
              className="btn text-sm bg-orange-500 hover:bg-orange-600 text-white">
              🐛 Create Jira Bug
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

export default function TestRunDetail() {
  const { projectId, runId } = useParams();
  const qc = useQueryClient();
  const { printRef, handlePrint } = usePrint();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { isViewer } = useRole();
  const [executing, setExecuting] = useState(null);
  const [addingCases, setAddingCases] = useState(false);
  const [selectedCases, setSelectedCases] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [jiraBugCreating, setJiraBugCreating] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importXml, setImportXml] = useState('');
  const [importResult, setImportResult] = useState(null);

  // Called with the executing item AND the current notes/status from the modal
  const createJiraBug = async (item, { notes: userNotes, status: userStatus } = {}) => {
    setJiraBugCreating(true);
    try {
      const notesContent = (userNotes || '').trim();
      const currentStatus = userStatus || item.status;
      const STATUS_EMOJI = { passed: '✅', failed: '❌', blocked: '🚫', skipped: '⏭️' };
      const emoji = STATUS_EMOJI[currentStatus] || '🔄';

      // For new tickets: notes become the description; for updates: notes become the comment
      const description = notesContent
        ? `${notesContent}\n\n---\nTest Case: ${item.title}\nStatus: ${currentStatus.toUpperCase()}\nSource: QualChek`
        : `Test case "${item.title}" marked as ${currentStatus.toUpperCase()}.\n\nSource: QualChek`;

      const res = await api.post('/jira/issue', {
        summary: `${emoji} [${currentStatus.toUpperCase()}] ${item.title}`,
        description,
        user_notes: notesContent, // backend uses this as the comment body when updating
        // No issue_type: the backend picks one the Jira project actually has.
        // Hardcoding 'Bug' failed outright on projects without that type.
        priority: item.priority === 'critical' ? 'Highest' : item.priority === 'high' ? 'High' : 'Medium',
        test_case_id: item.test_case_id,
        test_run_item_id: item.id,
      });

      if (res.data.skipped) {
        toast.warning('No notes were typed — nothing was sent to Jira', 'No Update Sent');
      } else if (res.data.updated) {
        toast.success(`Your notes were posted on ${res.data.key}`, 'Jira Ticket Updated');
      } else {
        toast.success(`Ticket ${res.data.key} created in Jira`, 'Jira Bug Created');
        const target = safeHttpUrl(res.data.url);
        if (target) window.open(target, '_blank');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update Jira. Check Jira settings.', 'Jira Error');
    } finally {
      setJiraBugCreating(false);
    }
  };

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get(`/projects/${projectId}/runs/${runId}`).then(r => r.data),
  });

  // Needed to build issue URLs. Shares JiraPanel's key so it is fetched once.
  const { data: jiraConfig } = useQuery({
    queryKey: ['jira-config'],
    queryFn: () => api.get('/jira/config').then(r => r.data),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Trailing slashes on the configured base URL would produce //browse/KEY.
  // safeHttpUrl keeps a javascript: URL saved before validation existed
  // from becoming a clickable link in someone else's session.
  const jiraBase = (safeHttpUrl(jiraConfig?.base_url) || '').replace(/\/+$/, '');

  const { data: allCases = [] } = useQuery({
    queryKey: ['test-cases', projectId, {}],
    queryFn: () => api.get(`/projects/${projectId}/test-cases`).then(r => r.data),
    enabled: addingCases,
  });

  const executeMutation = useMutation({
    mutationFn: ({ itemId, data }) => api.put(`/projects/${projectId}/runs/${runId}/items/${itemId}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries(['run', runId]);
      setExecuting(null);
      const statusLabels = { passed: '✅ Passed', failed: '❌ Failed', blocked: '🚫 Blocked', skipped: '⏭️ Skipped' };
      const label = statusLabels[vars.data.status] || 'Updated';
      toast.success(`Result saved: ${label}`, 'Test Executed');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to save result'),
  });

  const addCasesMutation = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/runs/${runId}/add-cases`, { test_case_ids: selectedCases }),
    onSuccess: () => { qc.invalidateQueries(['run', runId]); setAddingCases(false); setSelectedCases([]); },
  });

  const importMutation = useMutation({
    mutationFn: (xml) => api.post(`/projects/${projectId}/runs/${runId}/import-results`, { xml }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries(['run', runId]);
      setImportResult(data);
      toast.success(`Imported: ${data.matched} matched, ${data.skipped} unmatched`, 'JUnit Import Done');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Import failed'),
  });

  const retestMutation = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/runs/${runId}/retest`),
    onSuccess: (res) => {
      qc.invalidateQueries(['runs', projectId]);
      toast.success(`New run created with ${res.data.retest_count} failed case(s)`, 'New Run from Failures');
      window.location.href = `/projects/${projectId}/runs/${res.data.id}`;
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create new run'),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/runs/${runId}/complete`),
    onSuccess: () => {
      qc.invalidateQueries(['run', runId]);
      toast.success('Test run marked as complete and locked', 'Run Completed');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to complete run'),
  });

  if (isLoading) return <div className="p-6"><div className="h-8 bg-gray-200 rounded animate-pulse w-1/2" /></div>;
  if (!run) return <div className="p-6 text-gray-500">Not found</div>;

  const isLocked = run.status === 'completed';

  const items = run.items || [];
  const filtered = statusFilter ? items.filter(i => i.status === statusFilter) : items;
  const total = items.length;
  const passed = items.filter(i => i.status === 'passed').length;
  const failed = items.filter(i => i.status === 'failed').length;
  const blocked = items.filter(i => i.status === 'blocked').length;
  const pending = items.filter(i => i.status === 'pending').length;
  const pr = passRate(passed, total - pending);

  const existingCaseIds = new Set(items.map(i => i.test_case_id));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Link to={`/projects/${projectId}/runs`} className="btn-ghost py-1.5 px-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{run.name}</h1>
            {run.run_source === 'ci' && (
              <span className="badge bg-yellow-50 text-yellow-700 border border-yellow-200 flex items-center gap-1">
                <Zap className="w-3 h-3" /> Automated
              </span>
            )}
            {run.build_version && (
              <span className="badge bg-pass-50 text-pass-500 flex items-center gap-1">
                <Tag className="w-3 h-3" /> {run.build_version}
              </span>
            )}
            {run.environment && (
              <span className="badge bg-teal-50 text-teal-700 flex items-center gap-1">
                <Monitor className="w-3 h-3" /> {run.environment}
              </span>
            )}
          </div>
          {run.parent_run_id && (
            <Link to={`/projects/${projectId}/runs/${run.parent_run_id}`}
              className="text-xs text-orange-600 hover:underline flex items-center gap-1 mt-0.5">
              <RefreshCw className="w-3 h-3" /> Retest of an earlier run — click to view original
            </Link>
          )}
          {run.description && !run.parent_run_id && (
            <p className="text-sm text-gray-500 mt-0.5">{run.description}</p>
          )}
        </div>
        <span className={`badge ${STATUS_COLORS[run.status]} text-sm px-3 py-1`}>{run.status?.replace('_', ' ')}</span>
        {isLocked && (
          <span className="badge bg-gray-100 text-gray-600 flex items-center gap-1 px-3 py-1">
            <Lock className="w-3.5 h-3.5" /> Locked
          </span>
        )}
        <PrintButton onClick={handlePrint} label="Print" />

        {/* Active run actions */}
        {!isLocked && !isViewer && (
          <>
            <button onClick={() => setAddingCases(true)} className="btn-secondary">
              <Plus className="w-4 h-4" /> Add Cases
            </button>
            <button onClick={() => { setShowImport(true); setImportResult(null); setImportXml(''); }} className="btn-secondary">
              <Upload className="w-4 h-4" /> Import Results
            </button>
            {(() => {
              const allExecuted = total > 0 && pending === 0;
              const canComplete = run.status === 'in_progress' && allExecuted;
              const tooltip = run.status === 'pending'
                ? 'Execute at least one test case first'
                : pending > 0
                  ? `${pending} case(s) still pending — execute or skip them first`
                  : total === 0
                    ? 'Add test cases to this run first'
                    : '';
              return (
                <div className="relative group">
                  <button
                    onClick={async () => {
                      const hasFailed = (failed + blocked) > 0;
                      const ok = await confirm({
                        title: 'Mark Run as Complete?',
                        message: hasFailed
                          ? `This run still has ${failed + blocked} failed/blocked case(s). Completing will lock it permanently. Use "New Run from Failures" for the next test cycle.`
                          : 'All cases have been executed. Mark this run as complete and lock it?',
                        confirmLabel: 'Mark Complete',
                        variant: hasFailed ? 'warning' : 'info',
                      });
                      if (ok) completeMutation.mutate();
                    }}
                    disabled={!canComplete || completeMutation.isPending}
                    className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
                    <CheckCircle className="w-4 h-4" />
                    {completeMutation.isPending ? 'Completing...' : 'Mark Complete'}
                  </button>
                  {!canComplete && tooltip && (
                    <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-50">
                      <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                        {tooltip}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}

        {/* Completed run actions */}
        {isLocked && !isViewer && (failed > 0 || blocked > 0) && (
          <button onClick={() => retestMutation.mutate()} disabled={retestMutation.isPending}
            className="btn-secondary">
            <RefreshCw className="w-4 h-4" />
            {retestMutation.isPending ? 'Creating...' : `New Run from Failures (${failed + blocked})`}
          </button>
        )}
      </div>

      {/* Status banners */}
      {!isLocked && run.status === 'in_progress' && (
        <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 mb-5">
          <CheckCircle className="w-5 h-5 text-brand-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-brand-800">Run is in progress</p>
            <p className="text-xs text-brand-600 mt-0.5">
              Execute all cases, re-run any failures after fixes, then click <strong>Mark Complete</strong> when done.
            </p>
          </div>
        </div>
      )}
      {isLocked && (
        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-5">
          <Lock className="w-5 h-5 text-gray-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-700">This run is completed and locked</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {failed + blocked > 0
                ? `${failed + blocked} case(s) still failing. Use "New Run from Failures" to start the next test cycle on a new build.`
                : 'All cases passed. ✅'}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total', value: total, color: 'text-gray-700', filter: '' },
          { label: 'Passed', value: passed, color: 'text-green-600', filter: 'passed' },
          { label: 'Failed', value: failed, color: 'text-red-600', filter: 'failed' },
          { label: 'Blocked', value: blocked, color: 'text-orange-600', filter: 'blocked' },
          { label: 'Pending', value: pending, color: 'text-brand-600', filter: 'pending' },
        ].map(s => (
          <button key={s.label} onClick={() => setStatusFilter(statusFilter === s.filter ? '' : s.filter)}
            className={`card p-3 text-center cursor-pointer hover:shadow-md transition-all ${statusFilter === s.filter ? 'ring-2 ring-brand-500' : ''}`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </button>
        ))}
      </div>

      <div className="w-full bg-gray-100 rounded-full h-2 mb-6 flex overflow-hidden">
        <div className="bg-green-500 h-full transition-all" style={{ width: `${passRate(passed, total)}%` }} />
        <div className="bg-red-500 h-full transition-all" style={{ width: `${passRate(failed, total)}%` }} />
        <div className="bg-orange-500 h-full transition-all" style={{ width: `${passRate(blocked, total)}%` }} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-3 font-medium text-gray-700">Test Case</th>
              <th className="text-left p-3 font-medium text-gray-700 hidden sm:table-cell">Priority</th>
              <th className="text-left p-3 font-medium text-gray-700">Status</th>
              <th className="text-left p-3 font-medium text-gray-700 hidden md:table-cell">Notes</th>
              <th className="text-left p-3 font-medium text-gray-700 hidden lg:table-cell">Executed</th>
              <th className="w-20 p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(item => (
              <tr key={item.id} className="hover:bg-gray-50 group">
                <td className="p-3">
                  <span className="font-medium text-gray-900">{item.title}</span>
                  {item.jira_issue_key && (
                    jiraBase ? (
                      <a
                        href={`${jiraBase}/browse/${item.jira_issue_key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open ${item.jira_issue_key} in Jira`}
                        className="ml-2 badge bg-brand-50 text-brand-600 text-xs border border-brand-200 hover:bg-brand-100 hover:border-brand-300 cursor-pointer"
                      >
                        🔗 {item.jira_issue_key}
                      </a>
                    ) : (
                      // Without a configured Jira site there is nowhere to point.
                      <span className="ml-2 badge bg-brand-50 text-brand-600 text-xs border border-brand-200">
                        🔗 {item.jira_issue_key}
                      </span>
                    )
                  )}
                </td>
                <td className="p-3 hidden sm:table-cell">
                  <span className={`badge ${PRIORITY_COLORS[item.priority]}`}>{item.priority}</span>
                </td>
                <td className="p-3">
                  <span className={`badge ${STATUS_COLORS[item.status]}`}>{item.status}</span>
                </td>
                <td className="p-3 text-gray-500 hidden md:table-cell max-w-xs truncate">{item.notes || '—'}</td>
                <td className="p-3 text-gray-500 hidden lg:table-cell text-xs">{item.executor_name ? `${item.executor_name} · ${fmtDateTime(item.executed_at)}` : '—'}</td>
                <td className="p-3">
                  {isLocked || isViewer ? (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Lock className="w-3 h-3" /> {isViewer ? 'View only' : 'Locked'}
                    </span>
                  ) : (
                    <button onClick={() => setExecuting(item)} className="btn-secondary py-1 px-2 text-xs">
                      {item.status === 'pending' ? 'Execute' : 'Update'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-gray-400">No test cases match the filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {executing && (
        <ExecuteModal
          item={executing}
          onSave={data => executeMutation.mutate({ itemId: executing.id, data })}
          onClose={() => setExecuting(null)}
          onCreateJiraBug={(params) => createJiraBug(executing, params)}
        />
      )}

      {showImport && (
        <Modal title="Import JUnit XML Results" onClose={() => setShowImport(false)} size="lg">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Paste your JUnit XML report below (generated by Cypress, Playwright, Pytest, JUnit, etc.).
              Test cases are matched by name — unmatched cases are left as pending.
            </p>
            <div>
              <label className="label flex items-center justify-between">
                <span>JUnit XML</span>
                <label className="text-xs text-brand-600 hover:underline cursor-pointer">
                  Upload file
                  <input type="file" accept=".xml" className="hidden" onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => setImportXml(ev.target.result);
                    reader.readAsText(file);
                  }} />
                </label>
              </label>
              <textarea
                className="input font-mono text-xs"
                rows={10}
                placeholder={'<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>...</testsuites>'}
                value={importXml}
                onChange={e => setImportXml(e.target.value)}
              />
            </div>
            {importResult && (
              <div className={`rounded-lg p-3 text-sm ${importResult.matched > 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                <p className="font-semibold mb-1">{importResult.matched > 0 ? '✅ Import successful' : '⚠️ No matches found'}</p>
                <ul className="text-xs space-y-0.5 text-gray-700">
                  <li>Results parsed from XML: <strong>{importResult.parsed}</strong></li>
                  <li>Test cases matched &amp; updated: <strong>{importResult.matched}</strong></li>
                  <li>Test cases unmatched (still pending): <strong>{importResult.skipped}</strong></li>
                </ul>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => importMutation.mutate(importXml)}
                disabled={!importXml.trim() || importMutation.isPending}
                className="btn-primary disabled:opacity-50">
                {importMutation.isPending ? 'Importing...' : 'Import Results'}
              </button>
              <button onClick={() => setShowImport(false)} className="btn-secondary">Close</button>
            </div>
          </div>
        </Modal>
      )}

      {addingCases && (
        <AddCasesModal
          allCases={allCases}
          existingCaseIds={existingCaseIds}
          selectedCases={selectedCases}
          setSelectedCases={setSelectedCases}
          onAdd={() => addCasesMutation.mutate()}
          onClose={() => { setAddingCases(false); setSelectedCases([]); }}
          isPending={addCasesMutation.isPending}
        />
      )}

      {/* ── Hidden printable content ── */}
      <div style={{ display: 'none' }}>
        <div ref={printRef}>
          {/* Header */}
          <div className="logo-row">
            <div className="logo-box">T</div>
            <div>
              <h1>QualChek</h1>
              <p style={{ fontSize: 11, color: '#6b7280' }}>Test Run Report</p>
            </div>
          </div>
          <p className="meta">
            Run: <strong>{run.name}</strong>
            {run.description && <> &nbsp;|&nbsp; {run.description}</>}
            &nbsp;|&nbsp; Status: <strong style={{ textTransform: 'capitalize' }}>{run.status?.replace('_', ' ')}</strong>
            &nbsp;|&nbsp; Generated: {new Date().toLocaleString()}
          </p>

          {/* Summary KPIs */}
          <h2>Summary</h2>
          <div className="kpi-grid">
            {[
              { label: 'Total Cases', value: total },
              { label: 'Passed', value: passed },
              { label: 'Failed', value: failed },
              { label: 'Pass Rate', value: `${pr}%` },
            ].map(k => (
              <div key={k.label} className="kpi">
                <div className="value">{k.value}</div>
                <div className="label">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="progress-bar" style={{ marginBottom: 20 }}>
              <div className="bar-pass" style={{ width: `${passRate(passed, total)}%` }} />
              <div className="bar-fail" style={{ width: `${passRate(failed, total)}%` }} />
              <div className="bar-block" style={{ width: `${passRate(blocked, total)}%` }} />
            </div>
          )}

          {/* Full test case results */}
          <h2>Test Case Results</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: '40%' }}>Test Case</th>
                <th>Priority</th>
                <th>Result</th>
                <th>Executed By</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 500 }}>{item.title}</td>
                  <td><span className={`badge badge-${item.priority}`}>{item.priority}</span></td>
                  <td><span className={`badge badge-${item.status}`}>{item.status}</span></td>
                  <td style={{ fontSize: 10, color: '#6b7280' }}>
                    {item.executor_name || '—'}
                    {item.executed_at && <><br />{fmtDateTime(item.executed_at)}</>}
                  </td>
                  <td style={{ color: '#374151' }}>{item.notes || '—'}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#9ca3af' }}>No test cases in this run</td></tr>
              )}
            </tbody>
          </table>

          {/* Failed / Blocked cases summary */}
          {(failed > 0 || blocked > 0) && (
            <>
              <h2>Issues Requiring Attention</h2>
              <table>
                <thead>
                  <tr><th>Test Case</th><th>Result</th><th>Priority</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {items.filter(i => i.status === 'failed' || i.status === 'blocked').map(item => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 500 }}>{item.title}</td>
                      <td><span className={`badge badge-${item.status}`}>{item.status}</span></td>
                      <td><span className={`badge badge-${item.priority}`}>{item.priority}</span></td>
                      <td style={{ color: '#dc2626' }}>{item.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="footer">
            <span>QualChek &mdash; Confidential</span>
            <span>Generated {new Date().toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
