import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Check, Minus, Plus, Menu, X, ShieldCheck, Sparkles,
} from 'lucide-react';
import api from '../utils/api';
import QCLogo from '../components/QCLogo';

// Rendered if the API is unreachable. A pricing section that comes up empty
// because the backend is down looks worse than list prices that rarely change.
const FALLBACK_PLANS = [
  { code: 'team3', name: 'Team of 3', max_users: 3, price_monthly_cents: 1000 },
  { code: 'team5', name: 'Team of 5', max_users: 5, price_monthly_cents: 1500 },
  { code: 'team8', name: 'Team of 8', max_users: 8, price_monthly_cents: 2000 },
];

const money = p => `$${(p.price_monthly_cents / 100).toFixed(0)}`;

/* ------------------------------------------------------------------ nav -- */
function Nav() {
  const [open, setOpen] = useState(false);
  const links = [['#features', 'Features'], ['#pipeline', 'CI/CD'], ['#compare', 'Compare'], ['#pricing', 'Pricing']];
  return (
    <header className="sticky z-50 border-b border-white/[0.08] bg-[#0a1420]/80 backdrop-blur-xl"
            style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2.5 text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/15 bg-white/10">
            <QCLogo className="h-[21px] w-[21px]" />
          </div>
          <span className="font-display text-[16.5px] font-bold tracking-[-0.025em]">QualChek</span>
        </Link>
        <nav className="ml-7 hidden items-center gap-6 text-[13.5px] text-white/55 lg:flex">
          {links.map(([href, label]) => (
            <a key={href} href={href} className="transition-colors hover:text-white">{label}</a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <Link to="/login" className="px-3 py-2 text-[13.5px] font-semibold text-white/65 transition-colors hover:text-white">
            Sign in
          </Link>
          <Link to="/request-trial"
                className="rounded-lg bg-brand-500 px-4 py-2 text-[13.5px] font-semibold text-[#06231f] shadow-[0_0_24px_-6px_rgba(56,194,178,0.6)] transition-colors hover:bg-brand-400">
            Start free trial
          </Link>
        </div>
        <button onClick={() => setOpen(o => !o)} aria-label="Menu" className="ml-auto text-white/70 lg:hidden">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-white/10 px-5 py-3 lg:hidden">
          <div className="flex flex-col text-[14px]">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="py-2.5 text-white/65">{label}</a>
            ))}
            <Link to="/login" className="py-2.5 text-white/65">Sign in</Link>
            <Link to="/request-trial"
                  className="mt-2 rounded-lg bg-brand-500 px-4 py-2.5 text-center font-semibold text-[#06231f]">
              Start free trial
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* -------------------------------------------------------------- visuals -- */
/*
 * Drawn rather than screenshotted. A screenshot of an empty demo workspace
 * shows nothing worth seeing, and a staged one would be presenting work that
 * was never done - so these show the mechanism, which is the thing being sold.
 */
function HeroVisual() {
  return (
    <svg viewBox="0 0 460 320" role="img" className="w-full"
         aria-label="A URL is crawled across pages, and each page produces test cases with steps.">
      <defs>
        <marker id="hv-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#38c2b2" />
        </marker>
        <linearGradient id="hv-glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38c2b2" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      <rect x="2" y="2" width="456" height="316" rx="16" fill="url(#hv-glow)" />
      <rect x="18" y="20" width="424" height="34" rx="9" fill="#0a1420" stroke="#ffffff" strokeOpacity="0.14" />
      <circle cx="38" cy="37" r="4.5" fill="#38c2b2" />
      <text x="54" y="42" fontSize="13" fill="#ffffff" fillOpacity="0.8" fontFamily="ui-monospace, monospace">
        https://your-app.com
      </text>

      {[0, 1, 2].map(i => (
        <g key={i}>
          <rect x="18" y={78 + i * 56} width="150" height="44" rx="9"
                fill="#ffffff" fillOpacity="0.05" stroke="#ffffff" strokeOpacity="0.1" />
          <rect x="32" y={92 + i * 56} width={96 - i * 20} height="5.5" rx="2.75" fill="#ffffff" fillOpacity="0.32" />
          <rect x="32" y={104 + i * 56} width={66 - i * 12} height="5.5" rx="2.75" fill="#ffffff" fillOpacity="0.15" />
          <path d={`M 168 ${100 + i * 56} L 258 ${100 + i * 56}`} stroke="#38c2b2" strokeWidth="1.5" markerEnd="url(#hv-a)" />
        </g>
      ))}
      <path d="M 60 54 L 60 78" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1.4" />
      <path d="M 60 134 L 60 190" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1.4" />

      <rect x="266" y="70" width="176" height="226" rx="12" fill="#38c2b2" fillOpacity="0.07"
            stroke="#38c2b2" strokeOpacity="0.28" />
      <text x="284" y="94" fontSize="10.5" letterSpacing="1.4" fill="#38c2b2">GENERATED CASES</text>
      {[0, 1, 2, 3, 4].map(i => (
        <g key={i}>
          <circle cx="290" cy={120 + i * 34} r="7" fill="none" stroke="#38c2b2" strokeWidth="1.4" />
          <path d={`M 286.5 ${120 + i * 34} l 2.5 2.5 l 4.5 -5`} stroke="#38c2b2" strokeWidth="1.7"
                fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="306" y={115 + i * 34} width={116 - (i % 3) * 22} height="5.5" rx="2.75" fill="#ffffff" fillOpacity="0.42" />
          <rect x="306" y={126 + i * 34} width={78 - (i % 2) * 20} height="5.5" rx="2.75" fill="#ffffff" fillOpacity="0.18" />
        </g>
      ))}
    </svg>
  );
}

function RecordVisual() {
  return (
    <svg viewBox="0 0 340 190" role="img" className="w-full"
         aria-label="Clicks and typing in a browser session become numbered test steps."
         fill="none">
      <rect x="1" y="1" width="186" height="188" rx="12" stroke="currentColor" strokeOpacity="0.16" />
      <rect x="1" y="1" width="186" height="28" rx="12" fill="currentColor" fillOpacity="0.05" />
      <circle cx="18" cy="15" r="3.5" fill="#e11d48" fillOpacity="0.7" />
      <text x="30" y="19" fontSize="9.5" fill="currentColor" fillOpacity="0.5">recording</text>
      {[[22, 52, 110], [22, 76, 86], [22, 112, 72]].map(([x, y, w], i) => (
        <rect key={i} x={x} y={y} width={w} height="22" rx="6" stroke="currentColor"
              strokeOpacity={i === 2 ? '0.45' : '0.18'} fill="currentColor"
              fillOpacity={i === 2 ? '0.08' : '0.03'} />
      ))}
      <circle cx="104" cy="123" r="11" fill="#38c2b2" fillOpacity="0.25" />
      <circle cx="104" cy="123" r="4" fill="#38c2b2" />

      <path d="M 196 95 L 226 95" stroke="#38c2b2" strokeWidth="1.6" markerEnd="url(#hv-a)" />

      {[0, 1, 2].map(i => (
        <g key={i}>
          <text x="236" y={66 + i * 42} fontSize="11" fontWeight="600" fill="#38c2b2">{i + 1}</text>
          <rect x="250" y={57 + i * 42} width={84 - i * 14} height="5.5" rx="2.75" fill="currentColor" fillOpacity="0.4" />
          <rect x="250" y={68 + i * 42} width={62 - i * 8} height="5.5" rx="2.75" fill="currentColor" fillOpacity="0.16" />
        </g>
      ))}
    </svg>
  );
}

function PipelineVisual() {
  return (
    <svg viewBox="0 0 340 190" role="img" className="w-full"
         aria-label="A build pushes results into the same record as manual runs, and failures raise Jira issues."
         fill="none">
      <rect x="1" y="26" width="104" height="48" rx="10" stroke="currentColor" strokeOpacity="0.16" />
      <text x="53" y="48" textAnchor="middle" fontSize="10.5" fill="currentColor" fillOpacity="0.6">CI build</text>
      <text x="53" y="62" textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.35">automated</text>

      <rect x="1" y="112" width="104" height="48" rx="10" stroke="currentColor" strokeOpacity="0.16" />
      <text x="53" y="134" textAnchor="middle" fontSize="10.5" fill="currentColor" fillOpacity="0.6">Manual run</text>
      <text x="53" y="148" textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.35">a tester</text>

      <path d="M 109 50 L 139 78" stroke="#38c2b2" strokeWidth="1.5" markerEnd="url(#hv-a)" />
      <path d="M 109 136 L 139 108" stroke="#38c2b2" strokeWidth="1.5" markerEnd="url(#hv-a)" />

      <rect x="145" y="62" width="108" height="62" rx="11" fill="#38c2b2" fillOpacity="0.09" stroke="#38c2b2" strokeOpacity="0.3" />
      <text x="199" y="86" textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#38c2b2">One record</text>
      <text x="199" y="102" textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.45">same test cases</text>
      <text x="199" y="115" textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.45">one pass rate</text>

      <path d="M 257 93 L 287 93" stroke="#e11d48" strokeOpacity="0.6" strokeWidth="1.5" />
      <rect x="291" y="72" width="48" height="42" rx="9" stroke="#e11d48" strokeOpacity="0.4" fill="#e11d48" fillOpacity="0.06" />
      <text x="315" y="90" textAnchor="middle" fontSize="9.5" fill="#e11d48" fillOpacity="0.85">Jira</text>
      <text x="315" y="103" textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity="0.4">on fail</text>
    </svg>
  );
}

/* ------------------------------------------------------------- sections -- */
const FEATURES = [
  {
    eyebrow: 'The crawler',
    title: 'Give it a URL. Get back test cases.',
    body: 'QualChek drives a real browser through your application — so it sees what a tester sees, '
        + 'not an empty div and a script tag. It works out what each page needs covered from the forms, '
        + 'tables and navigation it finds, then writes the cases with steps and expected results.',
    points: ['Signs in by finding the login form itself', 'Walks the app breadth-first, same origin only',
             'Re-crawl later and it adds only what is new'],
    visual: HeroVisual, wide: true,
  },
  {
    eyebrow: 'Session recording',
    title: 'Or click through it once.',
    body: 'Some flows a crawler will never reach on its own — anything behind a multi-step form, '
        + 'anything that needs real data. Record a session instead: click through it once, and '
        + 'QualChek turns what you did into a case with numbered steps.',
    points: ['Captures clicks, typing and navigation', 'Produces editable steps, not a video'],
    visual: RecordVisual,
  },
  {
    eyebrow: 'CI and Jira',
    title: 'One record for people and pipelines.',
    body: 'Your build reports results against the same test cases your manual runs use, so there is '
        + 'one pass rate rather than a dashboard for the robots and a spreadsheet for everyone else. '
        + 'Failures become Jira issues with the case, the steps and the run attached.',
    points: ['Results matched by test name, no ids to wire up', 'Anything CI never reported is marked skipped, not hidden',
             'Comments sync both ways with Jira'],
    visual: PipelineVisual,
  },
];

const COMPARE = [
  ['Writes your test cases for you', true, false],
  ['Generates cases from a live URL', true, false],
  ['Turns a recorded session into steps', true, false],
  ['Manual test runs and results', true, true],
  ['CI reporting from your pipeline', true, true],
  ['Jira issues and two-way comments', true, true],
  ['Priced by team size, not per seat', true, false],
];

const FAQ = [
  ['Do I need to install anything?',
   'No. QualChek runs the browser itself — you give it a URL and, if the app needs one, a login. '
   + 'Nothing is installed in your application and nothing runs on your machine.'],
  ['What does it do about pages behind a login?',
   'You store a credential per project and QualChek signs in with it, discovering the login form by '
   + 'inspecting the page rather than needing selectors from you. Credentials are admin-only to change, '
   + 'and moving one to a different URL requires re-entering its password.'],
  ['Are the generated cases any good?',
   'They are a starting point, not a finished suite. Each one has real steps and expected results '
   + 'written against your own page titles and button labels, and they land in their own suite so you '
   + 'can keep what is useful and bin the rest. The point is that reviewing beats writing from nothing.'],
  ['What happens when the trial ends?',
   'The workspace becomes read-only. Nothing is deleted — everything QualChek generated is still there '
   + 'and still exportable, you simply cannot add more until you choose a plan.'],
  ['Is my data separate from other customers?',
   'Yes, and it is enforced by the database rather than by a filter in the application code. Each '
   + 'workspace is isolated by row-level security, so a query that forgot to scope itself returns '
   + 'nothing rather than somebody else’s data.'],
];

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
              className="flex w-full items-center gap-4 py-5 text-left">
        <span className="font-display text-[16px] font-bold tracking-[-0.01em] text-slate-900">{q}</span>
        <span className="ml-auto flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-400">
          {open ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && <p className="max-w-3xl pb-5 text-[14.5px] leading-relaxed text-slate-600">{a}</p>}
    </div>
  );
}


