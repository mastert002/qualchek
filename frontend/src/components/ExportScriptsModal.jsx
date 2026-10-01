import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Download, Code2, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, Copy, CopyCheck } from 'lucide-react';
import api from '../utils/api';

const FRAMEWORKS = [
  {
    id: 'playwright',
    label: 'Playwright',
    lang: 'JavaScript',
    ext: '.spec.js',
    color: 'bg-green-50 border-green-300 text-green-800',
    activeColor: 'bg-green-600 text-white border-green-600',
    badge: 'bg-green-100 text-green-700',
    description: 'Microsoft Playwright — modern, fast, cross-browser. Recommended for new projects.',
    install: 'npm init playwright@latest',
    run: 'npx playwright test',
  },
  {
    id: 'cypress',
    label: 'Cypress',
    lang: 'JavaScript',
    ext: '.cy.js',
    color: 'bg-brand-50 border-brand-300 text-brand-800',
    activeColor: 'bg-brand-600 text-white border-brand-600',
    badge: 'bg-brand-100 text-brand-700',
    description: 'Cypress — developer-friendly, great for web apps, built-in test runner UI.',
    install: 'npm install cypress --save-dev',
    run: 'npx cypress run',
  },
  {
    id: 'pytest',
    label: 'Pytest',
    lang: 'Python',
    ext: '.py',
    color: 'bg-yellow-50 border-yellow-300 text-yellow-800',
    activeColor: 'bg-yellow-500 text-white border-yellow-500',
    badge: 'bg-yellow-100 text-yellow-700',
    description: 'Pytest + Playwright for Python — ideal for Python teams and backend-heavy projects.',
    install: 'pip install pytest pytest-playwright && playwright install',
    run: 'pytest --headed',
  },
];

export default function ExportScriptsModal({ projectId, selectedIds, allCases, onClose }) {
  const [framework, setFramework] = useState('playwright');
  const [showPreview, setShowPreview] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const fw = FRAMEWORKS.find(f => f.id === framework);
  const count = selectedIds.length;

  const exportMutation = useMutation({
    mutationFn: ({ fw, markAutomated }) =>
      api.post(`/projects/${projectId}/scripts/export`, {
        test_case_ids: selectedIds,
        framework: fw,
        mark_automated: markAutomated,
      }).then(r => r.data),
    onSuccess: data => setResult(data),
  });

  const handleExport = () => exportMutation.mutate({ fw: framework, markAutomated: true });

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedTitles = allCases.filter(c => selectedIds.includes(c.id)).map(c => c.title);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">Export Automation Scripts</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {!result ? (
            <>
              {/* Selected test cases summary */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  {count} test case{count !== 1 ? 's' : ''} selected
                </p>
                <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                  {selectedTitles.map((t, i) => (
                    <li key={i} className="text-xs text-gray-500 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Framework selector */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-3">Choose framework</p>
                <div className="space-y-2">
                  {FRAMEWORKS.map(f => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFramework(f.id)}
                      className={`w-full text-left border rounded-lg p-3 transition-colors ${
                        framework === f.id
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                            framework === f.id ? 'border-brand-500 bg-brand-500' : 'border-gray-300'
                          }`} />
                          <span className="font-medium text-sm text-gray-900">{f.label}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${f.badge}`}>{f.lang}{f.ext}</span>
                        </div>
                        {framework === f.id && (
                          <CheckCircle2 className="w-4 h-4 text-brand-600" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 ml-6">{f.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Setup instructions */}
              {fw && (
                <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-300 space-y-1">
                  <p className="text-gray-500"># Setup</p>
                  <p className="text-green-400">{fw.install}</p>
                  <p className="text-gray-500 mt-2"># Run tests</p>
                  <p className="text-green-400">{fw.run}</p>
                </div>
              )}

              {exportMutation.isError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {exportMutation.error?.response?.data?.error || 'Export failed'}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Success state */}
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-800">Scripts generated</p>
                  <p className="text-xs text-green-700">
                    {result.test_cases_exported} test case{result.test_cases_exported !== 1 ? 's' : ''} exported as{' '}
                    <code className="font-mono bg-green-100 px-1 rounded">{result.filename}</code>
                    {' '}— test cases marked as Automated in your project.
                  </p>
                </div>
              </div>

              {/* Preview toggle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Script preview</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleCopy}
                      className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
                    >
                      {copied ? <CopyCheck className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      onClick={() => setShowPreview(v => !v)}
                      className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
                    >
                      {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {showPreview ? 'Hide' : 'Show'} preview
                    </button>
                  </div>
                </div>
                {showPreview && (
                  <pre className="bg-gray-900 text-gray-200 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto leading-relaxed whitespace-pre">
                    {result.content}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result ? (
            <button
              onClick={handleExport}
              disabled={exportMutation.isPending || count === 0}
              className="btn-primary"
            >
              {exportMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                : <><Code2 className="w-4 h-4" /> Generate Scripts</>
              }
            </button>
          ) : (
            <button onClick={handleDownload} className="btn-primary">
              <Download className="w-4 h-4" />
              Download {result.filename}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
