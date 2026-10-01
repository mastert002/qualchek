import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Globe, Play, CheckCircle2, AlertCircle, Loader2, FolderKanban, KeyRound, Clock, X, Square, ExternalLink, ZoomIn } from 'lucide-react';
import api from '../utils/api';

const URL_HISTORY_KEY = 'crawler_url_history';
const MAX_HISTORY = 10;

function getUrlHistory() {
  try { return JSON.parse(localStorage.getItem(URL_HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveUrlToHistory(url) {
  const history = getUrlHistory().filter(u => u !== url);
  history.unshift(url);
  localStorage.setItem(URL_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}
function removeUrlFromHistory(url) {
  const history = getUrlHistory().filter(u => u !== url);
  localStorage.setItem(URL_HISTORY_KEY, JSON.stringify(history));
}

export default function CrawlerPage() {
  const { projectId } = useParams();

  // Saved credentials list
  const { data: credentials = [] } = useQuery({
    queryKey: ['crawler-credentials', projectId],
    queryFn: () => api.get(`/projects/${projectId}/crawl/credentials`).then(r => r.data),
    retry: false,
  });

  // Config
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(15);
  const [maxDepth, setMaxDepth] = useState(2);
  const [showHistory, setShowHistory] = useState(false);
  const [urlHistory, setUrlHistory] = useState(getUrlHistory);
  const urlInputRef = useRef(null);

  // Job state
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null); // null | 'running' | 'done' | 'error'
  const [log, setLog] = useState([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const logRef = useRef(null);
  const pollRef = useRef(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Polling
  useEffect(() => {
    if (!jobId || jobStatus === 'done' || jobStatus === 'error' || jobStatus === 'stopped') return;

    const poll = async () => {
      try {
        const { data } = await api.get(`/projects/${projectId}/crawl/status/${jobId}`);
        setLog(data.log || []);
        setProgress(data.progress || { current: 0, total: 0 });
        setJobStatus(data.status);
        if (data.screenshots?.length) setScreenshots(data.screenshots);
        if (data.status === 'done' || data.status === 'error' || data.status === 'stopped') {
          setResult(data.result);
        }
      } catch (_) {}
    };

    poll();
    pollRef.current = setInterval(poll, 1500);
    return () => clearInterval(pollRef.current);
  }, [jobId, jobStatus, projectId]);

  const handleStart = async e => {
    e.preventDefault();
    if (!url.trim()) return;
    setError('');
    setStarting(true);
    setLog([]);
    setResult(null);
    setScreenshots([]);
    setProgress({ current: 0, total: 0 });
    setJobStatus(null);

    try {
      const payload = {
        url: url.trim(),
        max_pages: Number(maxPages),
        max_depth: Number(maxDepth),
      };
      const { data } = await api.post(`/projects/${projectId}/crawl/start`, payload);
      saveUrlToHistory(url.trim());
      setUrlHistory(getUrlHistory());
      setJobId(data.job_id);
      setJobStatus('running');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start crawl');
    } finally {
      setStarting(false);
    }
  };

  const isRunning = jobStatus === 'running';
  const isDone = jobStatus === 'done';
  const isStopped = jobStatus === 'stopped';
  const isError = jobStatus === 'error';

  const handleStop = async () => {
    if (!jobId) return;
    try { await api.post(`/projects/${projectId}/crawl/stop/${jobId}`); } catch (_) {}
  };
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Globe className="w-6 h-6 text-brand-600" />
          Web Crawler
        </h1>
        <p className="text-gray-500 mt-1">
          Enter your application URL and the crawler will visit pages, discover interactions, and auto-generate test cases.
        </p>
      </div>

      {/* Saved credentials banner */}
      <div className={`flex items-center justify-between gap-3 text-sm px-4 py-3 rounded-lg mb-4 border ${
        credentials.length > 0
          ? 'bg-green-50 border-green-200 text-green-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}>
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 flex-shrink-0" />
          {credentials.length > 0 ? (
            <span>
              <strong>{credentials.length} credential{credentials.length !== 1 ? 's' : ''}</strong> saved —
              the matching one will be used automatically based on the target URL.
            </span>
          ) : (
            <span>No credentials saved. Configure them to crawl authenticated pages.</span>
          )}
        </div>
        <Link
          to={`/projects/${projectId}/crawler/settings`}
          className="text-xs font-medium underline underline-offset-2 whitespace-nowrap hover:opacity-80"
        >
          {credentials.length > 0 ? 'Manage credentials' : 'Configure credentials'}
        </Link>
      </div>

      {/* Config form */}
      <div className="card p-5 mb-5">
        <form onSubmit={handleStart} className="space-y-5">
          {/* Target URL */}
          <div className="relative">
            <label className="label">Target Application URL *</label>
            <input
              ref={urlInputRef}
              className="input font-mono"
              type="url"
              placeholder="https://your-app.example.com"
              value={url}
              onChange={e => { setUrl(e.target.value); setShowHistory(true); }}
              onFocus={() => setShowHistory(true)}
              onBlur={() => setTimeout(() => setShowHistory(false), 150)}
              required
              disabled={isRunning}
            />
            {showHistory && urlHistory.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                <div className="px-3 py-1.5 text-xs text-gray-400 font-medium border-b border-gray-100">Recent URLs</div>
                {urlHistory
                  .filter(u => !url || u.toLowerCase().includes(url.toLowerCase()))
                  .map((u, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer group"
                      onMouseDown={() => { setUrl(u); setShowHistory(false); }}>
                      <Clock className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                      <span className="flex-1 text-sm font-mono text-gray-700 truncate">{u}</span>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 p-0.5"
                        onMouseDown={e => {
                          e.stopPropagation();
                          removeUrlFromHistory(u);
                          setUrlHistory(getUrlHistory());
                        }}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">The crawler will start here and follow links within the same domain.</p>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Max Pages <span className="text-gray-400 font-normal">(1–50)</span></label>
              <input
                className="input"
                type="number"
                min={1}
                max={50}
                value={maxPages}
                onChange={e => setMaxPages(e.target.value)}
                disabled={isRunning}
              />
              <p className="text-xs text-gray-400 mt-1">More pages = more test cases but takes longer.</p>
            </div>
            <div>
              <label className="label">Crawl Depth <span className="text-gray-400 font-normal">(1–5)</span></label>
              <input
                className="input"
                type="number"
                min={1}
                max={5}
                value={maxDepth}
                onChange={e => setMaxDepth(e.target.value)}
                disabled={isRunning}
              />
              <p className="text-xs text-gray-400 mt-1">How many clicks deep to follow from the start URL. Depth 1 = start page only; depth 2 = start page + pages linked from it; depth 3 = one level further, and so on.</p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isRunning || starting || !url.trim()}
            className="btn-primary w-full justify-center"
          >
            {isRunning ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Crawling…</>
            ) : (
              <><Play className="w-4 h-4" /> Start Crawl</>
            )}
          </button>
        </form>
      </div>

      {/* Progress + Log */}
      {(isRunning || isDone || isStopped || isError) && (
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              {isRunning && <Loader2 className="w-4 h-4 animate-spin text-brand-500" />}
              {isDone && <CheckCircle2 className="w-4 h-4 text-green-500" />}
              {isStopped && <Square className="w-4 h-4 text-orange-500" />}
              {isError && <AlertCircle className="w-4 h-4 text-red-500" />}
              {isRunning ? 'Crawling in progress…' : isDone ? 'Crawl complete' : isStopped ? 'Crawl stopped' : 'Crawl failed'}
            </h2>
            <div className="flex items-center gap-3">
              {progress.total > 0 && (
                <span className="text-xs text-gray-500">{progress.current} / {progress.total} pages</span>
              )}
              {isRunning && (
                <button onClick={handleStop} className="btn-danger text-xs py-1 px-2 flex items-center gap-1">
                  <Square className="w-3 h-3" /> Stop
                </button>
              )}
            </div>
          </div>

          {progress.total > 0 && (
            <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
              <div
                className="bg-brand-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          )}

          <div
            ref={logRef}
            className="bg-gray-900 text-gray-200 rounded-lg p-3 font-mono text-xs leading-relaxed h-48 overflow-y-auto"
          >
            {log.length === 0 ? (
              <span className="text-gray-500">Waiting for output…</span>
            ) : (
              log.map((line, i) => (
                <div key={i} className={
                  line.startsWith('  Error') ? 'text-red-400' :
                  line.startsWith('Saved') || line.includes('complete') ? 'text-green-400' :
                  line.startsWith('Login') || line.startsWith('Attempting') ? 'text-yellow-300' :
                  ''
                }>
                  {line || ' '}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {(isDone || isStopped) && result && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Results
          </h2>
          <div className={`grid gap-4 mb-5 ${result.cases_skipped ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
            {[
              ['Pages Crawled', result.pages_crawled, 'bg-brand-50 text-brand-700'],
              ['Cases Generated', result.cases_generated, 'bg-purple-50 text-purple-700'],
              ['New Cases Saved', result.cases_saved, 'bg-green-50 text-green-700'],
              // Only meaningful on a re-crawl, so hidden the first time round.
              ...(result.cases_skipped
                ? [['Already Existed', result.cases_skipped, 'bg-amber-50 text-amber-700']]
                : []),
            ].map(([label, val, cls]) => (
              <div key={label} className={`rounded-lg p-4 text-center ${cls}`}>
                <div className="text-3xl font-bold">{val}</div>
                <div className="text-xs mt-1 opacity-75">{label}</div>
              </div>
            ))}
          </div>

          {screenshots.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Pages Crawled</h3>
              <div className="grid grid-cols-2 gap-3">
                {screenshots.map((s, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50 group">
                    <div
                      className="relative cursor-pointer"
                      onClick={() => setLightbox(s)}
                    >
                      <img
                        src={`data:image/jpeg;base64,${s.screenshot}`}
                        alt={s.title}
                        className="w-full object-cover object-top"
                        style={{ height: '140px' }}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                    <div className="px-2 py-1.5 flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{s.title}</p>
                        <p className="text-xs text-gray-400 truncate">{s.url}</p>
                      </div>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex-shrink-0 text-gray-300 hover:text-brand-500 mt-0.5"
                        title="Open page"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-brand-50 border border-brand-100 rounded-lg p-4 text-sm text-brand-800 mb-4">
            <strong>{result.cases_saved} new test case{result.cases_saved !== 1 ? 's' : ''}</strong> saved to the <strong>"Auto-Crawled"</strong> suite in this project.
            {result.cases_skipped > 0 && (
              <> {result.cases_skipped} case{result.cases_skipped !== 1 ? 's' : ''} already existed here and {result.cases_skipped !== 1 ? 'were' : 'was'} skipped, so re-crawling does not duplicate what you already have.</>
            )}
            {result.cases_failed > 0 && (
              <> {result.cases_failed} could not be saved — see the log above.</>
            )}
            {' '}You can review, edit, and organise them on the Test Cases page.
          </div>

          <Link
            to={`/projects/${projectId}/test-cases`}
            className="btn-primary inline-flex"
          >
            <FolderKanban className="w-4 h-4" />
            View Generated Test Cases
          </Link>
        </div>
      )}

      {/* How it works */}
      {!jobId && (
        <div className="card p-5 mt-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">How it works</h2>
          <ol className="space-y-3 text-sm text-gray-600">
            {[
              ['Enter URL', 'Provide the base URL of your web application. The crawler stays within the same domain.'],
              ['Configure credentials', 'If your app requires authentication, save credentials via Crawler Credentials so the crawler can access protected pages automatically.'],
              ['Crawl & analyse', 'The crawler visits pages, detecting forms, navigation menus, data tables, and interactive elements.'],
              ['Test cases generated', 'For each page and interaction discovered, meaningful test cases are automatically written and saved to an "Auto-Crawled" suite.'],
            ].map(([title, desc], i) => (
              <li key={i} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-gray-800">{title}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="bg-white rounded-xl overflow-hidden shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{lightbox.title}</p>
                <a
                  href={lightbox.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-500 hover:underline flex items-center gap-1 truncate"
                >
                  {lightbox.url}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
              <button
                onClick={() => setLightbox(null)}
                className="ml-4 flex-shrink-0 text-gray-400 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <img
                src={`data:image/jpeg;base64,${lightbox.screenshot}`}
                alt={lightbox.title}
                className="w-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
