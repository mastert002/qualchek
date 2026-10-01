import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Video, Square, CheckCircle2, AlertCircle, Loader2, FolderKanban, MousePointer2, FormInput, Navigation, Globe } from 'lucide-react';
import api from '../utils/api';

const EVENT_ICONS = {
  navigate:  { icon: Navigation,   color: 'text-brand-500',  label: 'Navigated to' },
  click:     { icon: MousePointer2, color: 'text-purple-500', label: 'Clicked' },
  input:     { icon: FormInput,     color: 'text-green-500',  label: 'Typed into' },
  submit:    { icon: CheckCircle2,  color: 'text-orange-500', label: 'Submitted form' },
};

export default function BrowserRecordPage() {
  const { projectId } = useParams();
  const [url, setUrl] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [currentUrl, setCurrentUrl] = useState('');
  const [eventCount, setEventCount] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const feedRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [events]);

  useEffect(() => {
    if (!sessionId || status === 'done' || status === 'error') return;
    const poll = async () => {
      try {
        const { data } = await api.get(`/projects/${projectId}/crawl/record/status/${sessionId}`);
        setStatus(data.status);
        setEvents(data.events || []);
        setCurrentUrl(data.currentUrl || '');
        setEventCount(data.eventCount || 0);
        if (data.status === 'stopped') setStopping(false);
      } catch (_) {}
    };
    poll();
    pollRef.current = setInterval(poll, 1000);
    return () => clearInterval(pollRef.current);
  }, [sessionId, status, projectId]);

  const handleStart = async e => {
    e.preventDefault();
    setError('');
    setStarting(true);
    setEvents([]);
    setResult(null);
    setEventCount(0);
    try {
      const { data } = await api.post(`/projects/${projectId}/crawl/record/start`, { url: url.trim() || undefined });
      setSessionId(data.session_id);
      setStatus('recording');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start recording');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!sessionId) return;
    setStopping(true);
    try {
      const { data } = await api.post(`/projects/${projectId}/crawl/record/stop/${sessionId}`);
      setResult(data);
      setStatus('done');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to stop recording');
    } finally {
      setStopping(false);
    }
  };

  const isRecording = status === 'recording' || status === 'saving';

  const formatEvent = e => {
    if (e.type === 'navigate') return e.url;
    if (e.type === 'click') return `"${e.text}"`;
    if (e.type === 'input') return `"${e.value}" → ${e.field}`;
    if (e.type === 'submit') return `${(e.fields || []).length} field(s)`;
    return '';
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Video className="w-6 h-6 text-red-500" />
          Browser Recording
        </h1>
        <p className="text-gray-500 mt-1">
          Opens a real browser window. Browse your app manually — every click, form fill, and navigation is captured and converted into test cases.
        </p>
      </div>

      {/* Start form */}
      {!sessionId && (
        <div className="card p-5 mb-5">
          <form onSubmit={handleStart} className="space-y-4">
            <div>
              <label className="label">Starting URL <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                className="input font-mono"
                type="url"
                placeholder="https://your-app.example.com"
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">Leave blank to open an empty browser you can navigate yourself.</p>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}
            <button type="submit" disabled={starting} className="btn-primary w-full justify-center">
              {starting ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening browser…</> : <><Video className="w-4 h-4" /> Start Recording</>}
            </button>
          </form>
        </div>
      )}

      {/* Recording active */}
      {sessionId && status !== 'done' && (
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-semibold text-gray-800">
                {status === 'saving' ? 'Generating test cases…' : 'Recording in progress'}
              </span>
            </div>
            <button
              onClick={handleStop}
              disabled={stopping || status === 'saving'}
              className="btn-danger text-sm py-1.5 px-3 flex items-center gap-1.5"
            >
              {stopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
              {stopping ? 'Stopping…' : 'Stop & Generate Test Cases'}
            </button>
          </div>

          {currentUrl && (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-4 font-mono">
              <Globe className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{currentUrl}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
            <span className="font-medium">Live Event Feed</span>
            <span>{eventCount} event{eventCount !== 1 ? 's' : ''} captured</span>
          </div>
          <div ref={feedRef} className="bg-gray-900 rounded-lg p-3 h-56 overflow-y-auto space-y-1.5">
            {events.length === 0 ? (
              <p className="text-gray-500 text-xs">Waiting for interactions… Browse your app in the opened browser window.</p>
            ) : (
              events.map((e, i) => {
                const meta = EVENT_ICONS[e.type] || {};
                const Icon = meta.icon || Globe;
                return (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${meta.color || 'text-gray-400'}`} />
                    <span className="text-gray-400 font-medium w-16 flex-shrink-0">{meta.label || e.type}</span>
                    <span className="text-gray-200 truncate">{formatEvent(e)}</span>
                  </div>
                );
              })
            )}
          </div>

          <p className="text-xs text-gray-400 mt-3 text-center">
            Browse your application in the opened Chrome window. Click "Stop" when done to generate test cases.
          </p>
        </div>
      )}

      {/* Results */}
      {status === 'done' && result && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Recording complete
          </h2>
          <div className="grid grid-cols-2 gap-4 mb-5">
            {[
              ['Events Captured', eventCount, 'bg-brand-50 text-brand-700'],
              ['Test Cases Saved', result.cases_saved, 'bg-green-50 text-green-700'],
            ].map(([label, val, cls]) => (
              <div key={label} className={`rounded-lg p-4 text-center ${cls}`}>
                <div className="text-3xl font-bold">{val}</div>
                <div className="text-xs mt-1 opacity-75">{label}</div>
              </div>
            ))}
          </div>
          <div className="bg-brand-50 border border-brand-100 rounded-lg p-4 text-sm text-brand-800 mb-4">
            <strong>{result.cases_saved} test case{result.cases_saved !== 1 ? 's' : ''}</strong> were saved to the <strong>"Recorded Sessions"</strong> suite.
          </div>
          <div className="flex gap-2">
            <Link to={`/projects/${projectId}/test-cases`} className="btn-primary inline-flex">
              <FolderKanban className="w-4 h-4" /> View Test Cases
            </Link>
            <button onClick={() => { setSessionId(null); setStatus(null); setResult(null); setEvents([]); }} className="btn-secondary">
              Record Another Session
            </button>
          </div>
        </div>
      )}

      {/* How it works */}
      {!sessionId && (
        <div className="card p-5 mt-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">How it works</h2>
          <ol className="space-y-3 text-sm text-gray-600">
            {[
              ['Click "Start Recording"', 'A real Chrome browser window opens on your screen.'],
              ['Browse your app manually', 'Log in, navigate pages, fill forms, click buttons — exactly as a user would.'],
              ['Events are captured live', 'Every click, form input, and page navigation is recorded in real time.'],
              ['Click "Stop & Generate"', 'The browser closes and test cases are auto-generated from your session and saved to the "Recorded Sessions" suite.'],
            ].map(([title, desc], i) => (
              <li key={i} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <div>
                  <p className="font-medium text-gray-800">{title}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
