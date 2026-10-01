import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { ListChecks, PlayCircle, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import api from '../utils/api';
import { fmtDate, passRate } from '../utils/helpers';

const COLORS = { passed: '#22c55e', failed: '#ef4444', blocked: '#f97316', pending: '#3b82f6', skipped: '#9ca3af' };
const PRIORITY_COLORS = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' };

function StatCard({ label, value, icon, color = 'blue', sub }) {
  const colors = {
    blue: 'bg-brand-50 text-brand-600', green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600', yellow: 'bg-yellow-50 text-yellow-600',
  };
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${colors[color]}`}>{icon}</div>
      </div>
    </div>
  );
}

export default function ProjectDashboard() {
  const { projectId } = useParams();

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
      {[...Array(4)].map((_, i) => <div key={i} className="card h-24 animate-pulse bg-gray-100" />)}
    </div>
  );

  const tc = report?.test_cases || {};
  const runs = report?.runs || {};
  const exec = report?.executions || {};

  const execPieData = [
    { name: 'Passed', value: exec.passed || 0 },
    { name: 'Failed', value: exec.failed || 0 },
    { name: 'Blocked', value: exec.blocked || 0 },
    { name: 'Skipped', value: exec.skipped || 0 },
  ].filter(d => d.value > 0);

  const priorityData = [
    { name: 'Critical', value: tc.critical || 0, fill: PRIORITY_COLORS.critical },
    { name: 'High', value: tc.high || 0, fill: PRIORITY_COLORS.high },
    { name: 'Medium', value: tc.medium || 0, fill: PRIORITY_COLORS.medium },
    { name: 'Low', value: tc.low || 0, fill: PRIORITY_COLORS.low },
  ];

  const totalExec = (exec.passed || 0) + (exec.failed || 0) + (exec.blocked || 0) + (exec.skipped || 0);
  const pr = passRate(exec.passed || 0, totalExec);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{project?.name}</h1>
        <p className="text-gray-500">{project?.description}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Test Cases" value={tc.total || 0} icon={<ListChecks className="w-5 h-5" />} color="blue" />
        <StatCard label="Test Runs" value={runs.total_runs || 0} icon={<PlayCircle className="w-5 h-5" />} color="yellow" />
        <StatCard label="Pass Rate" value={`${pr}%`} icon={<CheckCircle className="w-5 h-5" />} color="green"
          sub={`${exec.passed || 0} of ${totalExec} executed`} />
        <StatCard label="Failed" value={exec.failed || 0} icon={<XCircle className="w-5 h-5" />} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Execution Results</h2>
          {totalExec === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">No executions yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={execPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                  {execPieData.map(entry => (
                    <Cell key={entry.name} fill={COLORS[entry.name.toLowerCase()]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Cases by Priority</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={priorityData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="value" name="Cases">
                {priorityData.map(entry => <Cell key={entry.name} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Pass Rate Trend</h2>
          {(!report?.pass_rate_trend?.length) ? (
            <div className="text-center text-gray-400 py-8 text-sm">No completed runs yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={report.pass_rate_trend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" fontSize={10} tick={false} />
                <YAxis domain={[0, 100]} fontSize={11} />
                <Tooltip formatter={v => `${v}%`} />
                <Line type="monotone" dataKey="pass_rate" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Recent Test Runs</h2>
          <Link to={`/projects/${projectId}/runs`} className="text-sm text-brand-600 hover:underline">View all</Link>
        </div>
        {!report?.recent_runs?.length ? (
          <p className="text-gray-400 text-sm">No test runs yet. <Link to={`/projects/${projectId}/runs`} className="text-brand-600 hover:underline">Create one</Link></p>
        ) : (
          <div className="space-y-2">
            {report.recent_runs.map(run => {
              const total = run.total || 0;
              const pr = passRate(run.passed || 0, total);
              return (
                <Link key={run.id} to={`/projects/${projectId}/runs/${run.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className={`w-2 h-2 rounded-full ${run.status === 'completed' ? 'bg-green-500' : run.status === 'in_progress' ? 'bg-brand-500' : 'bg-gray-400'}`} />
                  <span className="flex-1 text-sm font-medium text-gray-900">{run.name}</span>
                  <span className="text-xs text-gray-500">{total} cases</span>
                  <span className={`text-xs font-medium ${pr >= 80 ? 'text-green-600' : pr >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {pr}% pass
                  </span>
                  <span className="text-xs text-gray-400">{fmtDate(run.created_at)}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