/* ---------------------------------------------------------- CI workflow -- */
// The real endpoints, not an illustrative sketch: a reader should be able to
// copy this, change three values and have it work.
const WORKFLOW = `name: Tests → QualChek
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      QC_URL: https://app.qualchek.com/api
      QC_KEY: \${{ secrets.QUALCHEK_API_KEY }}
      QC_PROJECT: prj_1a2b3c

    steps:
      - uses: actions/checkout@v4
      - run: npm ci

      # 1 — open a run in QualChek
      - id: run
        run: |
          echo "id=$(curl -s -X POST \
            "$QC_URL/ci/projects/$QC_PROJECT/runs" \
            -H "X-API-Key: $QC_KEY" \
            -H "Content-Type: application/json" \
            -d '{"name":"Build #\${{ github.run_number }}"}' \
            | jq -r .id)" >> $GITHUB_OUTPUT

      # 2 — run your suite. A failing test must not stop the report
      - run: npx playwright test --reporter=json > out.json
        continue-on-error: true

      # 3 — report results, then close the run
      - run: |
          curl -s -X POST "$QC_URL/ci/runs/\${{ steps.run.outputs.id }}/results" \
            -H "X-API-Key: $QC_KEY" -H "Content-Type: application/json" \
            --data @payload.json

          curl -s -X POST "$QC_URL/ci/runs/\${{ steps.run.outputs.id }}/complete" \
            -H "X-API-Key: $QC_KEY"`;

