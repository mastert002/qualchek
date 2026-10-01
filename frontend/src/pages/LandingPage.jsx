import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Check, Globe, MousePointerClick, GitBranch, Bug,
  ShieldCheck, Menu, X,
} from 'lucide-react';
import api from '../utils/api';
import QCLogo from '../components/QCLogo';

// Shown if the API is unreachable - a marketing page that renders a blank
// pricing section because the backend is down is worse than one showing the
// list prices, which do not change often.
const FALLBACK_PLANS = [
  { code: 'team3', name: 'Team of 3', max_users: 3, price_monthly_cents: 1000 },
  { code: 'team5', name: 'Team of 5', max_users: 5, price_monthly_cents: 1500 },
  { code: 'team8', name: 'Team of 8', max_users: 8, price_monthly_cents: 2000 },
];

const CAPABILITIES = [
  {
    icon: Globe,
    title: 'It writes the test cases',
    body: 'Give QualChek a URL. It drives a real browser through the application, '
        + 'works out what each page needs tested from what it finds there, and writes '
        + 'the cases with steps and expected results. Re-crawl later and it adds only what is new.',
  },
  {
    icon: MousePointerClick,
    title: 'Record instead of writing',
    body: 'Open a session, click through the thing you want covered, and QualChek turns '
        + 'what you did into a test case. Useful for the flows a crawler cannot reach on '
        + 'its own, like anything behind a multi-step form.',
  },
  {
    icon: GitBranch,
    title: 'Your pipeline reports in',
    body: 'Automated runs push their results back on every build, against the same test '
        + 'cases your manual runs use. One record, one pass rate — rather than a dashboard '
        + 'for the robots and a spreadsheet for everyone else.',
  },
  {
    icon: Bug,
    title: 'Defects go to Jira',
    body: 'Raise an issue from a failed result and it arrives in Jira with the test case, '
        + 'the steps and the run attached. Comments written in either place show up in the other.',
  },
];

const STEPS = [
  ['Point it at your app', 'A URL, and a login if the app needs one. Nothing to install.'],
  ['Review what it found', 'Generated cases land in their own suite. Keep what is useful, bin the rest.'],
  ['Run them, or let CI', 'Execute by hand, or have your pipeline report results against the same cases.'],
];

const money = p => `$${(p.price_monthly_cents / 100).toFixed(0)}`;

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate2-deep/90 backdrop-blur"
            style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2.5 text-white">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-white/15 bg-white/10">
            <QCLogo className="h-[21px] w-[21px]" />
          </div>
          <span className="font-display text-[16px] font-bold tracking-[-0.02em]">QualChek</span>
        </Link>

        <nav className="ml-6 hidden items-center gap-6 text-[13.5px] text-white/60 md:flex">
          <a href="#what" className="hover:text-white">What it does</a>
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="#pricing" className="hover:text-white">Pricing</a>
        </nav>

        <div className="ml-auto hidden items-center gap-2.5 md:flex">
          <Link to="/login" className="px-3 py-2 text-[13.5px] font-semibold text-white/70 hover:text-white">
            Sign in
          </Link>
          <Link to="/request-trial"
                className="rounded-lg bg-brand-600 px-3.5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700">
            Request a trial
          </Link>
        </div>

        <button onClick={() => setOpen(o => !o)} aria-label="Menu"
                className="ml-auto text-white/70 md:hidden">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 px-5 py-3 md:hidden">
          <div className="flex flex-col gap-1 text-[14px]">
            <a href="#what" onClick={() => setOpen(false)} className="py-2 text-white/70">What it does</a>
            <a href="#how" onClick={() => setOpen(false)} className="py-2 text-white/70">How it works</a>
            <a href="#pricing" onClick={() => setOpen(false)} className="py-2 text-white/70">Pricing</a>
            <Link to="/login" className="py-2 text-white/70">Sign in</Link>
            <Link to="/request-trial"
                  className="mt-2 rounded-lg bg-brand-600 px-3.5 py-2.5 text-center font-semibold text-white">
              Request a trial
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * A URL going in and test cases coming out.
 *
 * Drawn rather than screenshotted on purpose: a screenshot of an empty demo
 * workspace says nothing, and a staged one would be showing work that was never
 * done. This shows the mechanism, which is what is actually being sold.
 */
