import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { ScrollText, Search, AlertCircle, Shield, User, Trash2, LogIn, Mail, FolderKanban } from 'lucide-react';
import api from '../utils/api';
import { useRole } from '../hooks/useRole';
import { fmtDateTime } from '../utils/helpers';

// Colour by severity of the action rather than by entity, so the destructive
// and permission-related entries stand out when scanning a long list.
const ACTION_STYLE = {
  'user.deleted':              'bg-red-100 text-red-700',
  'test_case.deleted':         'bg-red-100 text-red-700',
  'test_case.bulk_deleted':    'bg-red-100 text-red-700',
  'test_run.deleted':          'bg-red-100 text-red-700',
  'suite.deleted':             'bg-red-100 text-red-700',
  'project.deleted':           'bg-red-100 text-red-700',
  'user.deactivated':          'bg-amber-100 text-amber-700',
  'auth.login_failed':         'bg-amber-100 text-amber-700',
  'user.super_admin_granted':  'bg-pass-50 text-pass-500',
  'user.super_admin_revoked':  'bg-pass-50 text-pass-500',
  'user.created':              'bg-green-100 text-green-700',
  'project.created':           'bg-green-100 text-green-700',
  'user.activated':            'bg-green-100 text-green-700',
  'invite.redeemed':           'bg-green-100 text-green-700',
};

function iconFor(action) {
  if (action.startsWith('auth.')) return LogIn;
  if (action.startsWith('invite.')) return Mail;
  if (action.startsWith('project.')) return FolderKanban;
  if (action.includes('super_admin')) return Shield;
  if (action.includes('deleted')) return Trash2;
  return User;
}

// "user.super_admin_granted" -> "super admin granted"
const label = a => a.split('.').slice(1).join(' ').replace(/_/g, ' ');

export default function AuditLogPage() {
  const { isAdmin } = useRole();
  if (!isAdmin) return <Navigate to="/projects" replace />;

  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(100);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', action, query, limit],
    queryFn: () =>
      api
        .get('/auth/audit', { params: { action: action || undefined, q: query || undefined, limit } })
        .then(r => r.data),
    placeholderData: keepPreviousData,
  });

  const entries = data?.entries || [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center flex-shrink-0">
          <ScrollText className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-gray-500">
            {data ? `${data.total} recorded event(s)` : 'Loading...'}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <form
          className="relative flex-1"
          onSubmit={e => { e.preventDefault(); setQuery(search.trim()); }}
        >
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="input pl-9"
            placeholder="Search by person or target, then press Enter"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </form>
        <select className="input sm:w-64" value={action} onChange={e => setAction(e.target.value)}>
          <option value="">All actions</option>
          {(data?.actions || []).map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {isError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />Could not load the audit log.
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="divide-y">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-4 animate-pulse">
                <div className="h-3.5 bg-gray-200 rounded w-64 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-40" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="p-8 text-center text-gray-400 text-sm">No events match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left p-3 font-medium text-gray-600 whitespace-nowrap">When</th>
                  <th className="text-left p-3 font-medium text-gray-600">Who</th>
                  <th className="text-left p-3 font-medium text-gray-600">Action</th>
                  <th className="text-left p-3 font-medium text-gray-600">Target</th>
                  <th className="text-left p-3 font-medium text-gray-600">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map(e => {
                  const Icon = iconFor(e.action);
                  return (
                    <tr key={e.id} className="hover:bg-gray-50 align-top">
                      <td className="p-3 text-gray-500 whitespace-nowrap">{fmtDateTime(e.at)}</td>
                      <td className="p-3">
                        <div className="font-medium text-gray-800">{e.actor_name || '—'}</div>
                        {e.actor_email && <div className="text-xs text-gray-400">{e.actor_email}</div>}
                      </td>
                      <td className="p-3">
                        <span className={`badge ${ACTION_STYLE[e.action] || 'bg-gray-100 text-gray-600'} flex items-center gap-1 w-fit whitespace-nowrap`}>
                          <Icon className="w-3 h-3" />{label(e.action)}
                        </span>
                      </td>
                      <td className="p-3 text-gray-700 break-all">{e.target_label || '—'}</td>
                      <td className="p-3 text-xs text-gray-500">
                        {e.detail ? <Detail detail={e.detail} /> : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && entries.length >= limit && (
        <div className="mt-4 text-center">
          <button onClick={() => setLimit(l => l + 100)} className="btn-secondary">
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

// Renders the JSON detail readably — field changes as "role: tester → admin",
// everything else as compact key/value pairs.
function Detail({ detail }) {
  const { changes, ...rest } = detail;
  return (
    <div className="space-y-0.5">
      {changes &&
        Object.entries(changes).map(([field, c]) => (
          <div key={field}>
            <span className="text-gray-600">{field}:</span>{' '}
            <span className="line-through text-gray-400">{String(c.from ?? '—')}</span>{' '}
            → <span className="text-gray-800">{String(c.to ?? '—')}</span>
          </div>
        ))}
      {Object.entries(rest)
        .filter(([, v]) => v !== null && v !== undefined && v !== false)
        .map(([k, v]) => (
          <div key={k}>
            <span className="text-gray-600">{k}:</span>{' '}
            {Array.isArray(v) ? v.join(', ') : String(v)}
          </div>
        ))}
    </div>
  );
}
