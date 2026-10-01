import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import api from '../utils/api';
import QCLogo from '../components/QCLogo';
import PasswordInput from '../components/PasswordInput';

const POINTS = [
  'Crawl any app and generate its test cases',
  'Record a session and turn clicks into steps',
  'Automated runs reported straight from your pipeline',
  'Defects raised straight into Jira, with context',
];

const money = p => `$${(p.price_monthly_cents / 100).toFixed(0)}`;

export default function RequestTrialPage() {
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState({
    workspace: '', name: '', email: '', phone: '',
    company_size: '', plan_code: '', note: '', password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api.get('/trial-request/plans')
      .then(r => {
        setPlans(r.data);
        // Preselect the middle option rather than the cheapest: it is the one
        // most teams land on, and an empty required field is friction.
        if (r.data.length) setForm(f => ({ ...f, plan_code: r.data[Math.floor(r.data.length / 2)].code }));
      })
      .catch(() => setPlans([]));
  }, []);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/trial-request', form);
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send your request. Try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-white">
      {/* ---------------- left: the pitch ---------------------------------- */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-slate2-deep px-12 py-12 text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07]"
             style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
        <div aria-hidden="true" className="pointer-events-none absolute -top-28 -right-24 w-[32rem] h-[32rem] rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(25,166,153,0.26) 0%, rgba(0,0,0,0) 70%)' }} />

        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-[11px] bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0 text-white/85">
            <QCLogo className="w-[24px] h-[24px]" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[16px] font-bold tracking-[-0.02em]">QualChek</div>
            <div className="text-[11px] text-white/45">Quality, checked</div>
          </div>
        </div>

        <div className="relative mt-12 lg:mt-auto lg:pt-16">
          <p className="text-[11px] font-bold tracking-[0.16em] text-brand-400 uppercase">
            14-day trial &middot; no card required
          </p>
          <h1 className="mt-4 font-display text-[2.1rem] lg:text-[2.9rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-balance">
            Start with tests<br />you didn&rsquo;t write.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/50">
            Point QualChek at your application and it comes back with the test cases.
            Your pipeline pushes results back on every build, so one record covers
            manual and automated runs alike.
          </p>

          <ul className="mt-8 space-y-3">
            {POINTS.map(point => (
              <li key={point} className="flex items-start gap-3 text-[14px] text-white/70">
                <span className="mt-0.5 w-[18px] h-[18px] rounded-full bg-brand-600/15 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-brand-400" />
                </span>
                {point}
              </li>
            ))}
          </ul>

          {plans.length > 0 && (
            <div className="mt-10 flex gap-2">
              {plans.map(p => (
                <div key={p.code} className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <div className="font-display text-[17px] font-bold">{money(p)}<span className="text-[11px] font-normal text-white/40">/mo</span></div>
                  <div className="text-[11px] text-white/45">up to {p.max_users} people</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="relative mt-12 lg:mt-14 text-[11px] text-white/30">
          © {new Date().getFullYear()} QualChek
        </div>
      </div>

      {/* ---------------- right: the form or the confirmation --------------- */}
      <div className="flex items-center justify-center px-6 py-12 lg:px-14">
        <div className="w-full max-w-[420px]">
          {sent ? (
            <div>
              <div className="w-12 h-12 rounded-full bg-pass-50 border border-pass-500/25 flex items-center justify-center">
                <Check className="w-6 h-6 text-pass-500" />
              </div>
              <h2 className="mt-5 font-display text-[26px] font-extrabold tracking-[-0.03em] text-slate-900">
                Request received
              </h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-slate-600">
                Thanks — we have your details. A member of the QualChek team reviews each
                request, and you&rsquo;ll get an email at <span className="font-semibold text-slate-800">{form.email}</span>{' '}
                once your workspace is ready.
              </p>
              <p className="mt-3 text-[14.5px] leading-relaxed text-slate-600">
                You&rsquo;ll sign in with the password you just chose — there&rsquo;s nothing
                else to set up.
              </p>
              <Link to="/login" className="mt-7 inline-flex items-center gap-2 text-[14px] font-semibold text-brand-600 hover:text-brand-700">
                Go to sign in <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <>
              <h2 className="font-display text-[26px] font-extrabold tracking-[-0.03em] text-slate-900">
                Request a trial
              </h2>
              <p className="mt-1.5 text-[14px] text-slate-500">
                14 days free. We review each request and set your workspace up for you.
              </p>

              {error && (
                <div className="mt-6 rounded-lg border border-fail-500/30 bg-fail-50 px-3.5 py-3 text-[13.5px] text-fail-500">
                  {error}
                </div>
              )}

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="workspace" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                    Company or team name
                  </label>
                  <input id="workspace" className="input" required autoFocus
                         placeholder="Acme QA" value={form.workspace} onChange={set('workspace')} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="name" className="block text-[13px] font-semibold text-slate-700 mb-1.5">Your name</label>
                    <input id="name" className="input" required value={form.name} onChange={set('name')} />
                  </div>
                  <div>
                    <label htmlFor="phone" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                      Phone <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <input id="phone" className="input" value={form.phone} onChange={set('phone')} />
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="block text-[13px] font-semibold text-slate-700 mb-1.5">Work email</label>
                  <input id="email" type="email" className="input" required value={form.email} onChange={set('email')} />
                </div>

                <div>
                  <span className="block text-[13px] font-semibold text-slate-700 mb-1.5">Team size</span>
                  <div className="grid grid-cols-3 gap-2">
                    {plans.map(p => (
                      <button
                        key={p.code} type="button"
                        onClick={() => setForm(f => ({ ...f, plan_code: p.code }))}
                        aria-pressed={form.plan_code === p.code}
                        className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                          form.plan_code === p.code
                            ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <span className="block font-display text-[16px] font-bold text-slate-900">{money(p)}
                          <span className="text-[11px] font-normal text-slate-400">/mo</span>
                        </span>
                        <span className="block text-[11.5px] text-slate-500">up to {p.max_users}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11.5px] text-slate-400">Billing starts only if you continue after the trial.</p>
                </div>

                <div>
                  <label htmlFor="password" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                    Choose a password
                  </label>
                  <PasswordInput id="password" required minLength={8}
                                 value={form.password} onChange={set('password')} />
                  <p className="mt-1 text-[11.5px] text-slate-400">
                    At least 8 characters. You&rsquo;ll use this to sign in once approved.
                  </p>
                </div>

                <div>
                  <label htmlFor="note" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                    Anything we should know? <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <textarea id="note" rows={2} className="input resize-none"
                            value={form.note} onChange={set('note')} />
                </div>

                <button type="submit" disabled={loading}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 px-4 py-3 text-[15px] font-semibold text-white transition-colors">
                  {loading ? 'Sending…' : <>Request my trial <ArrowRight className="w-4 h-4" /></>}
                </button>
              </form>

              <p className="mt-6 text-center text-[13.5px] text-slate-500">
                Already approved?{' '}
                <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">Sign in</Link>
              </p>

              <p className="mt-7 flex items-start gap-2 text-[11.5px] leading-relaxed text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                <span>
                  Each workspace is isolated at the database level. When a trial ends nothing is
                  deleted — the workspace becomes read-only until you choose a plan.
                </span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
