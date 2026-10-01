import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AlertCircle, ArrowRight, Check, ShieldCheck } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import QCLogo from '../components/QCLogo';
import { IDLE_MINUTES } from '../hooks/useIdleLogout';

// Two-panel sign-in, following the Facilflow staff portal: a dark Africa
// Prudential panel carrying the story, and a plain white panel carrying the
// form. On phones the dark panel collapses to a compact masthead so the form
// is the first thing in reach.

const POINTS = [
  'Crawl any app and generate its test cases',
  'Record a session and turn clicks into steps',
  'Defects raised straight into Jira, with context',
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [params] = useSearchParams();
  const timedOut = params.get('reason') === 'timeout';
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/projects');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">

      {/* ---------------- left: QualChek, the write-up ------------- */}
      <div className="relative overflow-hidden bg-slate2-deep text-white px-7 py-10 lg:px-14 lg:py-14 flex flex-col">
        {/* 26px dot grid and two brand-red glows, as on the staff portal */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 -right-24 w-[32rem] h-[32rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(25,166,153,0.26) 0%, rgba(0,0,0,0) 70%)' }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-20 w-[24rem] h-[24rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(79,70,229,0.14) 0%, rgba(0,0,0,0) 70%)' }}
        />

        <div className="relative flex items-center gap-3">
          {/* The mark is drawn in currentColor plus one accent, so unlike a
              fixed-colour logo it can sit straight on the dark panel without a
              white tile behind it. */}
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
            Test coverage, discovered
          </p>
          <h1 className="mt-4 text-[2.1rem] lg:text-[2.9rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-balance">
            Tests you<br />never had to write.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/50">
            Point QualChek at a URL and it crawls the application, works out what needs
            testing, and writes the cases for you — then tracks every run and raises
            defects into Jira from one place.
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
          © {new Date().getFullYear()} QualChek · v1.0
        </div>
      </div>

      {/* ---------------- right: the form ---------------------------------- */}
      <div className="flex items-center justify-center px-6 py-12 lg:px-14">
        <div className="w-full max-w-[400px]">
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-slate-900">Welcome back</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Sign in to your QualChek account to continue.
          </p>

          {error && (
            <div className="mt-6 flex items-start gap-2 bg-brand-50 border border-brand-200 text-brand-800 rounded-lg p-3 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {timedOut && !error && (
            <div className="mt-6 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>You were signed out after {IDLE_MINUTES} minutes of inactivity. Please sign in again.</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-[12.5px] font-semibold text-slate-900 mb-1.5">
                Email address
              </label>
              <input
                id="login-email"
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label htmlFor="login-password" className="block text-[12.5px] font-semibold text-slate-900">
                  Password
                </label>
                <Link to="/forgot-password" className="text-[12px] font-semibold text-brand-600 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="login-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold text-white
                         bg-gradient-to-br from-brand-600 to-brand-700 shadow-[0_4px_18px_rgba(232,22,19,0.35)]
                         hover:from-brand-700 hover:to-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500
                         focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {loading ? 'Signing in…' : <>Sign in to QualChek <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <p className="mt-6 text-center text-[13.5px] text-slate-500">
            New to QualChek?{' '}
            <Link to="/request-trial" className="font-semibold text-brand-600 hover:text-brand-700">
              Request a free trial
            </Link>
          </p>

          <p className="mt-8 flex items-start gap-2 text-[11.5px] leading-relaxed text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            <span>
              Access is limited to invited members of your workspace. Sessions are encrypted,
              recorded in the audit trail, and end after {IDLE_MINUTES} minutes of inactivity.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
