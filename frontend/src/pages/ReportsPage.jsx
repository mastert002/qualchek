import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, LineChart, Line, CartesianGrid,
} from 'recharts';
import api from '../utils/api';
import { fmtDate, passRate } from '../utils/helpers';
import { usePrint, PrintButton } from '../components/PrintReport';

const PIE_COLORS = ['#22c55e', '#ef4444', '#f97316', '#9ca3af'];

export default function ReportsPage() {
  const { projectId } = useParams();
  const { printRef, handlePrint } = usePrint();

  const { data: report, isLoading } = useQuery({
    queryKey: ['report', projectId],
    queryFn: () => api.get(`/projects/${projectId}/reports/summary`).then(r => r.data),
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get(`/projects/${projectId}`).then(r => r.data),
  });

  if (isLoading) return (
    <div className="p-6 space-y-4">
      {[...Array(4)].map((_, i) => <div key={i} className="card h-48 animate-pulse bg-gray-100" />)}
    </div>
  );

  const tc = report?.test_cases || {};
  const exec = report?.executions || {};
  const runs = report?.runs || {};
  const totalExec = (exec.passed || 0) + (exec.failed || 0) + (exec.blocked || 0) + (exec.skipped || 0);
  const pr = passRate(exec.passed || 0, totalExec);

  const execPie = [
    { name: 'Passed', value: exec.passed || 0 },
    { name: 'Failed', value: exec.failed || 0 },
    { name: 'Blocked', value: exec.blocked || 0 },
    { name: 'Skipped', value: exec.skipped || 0 },
  ].filter(d => d.value > 0);

  const statusPie = [
    { name: 'Active', value: tc.active || 0 },
    { name: 'Draft', value: tc.draft || 0 },
    { name: 'Deprecated', value: tc.deprecated || 0 },
  ].filter(d => d.value > 0);

  const printedAt = new Date().toLocaleString();

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Page header — screen only */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Quality metrics and trends</p>
        </div>
        <PrintButton onClick={handlePrint} label="Print Report" />
      </div>

      {/* ── Charts (screen only) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Test Cases', value: tc.total || 0, sub: `${tc.active || 0} active` },
          { label: 'Total Runs', value: runs.total_runs || 0, sub: `${runs.completed || 0} completed` },
          { label: 'Total Executions', value: totalExec, sub: 'across all runs' },
          { label: 'Overall Pass Rate', value: `${pr}%`, sub: `${exec.passed || 0} passed` },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <p className="text-sm text-gray-500">{k.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{k.value}</p>
            <p className="text-xs text-gray-400 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Execution Results Distribution</h2>
          {totalExec === 0 ? (
            <div className="text-center text-gray-400 py-10">No executions yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={execPie} cx="50%" cy="50%" outerRadius={90} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {execPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Test Case Status</h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={statusPie} cx="50%" cy="50%" outerRadius={90} dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {statusPie.map((_, i) => <Cell key={i} fill={['#3b82f6', '#9ca3af', '#ef4444'][i]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Pass Rate Trend (Last 20 Runs)</h2>
        {!report?.pass_rate_trend?.length ? (
          <div className="text-center text-gray-400 py-10">No completed runs yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={report.pass_rate_trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={v => `${v}%`} />
              <Line type="monotone" dataKey="pass_rate" name="Pass Rate" stroke="#3b82f6"
                strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {report?.suite_breakdown?.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Test Cases by Suite</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={report.suite_breakdown} layout="vertical" margin={{ left: 80, right: 20 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="suite_name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip />
              <Bar dataKey="total" name="Total" fill="#dbeafe" />
              <Bar dataKey="active" name="Active" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-4">All Test Runs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Run Name','Status','Cases','Passed','Failed','Pass Rate','Date'].map(h => (
                  <th key={h} className="text-left p-3 font-medium text-gray-700">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(report?.recent_runs || []).map(run => {
                const pr = passRate(run.passed || 0, run.total || 0);
                return (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="p-3">
                      <Link to={`/projects/${projectId}/runs/${run.id}`} className="text-brand-600 hover:underline">{run.name}</Link>
                    </td>
                    <td className="p-3 capitalize text-gray-600">{run.status?.replace('_', ' ')}</td>
                    <td className="p-3 text-gray-700">{run.total || 0}</td>
                    <td className="p-3 text-green-600 font-medium">{run.passed || 0}</td>
                    <td className="p-3 text-red-600 font-medium">{run.failed || 0}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5 w-16">
                          <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pr}%` }} />
                        </div>
                        <span className={`text-xs font-medium ${pr >= 80 ? 'text-green-600' : pr >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {pr}%
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-gray-500">{fmtDate(run.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Hidden printable content ── */}
      <div style={{ display: 'none' }}>
        <div ref={printRef}>
          {/* Header */}
          <div className="logo-row">
            <div className="logo-box">T</div>
            <div>
              <h1>QualChek</h1>
              <p style={{ fontSize: 11, color: '#6b7280' }}>Project Quality Report</p>
            </div>
          </div>
          <p className="meta">
            Project: <strong>{project?.name}</strong> &nbsp;|&nbsp;
            {project?.description && <>{project.description} &nbsp;|&nbsp;</>}
            Generated: {printedAt}
          </p>

          {/* KPIs */}
          <h2>Summary</h2>
          <div className="kpi-grid">
            {[
              { label: 'Test Cases', value: tc.total || 0 },
              { label: 'Test Runs', value: runs.total_runs || 0 },
              { label: 'Total Executions', value: totalExec },
              { label: 'Pass Rate', value: `${pr}%` },
            ].map(k => (
              <div key={k.label} className="kpi">
                <div className="value">{k.value}</div>
                <div className="label">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Execution breakdown */}
          <h2>Execution Results</h2>
          <div className="summary-row">
            {[
              { label: 'Passed', val: exec.passed || 0, cls: 'green' },
              { label: 'Failed', val: exec.failed || 0, cls: 'red' },
              { label: 'Blocked', val: exec.blocked || 0, cls: 'orange' },
              { label: 'Skipped', val: exec.skipped || 0, cls: '' },
              { label: 'Pending', val: (tc.total || 0) - totalExec < 0 ? 0 : (tc.total || 0) - totalExec, cls: 'blue' },
            ].map(s => (
              <div key={s.label} className="summary-item">
                <div className={`s-val ${s.cls}`}>{s.val}</div>
                <div className="s-lbl">{s.label}</div>
              </div>
            ))}
          </div>
          {totalExec > 0 && (
            <div className="progress-bar" style={{ marginBottom: 16 }}>
              <div className="bar-pass" style={{ width: `${passRate(exec.passed || 0, totalExec)}%` }} />
              <div className="bar-fail" style={{ width: `${passRate(exec.failed || 0, totalExec)}%` }} />
              <div className="bar-block" style={{ width: `${passRate(exec.blocked || 0, totalExec)}%` }} />
            </div>
          )}

          {/* Test cases by priority */}
          <h2>Test Cases by Priority</h2>
          <table>
            <thead>
              <tr>
                <th>Priority</th><th>Count</th><th>% of Total</th>
              </tr>
            </thead>
            <tbody>
              {[
                { p: 'Critical', v: tc.critical || 0 },
                { p: 'High', v: tc.high || 0 },
                { p: 'Medium', v: tc.medium || 0 },
                { p: 'Low', v: tc.low || 0 },
              ].map(row => (
                <tr key={row.p}>
                  <td><span className={`badge badge-${row.p.toLowerCase()}`}>{row.p}</span></td>
                  <td>{row.v}</td>
                  <td>{tc.total ? Math.round((row.v / tc.total) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* All test runs */}
          <h2>Test Run History</h2>
          <table>
            <thead>
              <tr>
                <th>Run Name</th><th>Status</th><th>Total</th><th>Passed</th><th>Failed</th><th>Blocked</th><th>Pass Rate</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              {(report?.recent_runs || []).map(run => {
                const rpr = passRate(run.passed || 0, run.total || 0);
                return (
                  <tr key={run.id}>
                    <td>{run.name}</td>
                    <td><span className={`badge badge-${run.status}`}>{run.status?.replace('_', ' ')}</span></td>
                    <td>{run.total || 0}</td>
                    <td style={{ color: '#16a34a', fontWeight: 600 }}>{run.passed || 0}</td>
                    <td style={{ color: '#dc2626', fontWeight: 600 }}>{run.failed || 0}</td>
                    <td style={{ color: '#ea580c' }}>{run.blocked || 0}</td>
                    <td style={{ fontWeight: 600, color: rpr >= 80 ? '#16a34a' : rpr >= 50 ? '#d97706' : '#dc2626' }}>{rpr}%</td>
                    <td>{fmtDate(run.created_at)}</td>
                  </tr>
                );
              })}
              {!(report?.recent_runs?.length) && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: '#9ca3af' }}>No test runs yet</td></tr>
              )}
            </tbody>
          </table>

          {/* Suite breakdown */}
          {report?.suite_breakdown?.length > 0 && (
            <>
              <h2>Test Cases by Suite</h2>
              <table>
                <thead><tr><th>Suite</th><th>Total</th><th>Active</th></tr></thead>
                <tbody>
                  {report.suite_breakdown.map(s => (
                    <tr key={s.suite_name}>
                      <td>{s.suite_name}</td>
                      <td>{s.total}</td>
                      <td>{s.active}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="footer">
            <span>QualChek &mdash; Confidential</span>
            <span>Generated {printedAt}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