function CrawlDiagram() {
  return (
    <svg viewBox="0 0 420 300" role="img" className="w-full max-w-[420px]"
         aria-label="A URL is crawled across several pages, and each page produces test cases.">
      <defs>
        <marker id="lp-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#38c2b2" />
        </marker>
      </defs>

      {/* the address bar */}
      <rect x="14" y="16" width="392" height="34" rx="9" fill="#ffffff" fillOpacity="0.06"
            stroke="#ffffff" strokeOpacity="0.14" />
      <circle cx="33" cy="33" r="4" fill="#38c2b2" />
      <text x="48" y="37" fontSize="12.5" fill="#ffffff" fillOpacity="0.75"
            fontFamily="ui-monospace, monospace">https://your-app.com</text>

      {/* pages discovered */}
      {[0, 1, 2].map(i => (
        <g key={i}>
          <rect x="14" y={76 + i * 52} width="150" height="40" rx="8"
                fill="#ffffff" fillOpacity="0.05" stroke="#ffffff" strokeOpacity="0.12" />
          <rect x="28" y={89 + i * 52} width={92 - i * 18} height="5" rx="2.5"
                fill="#ffffff" fillOpacity="0.3" />
          <rect x="28" y={100 + i * 52} width={64 - i * 10} height="5" rx="2.5"
                fill="#ffffff" fillOpacity="0.16" />
          <path d={`M 164 ${96 + i * 52} L 236 ${96 + i * 52}`} stroke="#38c2b2"
                strokeWidth="1.4" markerEnd="url(#lp-arrow)" />
        </g>
      ))}
      <path d="M 56 50 L 56 76" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="1.3" />
      <path d="M 56 128 L 56 180" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="1.3" />

      {/* generated cases */}
      <rect x="244" y="68" width="162" height="190" rx="10" fill="#38c2b2" fillOpacity="0.08"
            stroke="#38c2b2" strokeOpacity="0.3" />
      <text x="260" y="90" fontSize="10.5" letterSpacing="1.3" fill="#38c2b2">GENERATED CASES</text>
      {[0, 1, 2, 3].map(i => (
        <g key={i}>
          <circle cx="266" cy={114 + i * 34} r="7" fill="none" stroke="#38c2b2" strokeWidth="1.4" />
          <path d={`M 262.5 ${114 + i * 34} l 2.5 2.5 l 4.5 -5`} stroke="#38c2b2"
                strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="282" y={109 + i * 34} width={108 - (i % 3) * 20} height="5" rx="2.5"
                fill="#ffffff" fillOpacity="0.4" />
          <rect x="282" y={120 + i * 34} width={72 - (i % 2) * 18} height="5" rx="2.5"
                fill="#ffffff" fillOpacity="0.18" />
        </g>
      ))}
    </svg>
  );
}

