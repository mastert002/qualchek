import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings2, ArrowLeft, Plus, Pencil, Trash2, Eye, EyeOff,
  Globe, KeyRound, CheckCircle2, X, Save,
} from 'lucide-react';
import api from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';

const EMPTY_FORM = {
  label: '', url_pattern: '', login_url: '',
  username: '', password: '', username_field: '', password_field: '',
};

function CredentialForm({ initial = EMPTY_FORM, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial);
  const [showPw, setShowPw] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(
    !!(initial.username_field || initial.password_field)
  );
  const isEdit = !!initial.id;

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <form
      onSubmit={e => { e.preventDefault(); onSave(form); }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Label</label>
          <input
            className="input"
            placeholder="e.g. Staging Admin, Prod Viewer"
            value={form.label}
            onChange={set('label')}
          />
          <p className="text-xs text-gray-400 mt-1">A friendly name so you know which account this is.</p>
        </div>

        <div className="col-span-2">
          <label className="label">URL Pattern *</label>
          <input
            className="input font-mono text-sm"
            placeholder="https://your-app.com"
            value={form.url_pattern}
            onChange={set('url_pattern')}
            required
          />
          <p className="text-xs text-gray-400 mt-1">
            The origin (e.g. <code>https://staging.myapp.com</code>) that this credential applies to.
            The crawler matches by domain when you start a crawl.
          </p>
        </div>

        <div className="col-span-2">
          <label className="label">Login Page URL</label>
          <input
            className="input font-mono text-sm"
            placeholder="https://your-app.com/login  (leave blank to auto-detect)"
            value={form.login_url}
            onChange={set('login_url')}
          />
        </div>

        <div>
          <label className="label">Username / Email *</label>
          <input
            className="input"
            placeholder="user@example.com"
            value={form.username}
            onChange={set('username')}
            required
          />
        </div>

        <div>
          <label className="label">
            Password *
            {isEdit && <span className="ml-1 text-xs font-normal text-gray-400">(blank = keep existing)</span>}
          </label>
          <div className="relative">
            <input
              className="input pr-10"
              type={showPw ? 'text' : 'password'}
              placeholder={isEdit ? '••••••••' : 'Enter password'}
              value={form.password}
              onChange={set('password')}
              required={!isEdit}
            />
            <button
              type="button"
              tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onClick={() => setShowPw(v => !v)}
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
        onClick={() => setShowAdvanced(v => !v)}
      >
        {showAdvanced ? '▾' : '▸'} Advanced: custom HTML field names
      </button>

      {showAdvanced && (
        <div className="grid grid-cols-2 gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div>
            <label className="label">Username field name</label>
            <input className="input font-mono text-sm" placeholder="email" value={form.username_field} onChange={set('username_field')} />
            <p className="text-xs text-gray-400 mt-1">HTML <code>name</code> attr — auto-detected if blank.</p>
          </div>
          <div>
            <label className="label">Password field name</label>
            <input className="input font-mono text-sm" placeholder="password" value={form.password_field} onChange={set('password_field')} />
            <p className="text-xs text-gray-400 mt-1">HTML <code>name</code> attr — auto-detected if blank.</p>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary">
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : isEdit ? 'Update' : 'Save Credential'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function CrawlerSettingsPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null); // credential id being edited

  const { data: credentials = [], isLoading } = useQuery({
    queryKey: ['crawler-credentials', projectId],
    queryFn: () => api.get(`/projects/${projectId}/crawl/credentials`).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: data => api.post(`/projects/${projectId}/crawl/credentials`, data),
    onSuccess: () => {
      qc.invalidateQueries(['crawler-credentials', projectId]);
      setShowAdd(false);
      toast.success('Credential saved');
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/projects/${projectId}/crawl/credentials/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries(['crawler-credentials', projectId]);
      setEditing(null);
      toast.success('Credential updated');
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/projects/${projectId}/crawl/credentials/${id}`),
    onSuccess: () => {
      qc.invalidateQueries(['crawler-credentials', projectId]);
      toast.success('Credential deleted');
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to delete'),
  });

  const handleDelete = async cred => {
    const ok = await confirm({
      title: 'Delete Credential',
      message: `Delete "${cred.label || cred.url_pattern}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) deleteMutation.mutate(cred.id);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/projects/${projectId}/crawler`} className="btn-ghost py-1.5 px-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-brand-600" />
            Crawler Credentials
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Save login credentials per URL. The crawler auto-selects the matching one when you start a crawl.
          </p>
        </div>
        {!showAdd && (
          <button onClick={() => { setShowAdd(true); setEditing(null); }} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Credential
          </button>
        )}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="card p-5 mb-5 border-brand-200 border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">New Credential</h2>
            <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <CredentialForm
            onSave={data => createMutation.mutate(data)}
            onCancel={() => setShowAdd(false)}
            saving={createMutation.isPending}
          />
        </div>
      )}

      {/* Credential list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-100" />)}
        </div>
      ) : credentials.length === 0 && !showAdd ? (
        <div className="card p-10 text-center text-gray-400">
          <KeyRound className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No credentials saved yet.</p>
          <p className="text-xs mt-1">Add one to let the crawler log in to authenticated pages automatically.</p>
          <button onClick={() => setShowAdd(true)} className="btn-primary mt-4 mx-auto">
            <Plus className="w-4 h-4" /> Add Credential
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {credentials.map(cred => (
            <div key={cred.id} className="card p-4">
              {editing === cred.id ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-700">Edit Credential</h2>
                    <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <CredentialForm
                    initial={{ ...cred, password: '' }}
                    onSave={data => updateMutation.mutate({ id: cred.id, ...data })}
                    onCancel={() => setEditing(null)}
                    saving={updateMutation.isPending}
                  />
                </>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Globe className="w-4 h-4 text-brand-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{cred.label || cred.url_pattern}</p>
                      <p className="text-xs text-gray-500 font-mono truncate mt-0.5">{cred.url_pattern}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          {cred.username}
                        </span>
                        <span className="flex items-center gap-1">
                          <KeyRound className="w-3 h-3 text-gray-400" />
                          Password saved
                        </span>
                        {cred.login_url && (
                          <span className="font-mono truncate max-w-[180px]" title={cred.login_url}>
                            login: {cred.login_url}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => { setEditing(cred.id); setShowAdd(false); }}
                      className="btn-ghost p-2"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(cred)}
                      className="btn-ghost p-2 text-gray-400 hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="mt-6 bg-brand-50 border border-brand-100 rounded-lg p-4 text-sm text-brand-800 space-y-1">
        <p className="font-semibold">How URL matching works</p>
        <ul className="list-disc list-inside space-y-0.5 text-brand-700 text-xs">
          <li>When you start a crawl, the crawler compares the target URL's domain against each saved credential's URL Pattern.</li>
          <li>The most specific matching credential is used automatically.</li>
          <li>Example: crawling <code>https://staging.myapp.com</code> will match a credential with pattern <code>https://staging.myapp.com</code>.</li>
          <li>Passwords are stored locally and never sent to external services.</li>
        </ul>
      </div>
    </div>
  );
}