const EXCHANGE = [
  ['Open a run', 'POST /ci/projects/{id}/runs',
   'Your build tells QualChek a run is starting and gets an id back. Name it after the build so a result can always be traced to the commit that produced it.'],
  ['Push results', 'POST /ci/runs/{id}/results',
   'Send each test name and whether it passed. Matched to your test cases by title, so there are no QualChek ids to wire into your suite.'],
  ['Close it', 'POST /ci/runs/{id}/complete',
   'Anything the pipeline never reported is marked skipped rather than quietly left out — so the run says what was not covered, not just what failed.'],
];

/** Light YAML colouring: enough to read, without pulling in a highlighter. */
function Yaml({ source }) {
  return (
    <pre className="overflow-x-auto px-5 py-4 font-mono text-[12px] leading-[1.75] text-white/80">
      <code>
        {source.split('\n').map((line, i) => {
          if (/^\s*#/.test(line)) {
            return <div key={i} className="text-brand-400/70">{line || ' '}</div>;
          }
          const m = line.match(/^(\s*-?\s*)([A-Za-z0-9_.-]+)(:)(.*)$/);
          if (m) {
            return (
              <div key={i}>
                <span className="text-white/35">{m[1]}</span>
                <span className="text-indigo2-500">{m[2]}</span>
                <span className="text-white/35">{m[3]}</span>
                <span className="text-white/75">{m[4]}</span>
              </div>
            );
          }
          return <div key={i} className="text-white/60">{line || ' '}</div>;
        })}
      </code>
    </pre>
  );
}

