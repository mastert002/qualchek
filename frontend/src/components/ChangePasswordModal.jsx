import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import Modal from './Modal';
import PasswordInput from './PasswordInput';
import api from '../utils/api';
import { useToast } from '../context/ToastContext';

// Self-service password change. Only rendered for super admins - the
// sidebar gates the button - and the backend enforces the same rule.
export default function ChangePasswordModal({ onClose }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Mirror the server's rules so the obvious mistakes are caught before a
  // round trip; the server still checks everything.
  const validate = () => {
    if (!current) return 'Enter your current password';
    if (next.length < 8) return 'New password must be at least 8 characters';
    if (next === current) return 'New password must be different from the current one';
    if (next !== confirm) return 'New passwords do not match';
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError('');
    setSaving(true);
    try {
      await api.put('/auth/me/password', { current_password: current, new_password: next });
      toast.success('Your password has been changed', 'Password Updated');
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Change Password" onClose={onClose} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Current password</label>
          <PasswordInput value={current} onChange={e => setCurrent(e.target.value)} autoFocus required autoComplete="current-password" />
        </div>
        <div>
          <label className="label">New password</label>
          <PasswordInput value={next} onChange={e => setNext(e.target.value)} placeholder="At least 8 characters" required autoComplete="new-password" />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <PasswordInput value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
