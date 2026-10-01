import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Trash2, Edit2, Shield, ShieldOff, User, Eye, KeyRound, AlertCircle, CheckCircle, FolderOpen, Mail, Ban, RotateCcw, Loader } from 'lucide-react';
import api from '../utils/api';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { fmtDate } from '../utils/helpers';
import { useRole } from '../hooks/useRole';
import { Navigate } from 'react-router-dom';

const ROLE_COLORS = {
  admin:  'bg-purple-100 text-purple-700',
  tester: 'bg-brand-100 text-brand-700',
  viewer: 'bg-gray-100 text-gray-700',
};
const ROLE_ICONS = { admin: Shield, tester: User, viewer: Eye };

const BLANK_USER = { name: '', email: '', password: '', role: 'tester', projectIds: [] };

export default function UsersPage() {
  const { user: me } = useAuth();
  const { isAdmin, isSuperAdmin } = useRole();
  const qc = useQueryClient();

  // Non-admins cannot access this page
  if (!isAdmin) return <Navigate to="/projects" replace />;

  const [modal, setModal]       = useState(null);   // 'create' | 'edit' | 'delete'
  const [target, setTarget]     = useState(null);
  const [form, setForm]         = useState(BLANK_USER);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  // Which row is mid-request, so its button can show progress. Sending through
  // Gmail takes a second or two and must be awaited (a serverless function can
  // freeze the moment it responds), so the wait is real - show it.
  const [busyId, setBusyId]     = useState(null);
  const successTimer = useRef(null);

  // 10s rather than 4s, and cancels any previous timer so rapid actions do not
  // cut the newest message short.
  function flash(message) {
    setSuccess(message);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccess(''), 10000);
  }

  // Only testers are scoped by membership: the API gives admins and viewers
  // every project regardless, so the picker is only meaningful for testers.
  const [originalProjectIds, setOriginalProjectIds] = useState([]);
  const prefilled = useRef(false);

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects').then(r => r.data),
    enabled: modal === 'create' || modal === 'edit',
  });

  // Never serve this from cache. It seeds the checkboxes AND the baseline the
  // save diff is computed against, so stale data would show the wrong access
  // and could revoke or grant the wrong projects. gcTime 0 drops it as soon as
  // the modal closes, forcing a fresh read every time it is opened.
  const { data: userProjects = [] } = useQuery({
    queryKey: ['user-projects', target?.id],
    queryFn: () => api.get(`/auth/users/${target.id}/projects`).then(r => r.data),
    enabled: modal === 'edit' && !!target?.id,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  // Seed the checkboxes from current membership once per open, not on every
  // refetch — otherwise a background refresh would discard in-progress edits.
  useEffect(() => {
    if (modal === 'edit' && userProjects.length && !prefilled.current) {
      prefilled.current = true;
      const ids = userProjects.filter(p => p.member_role).map(p => p.id);
      setOriginalProjectIds(ids);
      setForm(f => ({ ...f, projectIds: ids }));
    }
  }, [modal, userProjects]);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/auth/users').then(r => r.data),
  });

  // ── Create ──────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      const { name, email, role } = form;
      // No password is sent: the backend issues an invite when it is absent.
      const res = await api.post('/auth/register', { name, email, role });
      if (role === 'tester') {
        for (const pid of form.projectIds) {
          await api.put(`/auth/users/${res.data.user.id}/projects/${pid}`, { action: 'add', role: 'tester' });
        }
      }
      return res;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      closeModal();
      const created = res.data.user?.name;
      flash(res.data.invite?.delivered
        ? `Invite emailed to ${res.data.user?.email}`
        : `User "${created}" created, but no invite email was sent — email is not configured yet.`);
    },
    onError: e => setError(e.response?.data?.error || 'Failed to create user'),
  });

  // ── Update ──────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: async () => {
      const { name, email, role } = form;
      // Admins no longer set passwords; only the invite link can.
      await api.put(`/auth/users/${target.id}`, { name, email, role });
      if (role === 'tester') {
        const toAdd = form.projectIds.filter(id => !originalProjectIds.includes(id));
        const toRemove = originalProjectIds.filter(id => !form.projectIds.includes(id));
        for (const pid of toAdd) await api.put(`/auth/users/${target.id}/projects/${pid}`, { action: 'add', role: 'tester' });
        for (const pid of toRemove) await api.put(`/auth/users/${target.id}/projects/${pid}`, { action: 'remove' });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user-projects', target.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      const name = form.name || target.name;
      closeModal();
      flash(`User "${name}" updated successfully`);
    },
    onError: e => setError(e.response?.data?.error || 'Failed to update user'),
  });

  // ── Delete ──────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/auth/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      const name = target.name;
      closeModal();
      flash(`User "${name}" deleted successfully`);
    },
    onError: e => setError(e.response?.data?.error || 'Failed to delete user'),
  });

  function openCreate() {
    prefilled.current = false;
    setOriginalProjectIds([]);
    setForm(BLANK_USER);
    setError('');
    setModal('create');
  }

  function openEdit(u) {
    prefilled.current = false;
    setOriginalProjectIds([]);
    setTarget(u);
    setForm({ name: u.name, email: u.email, password: '', role: u.role, projectIds: [] });
    setError('');
    setModal('edit');
  }

  // Re-issue a set-password link. This is the recovery path now that admins
  // cannot set a password directly. When email is not configured the link is
  // returned so it can be passed on by hand.
  const [inviteLink, setInviteLink] = useState(null);

  async function toggleSuperAdmin(u) {
    setError('');
    try {
      const next = !u.is_super_admin;
      await api.put(`/auth/users/${u.id}/super-admin`, { super: next });
      qc.invalidateQueries({ queryKey: ['users'] });
      flash(next ? `${u.name} is now a super admin` : `${u.name} is no longer a super admin`);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not change super admin status');
    }
  }

  async function toggleActive(u) {
    setError('');
    try {
      const next = u.is_active === false;      // reactivating if currently off
      await api.put(`/auth/users/${u.id}/active`, { active: next });
      qc.invalidateQueries({ queryKey: ['users'] });
      flash(next ? `${u.name} reactivated` : `${u.name} deactivated — they can no longer sign in`);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not change the account status');
    }
  }

  async function resendInvite(u) {
    setError('');
    setInviteLink(null);
    setBusyId(u.id);
    try {
      const { data } = await api.post(`/auth/users/${u.id}/invite`);
      if (data.invite?.delivered) {
        flash(`Invite emailed to ${u.email}`);
      } else {
        setInviteLink({ email: u.email, link: data.invite?.link });
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Could not send the invite');
    } finally {
      setBusyId(null);
    }
  }

  function openDelete(u) {
    setTarget(u);
    setError('');
    setModal('delete');
  }

  function closeModal() {
    setModal(null);
    setTarget(null);
    setError('');
  }

  const field = (key, label, type = 'text', placeholder = '') => (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        type={type}
        placeholder={placeholder}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );


  // Project access. Admins and viewers are granted every project by the API
  // (see projects.js), so a picker there would be misleading — explain instead.
  const projectPicker = () => {
    if (form.role === 'admin') return (
      <div className="flex gap-2 rounded-lg bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">
        <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Admins have full access to every project. Nothing to assign.</span>
      </div>
    );
    if (form.role === 'viewer') return (
      <div className="flex gap-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700">
        <Eye className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Viewers can see every project, read-only. Nothing to assign.</span>
      </div>
    );
    return (
      <div>
        <label className="label flex items-center gap-1">
          <FolderOpen className="w-3.5 h-3.5" /> Project Access
          <span className="text-gray-400 font-normal">(testers only see what you select)</span>
        </label>
        {allProjects.length === 0 ? (
          <p className="text-sm text-gray-500">No projects exist yet.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg divide-y max-h-44 overflow-y-auto">
            {allProjects.map(p => (
              <label key={p.id} className="flex items-center gap-2.5 p-2.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  className="flex-shrink-0"
                  checked={form.projectIds.includes(p.id)}
                  onChange={e => setForm(f => ({
                    ...f,
                    projectIds: e.target.checked
                      ? [...f.projectIds, p.id]
                      : f.projectIds.filter(x => x !== p.id),
                  }))}
                />
                <span className="truncate">{p.name}</span>
              </label>
            ))}
          </div>
        )}
        {allProjects.length > 0 && form.projectIds.length === 0 && (
          <p className="text-xs text-amber-600 mt-1.5">
            No projects selected — this tester will sign in to an empty workspace.
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500 mt-1">{users.length} registered user(s)</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <UserPlus className="w-4 h-4" /> New User
        </button>
      </div>

      {success && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm mb-4">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{success}</span>
          <button onClick={() => setSuccess('')} className="text-green-500 hover:text-green-700 px-1" title="Dismiss">&times;</button>
        </div>
      )}

      {inviteLink && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm mb-4">
          <div className="flex items-start gap-2 text-amber-800">
            <Mail className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Email is not configured, so nothing was sent.</p>
              <p className="mt-0.5">Send this link to {inviteLink.email} yourself:</p>
              <input
                className="input mt-2 text-xs"
                readOnly
                value={inviteLink.link || ''}
                onFocus={e => e.target.select()}
              />
            </div>
            <button onClick={() => setInviteLink(null)} className="text-amber-500 hover:text-amber-700">&times;</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="divide-y">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-gray-200 rounded w-40" />
                  <div className="h-3 bg-gray-100 rounded w-56" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-4 font-medium text-gray-600">User</th>
                <th className="text-left p-4 font-medium text-gray-600">Email</th>
                <th className="text-left p-4 font-medium text-gray-600">Role</th>
                <th className="text-left p-4 font-medium text-gray-600 hidden sm:table-cell">Created</th>
                <th className="w-24 p-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => {
                const RoleIcon = ROLE_ICONS[u.role] || User;
                return (
                  <tr key={u.id} className="hover:bg-gray-50 group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {u.name?.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900">
                          {u.name}
                          {u.id === me?.id && <span className="ml-1 text-xs text-gray-400">(you)</span>}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-gray-600">{u.email}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`badge ${ROLE_COLORS[u.role]} flex items-center gap-1 w-fit`}>
                          <RoleIcon className="w-3 h-3" />{u.role}
                        </span>
                        {u.is_super_admin && (
                          <span className="badge bg-pass-50 text-pass-500 flex items-center gap-1 w-fit">
                            <Shield className="w-3 h-3" />super admin
                          </span>
                        )}
                        {u.is_active === false && (
                          <span className="badge bg-amber-100 text-amber-700 flex items-center gap-1 w-fit">
                            <Ban className="w-3 h-3" />deactivated
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-gray-500 hidden sm:table-cell">{fmtDate(u.created_at)}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-1 justify-end">
                        {isSuperAdmin && u.role === 'admin' && u.id !== me?.id && (
                          <button
                            onClick={() => toggleSuperAdmin(u)}
                            title={u.is_super_admin ? 'Remove super admin' : 'Make super admin'}
                            className={`p-1.5 rounded ${u.is_super_admin
                              ? 'text-pass-500 hover:text-gray-600 hover:bg-gray-100'
                              : 'text-gray-400 hover:text-pass-500 hover:bg-pass-50'}`}
                          >
                            {u.is_super_admin
                              ? <ShieldOff className="w-3.5 h-3.5" />
                              : <Shield className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {(u.role !== 'admin' || isSuperAdmin || u.id === me?.id) && (
                          <button
                            onClick={() => openEdit(u)}
                            title="Edit user"
                            className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {u.id !== me?.id && (u.role !== 'admin' || isSuperAdmin) && (
                          <button
                            onClick={() => toggleActive(u)}
                            title={u.is_active === false ? 'Reactivate account' : 'Deactivate account'}
                            className={`p-1.5 rounded ${u.is_active === false
                              ? 'text-green-500 hover:text-green-700 hover:bg-green-50'
                              : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'}`}
                          >
                            {u.is_active === false
                              ? <RotateCcw className="w-3.5 h-3.5" />
                              : <Ban className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {u.id !== me?.id && (u.role !== 'admin' || isSuperAdmin) && (
                          <button
                            onClick={() => resendInvite(u)}
                            disabled={busyId === u.id}
                            title={busyId === u.id ? 'Sending invite...' : 'Resend invite / password link'}
                            className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded disabled:opacity-100"
                          >
                            {busyId === u.id
                              ? <Loader className="w-3.5 h-3.5 animate-spin text-brand-600" />
                              : <Mail className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {u.id !== me?.id && (u.role !== 'admin' || isSuperAdmin) && !u.is_super_admin && (
                          <button
                            onClick={() => openDelete(u)}
                            title="Delete user"
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create Modal ── */}
      {modal === 'create' && (
        <Modal title="Create New User" onClose={closeModal} size="sm">
          <div className="space-y-4">
            {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
            {field('name', 'Full Name *')}
            {field('email', 'Email *', 'email')}
            <p className="flex items-start gap-2 rounded-lg bg-brand-50 border border-brand-200 p-3 text-sm text-brand-800">
              <Mail className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                We&apos;ll email {form.email || 'them'} a link to choose their own password.
                You never set it.
              </span>
            </p>
            <div>
              <label className="label">Role *</label>
              <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="viewer">Viewer — read only</option>
                <option value="tester">Tester — create &amp; execute tests</option>
                <option value="admin">Admin — full access</option>
              </select>
            </div>
            {projectPicker()}
            <div className="flex gap-2 pt-1">
              <button onClick={() => createMutation.mutate()} disabled={!form.name || !form.email || createMutation.isPending} className="btn-primary">
                {createMutation.isPending ? 'Creating...' : 'Create User'}
              </button>
              <button onClick={closeModal} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit Modal ── */}
      {modal === 'edit' && target && (
        <Modal title={`Edit — ${target.name}`} onClose={closeModal} size="sm">
          <div className="space-y-4">
            {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
            {field('name', 'Full Name')}
            {field('email', 'Email', 'email')}
            <div>
              <label className="label">Role</label>
              {target.is_super_admin ? (
                <>
                  <select className="input bg-gray-50 text-gray-500" value="super" disabled>
                    <option value="super">Super admin</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1.5">
                    Remove super admin status on their row before changing this role.
                  </p>
                </>
              ) : target.id === me?.id ? (
                <>
                  <select className="input bg-gray-50 text-gray-500" value={form.role} disabled>
                    <option value="viewer">Viewer</option>
                    <option value="tester">Tester</option>
                    <option value="admin">Admin</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1.5">
                    You cannot change your own role. Another admin must do it.
                  </p>
                </>
              ) : (
                <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="viewer">Viewer</option>
                  <option value="tester">Tester</option>
                  <option value="admin">Admin</option>
                </select>
              )}
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600">
              <KeyRound className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Passwords are set by the user, never by an admin. If they are locked
                out, use <span className="font-medium">Resend invite</span> on their row
                to send a fresh link.
              </span>
            </p>
            {projectPicker()}
            <div className="flex gap-2 pt-1">
              <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="btn-primary">
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={closeModal} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirm Modal ── */}
      {modal === 'delete' && target && (
        <Modal title="Delete User" onClose={closeModal} size="sm">
          <div className="space-y-4">
            {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
            <p className="text-gray-700">
              Are you sure you want to delete <span className="font-semibold">{target.name}</span> (<span className="text-gray-500">{target.email}</span>)?
            </p>
            <p className="text-sm text-red-600">This cannot be undone. The user will be removed from all projects.</p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => deleteMutation.mutate(target.id)} disabled={deleteMutation.isPending} className="btn-danger">
                {deleteMutation.isPending ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button onClick={closeModal} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
