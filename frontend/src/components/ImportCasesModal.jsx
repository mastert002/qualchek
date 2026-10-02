import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, AlertTriangle, Check, X, Download } from 'lucide-react';
import Modal from './Modal';
import api from '../utils/api';

// Parsed in the browser rather than uploaded.
//
// It keeps multipart handling, temp files and upload limits out of a serverless
// function, and - the reason that actually matters - the person sees exactly
// what will be created before anything is written. An upload that reports
// "imported 240 cases" after the fact is a much worse experience than a table
// you can look at first.

const FIELDS = [
  ['title', 'Title', true],
  ['description', 'Description', false],
  ['preconditions', 'Preconditions', false],
  ['steps', 'Steps', false],
  ['expected_result', 'Expected result', false],
  ['priority', 'Priority', false],
  ['tags', 'Tags', false],
  ['automation_status', 'Automation', false],
];

// Header names people actually use, so a typical sheet maps itself and the
// mapping step becomes a confirmation rather than a chore.
const ALIASES = {
  title: ['title', 'test case', 'testcase', 'name', 'summary', 'test case title', 'case'],
  description: ['description', 'desc', 'details', 'objective'],
  preconditions: ['preconditions', 'precondition', 'pre-conditions', 'prerequisites', 'setup'],
  steps: ['steps', 'test steps', 'step', 'actions', 'procedure'],
  expected_result: ['expected result', 'expected', 'expected results', 'expected outcome', 'result'],
  priority: ['priority', 'severity', 'importance'],
  tags: ['tags', 'labels', 'tag', 'component'],
  automation_status: ['automation', 'automation status', 'automated', 'type'],
};