/* ----------------------------------------------------------------- page -- */
export default function LandingPage() {
  const [plans, setPlans] = useState(FALLBACK_PLANS);

  useEffect(() => {
    api.get('/trial-request/plans')
      .then(r => { if (Array.isArray(r.data) && r.data.length) setPlans(r.data); })
      .catch(() => { /* fallback already rendered */ });
  }, []);

  return (
    <div className="bg-white">
      <Nav />

      {/* ------------------------------------------------------- hero ---- */}
      <section className="relative overflow-hidden bg-[#0a1420] text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.06]"
             style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div aria-hidden="true" className="pointer-events-none absolute -right-52 -top-56 h-[46rem] w-[46rem] rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(25,166,153,0.26) 0%, rgba(0,0,0,0) 68%)' }} />
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-64 h-[32rem] w-[32rem] rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(79,70,229,0.18) 0%, rgba(0,0,0,0) 70%)' }} />

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/25 bg-brand-500/10 px-3 py-1 text-[11.5px] font-semibold tracking-wide text-brand-300">
              <Sparkles className="h-3.5 w-3.5" />
              14 days free &middot; no card
            </span>

            <h1 className="mt-6 font-display text-[2.6rem] font-extrabold leading-[1.04] tracking-[-0.04em] text-balance sm:text-[3.5rem]">
              Tests you never
              <br />
              <span className="bg-gradient-to-r from-brand-300 via-brand-400 to-indigo2-500 bg-clip-text text-transparent">
                had to write.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-[16.5px] leading-relaxed text-white/55">
              Every other test management tool is a filing cabinet for cases you already wrote.
              QualChek writes them — point it at your application and it comes back with the
              test cases, then tracks every run, manual or automated, in one record.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/request-trial"
                    className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3.5 text-[15px] font-bold text-[#06231f] shadow-[0_0_40px_-10px_rgba(56,194,178,0.75)] transition-colors hover:bg-brand-400">
                Start your free trial <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#features"
                 className="rounded-xl border border-white/15 px-6 py-3.5 text-[15px] font-semibold text-white/80 transition-colors hover:border-white/30 hover:text-white">
                See how it works
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-7 gap-y-2 text-[12.5px] text-white/35">
              {['Nothing to install', 'Works on any web app', 'Keep what it generates'].map(t => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-brand-400" />{t}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div aria-hidden="true" className="absolute -inset-5 rounded-3xl bg-gradient-to-br from-brand-500/15 to-indigo2-500/10 blur-2xl" />
            <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm">
              <HeroVisual />
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- why ---- */}
      <section id="why" className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <h2 className="font-display text-[1.9rem] font-extrabold leading-tight tracking-[-0.035em] text-slate-900 text-balance sm:text-[2.4rem]">
              Writing test cases is the part nobody has time for.
            </h2>
            <div className="space-y-4 text-[15.5px] leading-relaxed text-slate-600">
              <p>
                Which is why coverage is usually thinner than anyone admits. The suite covers the login
                page and the happy path, and the rest is in somebody&rsquo;s head.
              </p>
              <p>
                Every tool in this category assumes the writing is already done and offers somewhere to
                keep it. QualChek starts one step earlier: it reads your application and produces the
                cases, so the work becomes reviewing a list instead of facing a blank page.
              </p>
              <p className="font-semibold text-slate-900">
                Everything else — runs, reports, CI, Jira — works the way you would expect.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- features ---- */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <div className="space-y-20 lg:space-y-28">
          {FEATURES.map(({ eyebrow, title, body, points, visual: Visual, wide }, i) => (
            <div key={title}
                 className={`grid items-center gap-10 lg:grid-cols-2 lg:gap-16 ${i % 2 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
              <div>
                <p className="font-display text-[11.5px] font-bold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p>
                <h3 className="mt-3 font-display text-[1.75rem] font-extrabold leading-tight tracking-[-0.03em] text-slate-900 text-balance sm:text-[2.1rem]">
                  {title}
                </h3>
                <p className="mt-4 text-[15.5px] leading-relaxed text-slate-600">{body}</p>
                <ul className="mt-6 space-y-2.5">
                  {points.map(p => (
                    <li key={p} className="flex items-start gap-2.5 text-[14.5px] text-slate-700">
                      <span className="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-brand-50 ring-1 ring-brand-200">
                        <Check className="h-3 w-3 text-brand-600" />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`rounded-2xl border p-5 ${wide ? 'border-slate-200 bg-[#0a1420]' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                <Visual />
              </div>
            </div>
          ))}
        </div>
      </section>


      {/* ------------------------------------------------- ci workflow ---- */}
      <section id="pipeline" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
          <div className="max-w-2xl">
            <p className="font-display text-[11.5px] font-bold uppercase tracking-[0.16em] text-brand-600">
              Test run automation
            </p>
            <h2 className="mt-3 font-display text-[1.9rem] font-extrabold leading-tight tracking-[-0.035em] text-slate-900 text-balance sm:text-[2.3rem]">
              Three calls, and your pipeline reports in
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed text-slate-600">
              No plugin, no agent, no SDK to keep up to date — QualChek takes results over
              HTTP, so whatever your suite is written in can report into it. Here it is in a
              GitHub Actions workflow; GitLab, Jenkins and Azure Pipelines are the same three
              calls.
            </p>
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
            <ol className="space-y-7">
              {EXCHANGE.map(([title, endpoint, body], i) => (
                <li key={title} className="relative pl-11">
                  <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 font-display text-[12.5px] font-bold text-white">
                    {i + 1}
                  </span>
                  <h3 className="font-display text-[16.5px] font-bold text-slate-900">{title}</h3>
                  <code className="mt-1.5 block font-mono text-[11.5px] text-brand-700">{endpoint}</code>
                  <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{body}</p>
                </li>
              ))}
              <li className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-[13px] leading-relaxed text-slate-500">
                <span className="font-semibold text-slate-700">The key is scoped to one workspace.</span>{' '}
                It cannot read or write another customer&rsquo;s projects, and a lapsed trial
                makes reporting fail loudly rather than appear to succeed while nothing is recorded.
              </li>
            </ol>

            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0a1420] shadow-[0_20px_60px_-30px_rgba(10,20,32,0.8)]">
              <div className="flex items-center gap-2 border-b border-white/[0.08] px-5 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="ml-2 font-mono text-[11.5px] text-white/35">
                  .github/workflows/qualchek.yml
                </span>
              </div>
              <Yaml source={WORKFLOW} />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- compare ---- */}
      <section id="compare" className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-4xl px-5 py-16 lg:py-20">
          <h2 className="font-display text-[1.9rem] font-extrabold tracking-[-0.035em] text-slate-900 sm:text-[2.2rem]">
            What makes it different
          </h2>
          <p className="mt-3 text-[15px] text-slate-500">
            The bottom half of this table is table stakes. The top half is the reason to switch.
          </p>

          <div className="mt-8 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[520px] text-[14.5px]">
              <thead>
                <tr className="border-b border-slate-200 text-[12px] uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3.5 text-left font-medium">Capability</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-brand-600">QualChek</th>
                  <th className="px-5 py-3.5 text-center font-medium">Typical test management</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([label, mine, theirs], i) => (
                  <tr key={label} className={i < 3 ? 'bg-brand-50/40' : ''}>
                    <td className="border-t border-slate-100 px-5 py-3.5 text-slate-700">{label}</td>
                    <td className="border-t border-slate-100 px-5 py-3.5 text-center">
                      <Check className="mx-auto h-4 w-4 text-brand-600" />
                    </td>
                    <td className="border-t border-slate-100 px-5 py-3.5 text-center">
                      {theirs ? <Check className="mx-auto h-4 w-4 text-slate-400" />
                              : <Minus className="mx-auto h-4 w-4 text-slate-300" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- pricing ---- */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <div className="text-center">
          <h2 className="font-display text-[1.9rem] font-extrabold tracking-[-0.035em] text-slate-900 sm:text-[2.4rem]">
            Priced by team size, not per seat
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-[15.5px] leading-relaxed text-slate-500">
            One flat monthly fee for a cap on people. Adding the tester who was going to use it
            anyway should not change your bill.
          </p>
        </div>

        <div className="mt-11 grid gap-5 sm:grid-cols-3">
          {plans.map((p, i) => {
            const featured = i === 1;
            return (
              <div key={p.code}
                   className={`relative rounded-2xl border p-7 transition-shadow ${
                     featured ? 'border-brand-600 shadow-[0_18px_50px_-24px_rgba(13,138,128,0.5)] ring-1 ring-brand-600'
                              : 'border-slate-200 hover:shadow-[0_14px_40px_-28px_rgba(15,23,42,0.4)]'}`}>
                {featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-white">
                    Most chosen
                  </span>
                )}
                <h3 className="font-display text-[15px] font-bold text-slate-900">{p.name}</h3>
                <p className="mt-4 font-display text-[2.6rem] font-extrabold leading-none tracking-[-0.04em] text-slate-900">
                  {money(p)}<span className="text-[15px] font-medium text-slate-400">/month</span>
                </p>
                <p className="mt-2 text-[13.5px] text-slate-500">Up to {p.max_users} people</p>

                <ul className="mt-6 space-y-2.5 border-t border-slate-100 pt-6">
                  {['The crawler and session recording', 'Unlimited projects and test cases',
                    'CI/CD workflow integration — any pipeline',
                    'Jira issues, with comments both ways',
                    'Every feature — tiers differ only by size'].map(f => (
                    <li key={f} className="flex items-start gap-2 text-[13.5px] text-slate-600">
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-600" />{f}
                    </li>
                  ))}
                </ul>

                <Link to="/request-trial"
                      className={`mt-7 block rounded-lg px-4 py-3 text-center text-[14.5px] font-semibold transition-colors ${
                        featured ? 'bg-brand-600 text-white hover:bg-brand-700'
                                 : 'border border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                  Start free trial
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-7 max-w-2xl text-center text-[13px] text-slate-400">
          A trial runs 14 days with no card. When it ends the workspace becomes read-only rather than
          disappearing — everything QualChek generated stays yours.
        </p>
      </section>

      {/* -------------------------------------------------------- faq ---- */}
      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-4xl px-5 py-16 lg:py-20">
          <h2 className="font-display text-[1.9rem] font-extrabold tracking-[-0.035em] text-slate-900">
            Questions
          </h2>
          <div className="mt-8">
            {FAQ.map(([q, a]) => <FaqItem key={q} q={q} a={a} />)}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- cta ---- */}
      <section className="relative overflow-hidden bg-[#0a1420]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-32 h-[34rem] w-[34rem] rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(25,166,153,0.22) 0%, rgba(0,0,0,0) 70%)' }} />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-32 h-[30rem] w-[30rem] rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(79,70,229,0.16) 0%, rgba(0,0,0,0) 70%)' }} />
        <div className="relative mx-auto max-w-3xl px-5 py-20 text-center">
          <h2 className="font-display text-[2rem] font-extrabold leading-tight tracking-[-0.035em] text-white text-balance sm:text-[2.6rem]">
            See what it finds in your app
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-white/55">
            One form and a URL. Whatever QualChek generates is yours to keep, whether you
            subscribe or not.
          </p>
          <Link to="/request-trial"
                className="mt-9 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-7 py-4 text-[15.5px] font-bold text-[#06231f] shadow-[0_0_44px_-10px_rgba(56,194,178,0.8)] transition-colors hover:bg-brand-400">
            Start your free trial <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-white/30">
            <ShieldCheck className="h-3.5 w-3.5" />
            Each workspace is isolated at the database level, not by a filter in the code.
          </p>
        </div>
      </section>

      <footer className="bg-[#0a1420] text-white/40">
        <div className="mx-auto max-w-6xl border-t border-white/[0.08] px-5 py-9">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2.5 text-white/75">
              <QCLogo className="h-5 w-5" />
              <span className="font-display text-[14.5px] font-bold">QualChek</span>
              <span className="text-[13px] text-white/30">Quality, checked.</span>
            </div>
            <div className="flex flex-wrap gap-6 text-[13px] sm:ml-auto">
              <a href="#features" className="transition-colors hover:text-white">Features</a>
              <a href="#pricing" className="transition-colors hover:text-white">Pricing</a>
              <Link to="/login" className="transition-colors hover:text-white">Sign in</Link>
              <Link to="/request-trial" className="transition-colors hover:text-white">Start free trial</Link>
            </div>
          </div>
          <p className="mt-7 text-[12px] text-white/20">© {new Date().getFullYear()} QualChek</p>
        </div>
      </footer>
    </div>
  );
}