export default function LandingPage() {
  const [plans, setPlans] = useState(FALLBACK_PLANS);

  useEffect(() => {
    api.get('/trial-request/plans')
      .then(r => { if (Array.isArray(r.data) && r.data.length) setPlans(r.data); })
      .catch(() => { /* the fallback is already rendered */ });
  }, []);

  return (
    <div className="bg-white">
      <Nav />

      {/* ---------------- hero ------------------------------------------- */}
      <section className="relative overflow-hidden bg-slate2-deep text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07]"
             style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[40rem] w-[40rem] rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(25,166,153,0.22) 0%, rgba(0,0,0,0) 70%)' }} />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <div>
            <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brand-400">
              Test management
            </p>
            <h1 className="mt-4 font-display text-[2.4rem] font-extrabold leading-[1.06] tracking-[-0.035em] text-balance sm:text-[3.2rem]">
              Tests you never<br />had to write.
            </h1>
            <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-white/60">
              Every other test management tool stores the cases you already wrote.
              QualChek writes them — point it at your application and it comes back
              with the test cases, then tracks every run, manual or automated, in
              one record.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/request-trial"
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-brand-700">
                Request a 14-day trial <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/login"
                    className="rounded-lg border border-white/20 px-5 py-3 text-[15px] font-semibold text-white/80 transition-colors hover:border-white/35 hover:text-white">
                Sign in
              </Link>
            </div>
            <p className="mt-4 text-[12.5px] text-white/35">
              No card. We review each request and set your workspace up for you.
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <CrawlDiagram />
          </div>
        </div>
      </section>

      {/* ---------------- what it does ------------------------------------ */}
      <section id="what" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <h2 className="font-display text-[1.9rem] font-extrabold tracking-[-0.03em] text-slate-900 text-balance sm:text-[2.3rem]">
          Four things, and the first one is the point
        </h2>
        <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-slate-500">
          Writing test cases is the part nobody has time for, which is why coverage is
          usually thinner than anyone admits. QualChek starts by doing that part.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {CAPABILITIES.map(({ icon: Icon, title, body }, i) => (
            <div key={title}
                 className={`rounded-xl border p-6 ${i === 0 ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200 bg-white'}`}>
              <div className={`flex h-10 w-10 items-center justify-center rounded-[11px] ${i === 0 ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-[17px] font-bold tracking-[-0.01em] text-slate-900">{title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- how it works ------------------------------------ */}
      <section id="how" className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <h2 className="font-display text-[1.9rem] font-extrabold tracking-[-0.03em] text-slate-900">
            How it works
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <div key={title}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 font-display text-[13px] font-bold text-white">
                  {i + 1}
                </div>
                <h3 className="mt-4 font-display text-[16px] font-bold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- pricing ----------------------------------------- */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <h2 className="font-display text-[1.9rem] font-extrabold tracking-[-0.03em] text-slate-900 sm:text-[2.3rem]">
          Priced by team size, not per seat
        </h2>
        <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-slate-500">
          A flat monthly fee for a cap on people. Adding the tester who was going to use
          it anyway should not change your bill.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {plans.map((p, i) => (
            <div key={p.code}
                 className={`relative rounded-xl border p-6 ${i === 1 ? 'border-brand-600 ring-1 ring-brand-600' : 'border-slate-200'}`}>
              {i === 1 && (
                <span className="absolute -top-2.5 left-6 rounded bg-brand-600 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white">
                  Most chosen
                </span>
              )}
              <h3 className="font-display text-[15px] font-bold text-slate-900">{p.name}</h3>
              <p className="mt-3 font-display text-[2.3rem] font-extrabold leading-none tracking-[-0.03em] text-slate-900">
                {money(p)}<span className="text-[14px] font-medium text-slate-400">/month</span>
              </p>
              <p className="mt-2 text-[13.5px] text-slate-500">Up to {p.max_users} people</p>

              <ul className="mt-5 space-y-2.5 border-t border-slate-100 pt-5">
                {['Unlimited projects and test cases', 'Crawler and session recording',
                  'CI reporting and Jira integration', 'Everything in QualChek'].map(f => (
                  <li key={f} className="flex items-start gap-2 text-[13.5px] text-slate-600">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-600" />{f}
                  </li>
                ))}
              </ul>

              <Link to="/request-trial"
                    className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-[14px] font-semibold transition-colors ${
                      i === 1 ? 'bg-brand-600 text-white hover:bg-brand-700'
                              : 'border border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                Start a trial
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[13px] text-slate-400">
          Every plan includes the whole product — the tiers differ only in how many people
          can use it. A trial runs 14 days with no card; when it ends the workspace becomes
          read-only rather than disappearing.
        </p>
      </section>

      {/* ---------------- closing CTA ------------------------------------- */}
      <section className="relative overflow-hidden bg-slate2-deep">
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-24 h-[28rem] w-[28rem] rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(25,166,153,0.2) 0%, rgba(0,0,0,0) 70%)' }} />
        <div className="relative mx-auto max-w-3xl px-5 py-16 text-center lg:py-20">
          <h2 className="font-display text-[1.9rem] font-extrabold leading-tight tracking-[-0.03em] text-white text-balance sm:text-[2.3rem]">
            See what it finds in your app
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15.5px] leading-relaxed text-white/55">
            A trial takes one form and a URL. Whatever QualChek generates is yours to keep,
            whether you subscribe or not.
          </p>
          <Link to="/request-trial"
                className="mt-8 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-700">
            Request a 14-day trial <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-5 flex items-center justify-center gap-2 text-[12.5px] text-white/30">
            <ShieldCheck className="h-3.5 w-3.5" />
            Each workspace is isolated at the database level, not by a filter in the code.
          </p>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-[13px] text-slate-400 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5 text-slate-600">
            <QCLogo className="h-5 w-5" accent="#0d8a80" />
            <span className="font-display font-bold">QualChek</span>
          </div>
          <span className="sm:ml-3">Quality, checked.</span>
          <div className="flex gap-5 sm:ml-auto">
            <a href="#pricing" className="hover:text-slate-600">Pricing</a>
            <Link to="/login" className="hover:text-slate-600">Sign in</Link>
            <Link to="/request-trial" className="hover:text-slate-600">Request a trial</Link>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-5 pb-8 text-[12px] text-slate-300">
          © {new Date().getFullYear()} QualChek
        </div>
      </footer>
    </div>
  );
}
