import { useState, useEffect, useCallback } from 'react';
import { Check, X, Clock, Building2, Mail, Phone, LogOut, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import QCLogo from '../components/QCLogo';
import PasswordInput from '../components/PasswordInput';

// Deliberately its own axios instance, not the app's `api`.
//
// The app's client attaches the tenant access token and, on a 401, tries to
// refresh and then bounces to /login. An operator has neither a tenant token
// nor a refresh cookie, so sharing the client would send the wrong credential
// and redirect operators into the customer sign-in page.
const platform = axios.create({ baseURL: (import.meta.env.VITE_API_URL || '/api') + '/platform' });

const KEY = 'qc_platform_token';
const readToken = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const writeToken = t => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } };

platform.interceptors.request.use(c => {
  const t = readToken();
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

const when = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? String(iso).slice(0, 16) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

function Login({ onIn }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const { data } = await platform.post('/login', form);
      writeToken(data.token);
      onIn(data.operator);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not sign in');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate2-deep px-6">
      <div className="w-full max-w-[360px]">
        <div className="flex items-center gap-3 text-white/85">
          <div className="w-10 h-10 rounded-[11px] bg-white/10 border border-white/15 flex items-center justify-center">
            <QCLogo className="w-[24px] h-[24px]" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-bold">QualChek</div>
            <div className="text-[11px] text-white/45">Operator console</div>
          </div>
        </div>

        <h1 className="mt-9 font-display text-[22px] font-extrabold tracking-[-0.02em] text-white">
          Sign in to review requests
        </h1>

        {error && (
          <div className="mt-5 rounded-lg border border-fail-500/30 bg-fail-500/10 px-3.5 py-2.5 text-[13px] text-fail-500">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-3.5">
          <input className="input bg-white/5 border-white/15 text-white placeholder:text-white/30"
                 type="email" required placeholder="you@qualchek.com"
                 value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <PasswordInput required placeholder="Password"
                         className="input bg-white/5 border-white/15 text-white placeholder:text-white/30"
                         value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          <button type="submit" disabled={busy}
                  className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 px-4 py-2.5 text-[14.5px] font-semibold text-white transition-colors">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-[11.5px] leading-relaxed text-white/30">
          This console is for QualChek staff. It is separate from customer sign-in — a
          workspace account cannot open it.
        </p>
      </div>
    </div>
  );
}

function RequestCard({ r, onDecided }) {
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [err, setErr] = useState('');

  const act = async (what, body) => {
    setBusy(what); setErr('');
    try {
      const { data } = await platform.post(`/requests/${r.id}/${what}`, body || {});
      // The decision succeeded whatever the mail did, but an operator who is
      // not told the applicant never heard will assume they did - and the
      // applicant waits for an email that is not coming.
      onDecided({ ...data, what, email: r.email });
    } catch (e) {
      setErr(e.response?.data?.error || 'That did not work');
      setBusy('');
    }
  };

  const pending = r.status === 'pending';
  const tone = r.status === 'approved' ? 'bg-pass-50 text-pass-500'
    : r.status === 'rejected' ? 'bg-fail-50 text-fail-500'
    : 'bg-warn-50 text-warn-500';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <h3 className="font-display text-[16px] font-bold text-slate-900 truncate">{r.workspace_name}</h3>
            <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${tone}`}>
              {r.status}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate-600">
            <span>{r.contact_name}</span>
            <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-slate-400" />{r.email}</span>
            {r.phone && <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-slate-400" />{r.phone}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-slate-400">
            <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{when(r.submitted_at)}</span>
            {r.plan_code && <span>plan: <span className="font-semibold text-slate-600">{r.plan_code}</span></span>}
            {r.company_size && <span>team size: {r.company_size}</span>}
          </div>
          {r.note && <p className="mt-2.5 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">{r.note}</p>}
          {r.decision_reason && (
            <p className="mt-2.5 text-[12.5px] text-slate-500">
              Reason: <span className="text-slate-700">{r.decision_reason}</span>
            </p>
          )}
          {r.reviewer_name && (
            <p className="mt-1.5 text-[12px] text-slate-400">
              {r.status} by {r.reviewer_name} &middot; {when(r.reviewed_at)}
            </p>
          )}
        </div>

        {pending && !rejecting && (
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => act('approve')} disabled={!!busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 px-3 py-2 text-[13px] font-semibold text-white transition-colors">
              <Check className="w-4 h-4" />{busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button onClick={() => setRejecting(true)} disabled={!!busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 hover:border-slate-300 px-3 py-2 text-[13px] font-semibold text-slate-600 transition-colors">
              <X className="w-4 h-4" />Decline
            </button>
          </div>
        )}
      </div>

      {rejecting && (
        <div className="mt-3 flex gap-2">
          <input className="input flex-1" autoFocus placeholder="Reason (kept internal)"
                 value={reason} onChange={e => setReason(e.target.value)} />
          <button onClick={() => act('reject', { reason })} disabled={!!busy}
                  className="rounded-lg bg-fail-500 hover:opacity-90 disabled:opacity-60 px-3 py-2 text-[13px] font-semibold text-white">
            {busy === 'reject' ? 'Declining…' : 'Confirm'}
          </button>
          <button onClick={() => { setRejecting(false); setReason(''); }}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-600">
            Cancel
          </button>
        </div>
      )}

      {err && <p className="mt-2 text-[12.5px] text-fail-500">{err}</p>}
    </div>
  );
}

export default function PlatformConsole() {
  const [operator, setOperator] = useState(null);
  const [checking, setChecking] = useState(true);
  const [data, setData] = useState({ requests: [], counts: {} });
  const [filter, setFilter] = useState('pending');

  useEffect(() => {
    if (!readToken()) { setChecking(false); return; }
    platform.get('/me')
      .then(r => setOperator(r.data))
      .catch(() => writeToken(null))
      .finally(() => setChecking(false));
  }, []);

  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    platform.get('/requests', { params: filter === 'all' ? {} : { status: filter } })
      .then(r => setData(r.data))
      .catch(() => {});
  }, [filter]);

  useEffect(() => { if (operator) load(); }, [operator, load]);

  const onDecided = outcome => {
    load();
    if (outcome && outcome.email_delivered === false) setNotice(outcome);
    else setNotice(null);
  };

  if (checking) return <div className="min-h-screen bg-slate-50" />;
  if (!operator) return <Login onIn={setOperator} />;

  const counts = data.counts || {};
  const tabs = [
    ['pending', 'Pending', counts.pending],
    ['approved', 'Approved', counts.approved],
    ['rejected', 'Declined', counts.rejected],
    ['all', 'All', null],
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3.5">
          <div className="w-9 h-9 rounded-[10px] bg-slate2-deep flex items-center justify-center text-white">
            <QCLogo className="w-[21px] h-[21px]" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-bold text-slate-900">QualChek</div>
            <div className="text-[11px] text-slate-400">Operator console</div>
          </div>
          <div className="ml-auto flex items-center gap-3 text-[13px] text-slate-500">
            {operator.name}
            <button onClick={() => { writeToken(null); setOperator(null); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:border-slate-300">
              <LogOut className="w-3.5 h-3.5" />Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-7">
        <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-slate-900">Trial requests</h1>
        <p className="mt-1 text-[13.5px] text-slate-500">
          Approving provisions the workspace, its first admin, and a 14-day trial.
        </p>

        {notice && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-warn-500/30 bg-warn-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warn-500" />
            <div className="text-[13.5px] leading-relaxed">
              <p className="font-semibold text-warn-500">
                {notice.what === 'approve' ? 'Workspace created, but no email was sent' : 'Declined, but no email was sent'}
              </p>
              <p className="mt-0.5 text-ink-600">
                {notice.email_reason === 'not_configured'
                  ? 'No mail provider is configured on this deployment, so nothing was delivered.'
                  : `Sending failed: ${notice.email_reason || 'unknown reason'}.`}{' '}
                Tell <span className="font-semibold">{notice.email}</span> by hand
                {notice.what === 'approve' ? ' — they can sign in now with the password they chose.' : '.'}
              </p>
            </div>
            <button onClick={() => setNotice(null)} className="ml-auto text-ink-400 hover:text-ink-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="mt-5 flex gap-1.5">
          {tabs.map(([key, label, n]) => (
            <button key={key} onClick={() => setFilter(key)}
                    className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                      filter === key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>
              {label}{n != null && Number(n) > 0 && <span className="ml-1.5 opacity-60">{n}</span>}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {data.requests.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
              <p className="text-[14px] font-semibold text-slate-700">Nothing here</p>
              <p className="mt-1 text-[13px] text-slate-400">
                {filter === 'pending' ? 'No requests are waiting for a decision.' : 'No requests match this filter.'}
              </p>
            </div>
          )}
          {data.requests.map(r => <RequestCard key={r.id} r={r} onDecided={onDecided} />)}
        </div>
      </main>
    </div>
  );
}