const norm = h => String(h || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

function autoMap(headers) {
  const mapping = {};
  for (const [field] of FIELDS) {
    // Both sides normalised. Comparing a normalised header against raw aliases
    // means any alias containing a hyphen or underscore can never match - which
    // is how "Pre-conditions" went unmapped while "pre-conditions" sat in the
    // list looking correct.
    const wanted = ALIASES[field].map(norm);
    const hit = headers.find(h => wanted.includes(norm(h)));
    if (hit) mapping[field] = hit;
  }
  return mapping;
}

const TEMPLATE = [
  ['Title', 'Description', 'Preconditions', 'Steps', 'Expected result', 'Priority', 'Tags'],
  ['Login with valid credentials', 'Signing in from the login page', 'A registered account exists',
   '1. Open /login\n2. Enter the email and password\n3. Click Sign in -> The dashboard loads',
   'The user reaches the dashboard', 'critical', 'smoke, auth'],
  ['Search returns results', '', '', 'Type a known term\nPress Enter', 'Matching rows are listed', 'medium', 'search'],
];

export default function ImportCasesModal({ onClose, projectId, suiteId, onImported }) {
  const [rows, setRows] = useState(null);       // raw objects from the sheet
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const reset = () => {
    setRows(null); setHeaders([]); setMapping({}); setFileName('');
    setParseError(''); setResult(null); setBusy(false);
  };

  const close = () => { reset(); onClose(); };

  const readFile = async file => {
    setParseError(''); setResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('That file has no sheets in it.');
      // defval keeps empty cells as '' so a row never silently loses a column.
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      if (json.length === 0) throw new Error('The first sheet has no rows below the header.');
      const hdrs = Object.keys(json[0]);
      setHeaders(hdrs);
      setMapping(autoMap(hdrs));
      setRows(json);
    } catch (err) {
      setParseError(err.message || 'Could not read that file.');
      setRows(null);
    }
  };

  const mapped = rows ? rows.map(r => {
    const out = {};
    for (const [field] of FIELDS) {
      if (mapping[field]) out[field] = r[mapping[field]];
    }
    return out;
  }) : [];

  const withTitles = mapped.filter(r => String(r.title || '').trim());
  const missingTitles = mapped.length - withTitles.length;

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/projects/${projectId}/test-cases/import`, {
        cases: mapped, suite_id: suiteId || null, skip_duplicates: skipDuplicates,
      });
      setResult(data);
      if (data.created > 0) onImported?.();
    } catch (err) {
      setParseError(err.response?.data?.error || 'The import failed.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(TEMPLATE), 'Test cases');
    XLSX.writeFile(wb, 'qualchek-template.xlsx');
  };

  return (
    <Modal title="Import test cases" onClose={close} size="lg">
      {/* ---- done ------------------------------------------------------- */}
      {result ? (
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-pass-50 ring-1 ring-pass-500/25">
              <Check className="h-5 w-5 text-pass-500" />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-gray-900">
                {result.created} test case{result.created === 1 ? '' : 's'} imported
              </p>
              <p className="text-[13px] text-gray-500">
                {result.skipped > 0 && `${result.skipped} already existed and were skipped. `}
                {result.failed > 0 && `${result.failed} could not be imported.`}
                {result.skipped === 0 && result.failed === 0 && 'Everything in the file was created.'}
              </p>
            </div>
          </div>

          {result.errors?.length > 0 && (
            <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-gray-200">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50 text-[11.5px] uppercase tracking-wide text-gray-400">
                  <tr><th className="px-3 py-2 text-left">Row</th><th className="px-3 py-2 text-left">Title</th><th className="px-3 py-2 text-left">Why</th></tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-400">{e.row ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{e.title || <span className="text-gray-300">(blank)</span>}</td>
                      <td className="px-3 py-2 text-gray-500">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={reset} className="btn-secondary">Import another file</button>
            <button onClick={close} className="btn-primary">Done</button>
          </div>
        </div>
      ) : !rows ? (
        /* ---- choose a file -------------------------------------------- */
        <div>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-gray-200 px-6 py-12 transition-colors hover:border-brand-400 hover:bg-brand-50/40"
          >
            <Upload className="h-7 w-7 text-gray-300" />
            <span className="text-[14.5px] font-semibold text-gray-700">Choose a spreadsheet</span>
            <span className="text-[13px] text-gray-400">.xlsx, .xls or .csv — the first sheet is used</span>
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                 onChange={e => e.target.files?.[0] && readFile(e.target.files[0])} />

          {parseError && (
            <p className="mt-3 flex items-start gap-2 text-[13px] text-fail-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />{parseError}
            </p>
          )}

          <div className="mt-5 rounded-lg bg-gray-50 px-4 py-3.5">
            <p className="text-[13px] text-gray-600">
              A <strong>Title</strong> column is the only one required. Steps can be a numbered or
              bulleted list, one per line, and <code className="rounded bg-white px-1 py-0.5 text-[12px]">-&gt;</code>{' '}
              separates a step from what should happen.
            </p>
            <button onClick={downloadTemplate}
                    className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 hover:text-brand-700">
              <Download className="h-3.5 w-3.5" />Download a template
            </button>
          </div>
        </div>
      ) : (
        /* ---- map and preview ------------------------------------------- */
        <div>
          <div className="flex items-center gap-2 text-[13.5px] text-gray-600">
            <FileSpreadsheet className="h-4 w-4 text-gray-400" />
            <span className="font-semibold text-gray-800">{fileName}</span>
            <span className="text-gray-400">· {rows.length} row{rows.length === 1 ? '' : 's'}</span>
            <button onClick={reset} className="ml-auto text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>

          <p className="mt-5 text-[13px] font-semibold text-gray-700">Match your columns</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {FIELDS.map(([field, label, required]) => (
              <label key={field} className="flex items-center gap-2 text-[13px]">
                <span className="w-32 flex-shrink-0 text-gray-600">
                  {label}{required && <span className="text-fail-500"> *</span>}
                </span>
                <select
                  className="input flex-1 py-1.5 text-[13px]"
                  value={mapping[field] || ''}
                  onChange={e => setMapping(m => ({ ...m, [field]: e.target.value || undefined }))}
                >
                  <option value="">— not imported —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>

          {!mapping.title && (
            <p className="mt-3 flex items-start gap-2 text-[13px] text-warn-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Choose which column holds the test case title — nothing can be imported without it.
            </p>
          )}
          {mapping.title && missingTitles > 0 && (
            <p className="mt-3 flex items-start gap-2 text-[13px] text-warn-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {missingTitles} row{missingTitles === 1 ? ' has' : 's have'} no title and will be skipped.
            </p>
          )}

          {mapping.title && (
            <>
              <p className="mt-5 text-[13px] font-semibold text-gray-700">
                Preview <span className="font-normal text-gray-400">· first {Math.min(5, withTitles.length)} of {withTitles.length}</span>
              </p>
              <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[520px] text-[12.5px]">
                  <thead className="sticky top-0 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Title</th>
                      <th className="px-3 py-2 text-left">Priority</th>
                      <th className="px-3 py-2 text-left">Steps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withTitles.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-800">{String(r.title).slice(0, 70)}</td>
                        <td className="px-3 py-2 text-gray-500">{r.priority || 'medium'}</td>
                        <td className="px-3 py-2 text-gray-500">
                          {r.steps ? `${String(r.steps).split(/\r?\n/).filter(Boolean).length} step(s)` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <label className="mt-4 flex items-center gap-2 text-[13px] text-gray-600">
            <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} />
            Skip rows whose title already exists in this project
          </label>

          {parseError && (
            <p className="mt-3 flex items-start gap-2 text-[13px] text-fail-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />{parseError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={close} className="btn-secondary">Cancel</button>
            <button onClick={submit} disabled={busy || !mapping.title || withTitles.length === 0}
                    className="btn-primary">
              {busy ? 'Importing…' : `Import ${withTitles.length} test case${withTitles.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
