import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import api from '../utils/api';
import { setToken } from '../utils/token';
import { useAuth } from '../context/AuthContext';
import QCLogo from '../components/QCLogo';
import PasswordInput from '../components/PasswordInput';

const POINTS = [
  'Crawl any app and generate its test cases',
  'Record a session and turn clicks into steps',
  'Defects raised straight into Jira, with context',
];

export default function SignupPage() {
  const [form, setForm] = useState({ workspace: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { adoptSession } = useAuth();

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/signup', form, { withCredentials: true });
      // Signup returns a session, so there is no second sign-in step.
      setToken(data.token);
      adoptSession(data.user);
      navigate('/projects');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create your workspace. Try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-white">
      {/* ---------------- left: the pitch ---------------------------------- */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-slate2-deep px-12 py-12 text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '26px 26px' }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 -right-24 w-[32rem] h-[32rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(25,166,153,0.26) 0%, rgba(0,0,0,0) 70%)' }}
        />

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
            14 days free &middot; no card required
          </p>
          <h1 className="mt-4 font-display text-[2.1rem] lg:text-[2.9rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-balance">
            Start with tests<br />you didn&rsquo;t write.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/50">
            Create a workspace, point QualChek at your application, and it comes back with
            the test cases. Keep everything it finds, whether you subscribe or not.
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
        </div>

        <div className="relative mt-12 lg:mt-14 text-[11px] text-white/30">
          © {new Date().getFullYear()} QualChek
        </div>
      </div>

      {/* ---------------- right: the form ---------------------------------- */}
      <div className="flex items-center justify-center px-6 py-12 lg:px-14">
        <div className="w-full max-w-[400px]">
          <h2 className="font-display text-[26px] font-extrabold tracking-[-0.03em] text-slate-900">
            Create your workspace
          </h2>
          <p className="mt-1.5 text-[14px] text-slate-500">
            Free for 14 days. No card, no sales call.
          </p>

          {error && (
            <div className="mt-6 rounded-lg border border-fail-500/30 bg-fail-50 px-3.5 py-3 text-[13.5px] text-fail-500">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <label htmlFor="workspace" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Workspace name
              </label>
              <input
                id="workspace" className="input" required autoFocus
                placeholder="Acme QA" value={form.workspace} onChange={set('workspace')}
              />
              <p className="mt-1 text-[11.5px] text-slate-400">Usually your company or team name.</p>
            </div>

            <div>
              <label htmlFor="name" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Your name
              </label>
              <input id="name" className="input" required value={form.name} onChange={set('name')} />
            </div>

            <div>
              <label htmlFor="email" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Work email
              </label>
              <input id="email" type="email" className="input" required
                     value={form.email} onChange={set('email')} />
            </div>

            <div>
              <label htmlFor="password" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <PasswordInput id="password" required minLength={8}
                             value={form.password} onChange={set('password')} />
              <p className="mt-1 text-[11.5px] text-slate-400">At least 8 characters.</p>
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 px-4 py-3 text-[15px] font-semibold text-white transition-colors"
            >
              {loading ? 'Creating your workspace…' : <>Start free trial <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <p className="mt-6 text-center text-[13.5px] text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">Sign in</Link>
          </p>

          <p className="mt-8 flex items-start gap-2 text-[11.5px] leading-relaxed text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            <span>
              Your workspace is isolated from every other. When the trial ends nothing is
              deleted — the workspace becomes read-only until you choose a plan.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
