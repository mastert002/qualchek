import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ClipboardCheck, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import api from '../utils/api';
import { setToken } from '../utils/token';

// Landing page for an emailed invite. Deliberately NOT wrapped in PublicRoute:
// that redirects anyone already signed in, which would stop an admin opening a
// link to check it, and would bounce a user who still has an old session.
export default function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [checking, setChecking] = useState(true);
  const [invitee, setInvitee] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Validate before showing the form, so a dead link says so immediately
  // rather than after the user has chosen a password.
  useEffect(() => {
    if (!token) {
      setError('This link is missing its token. Please use the link from your email.');
      setChecking(false);
      return;
    }
    api.get(`/auth/invite/verify?token=${encodeURIComponent(token)}`)
      .then(r => setInvitee(r.data))
      .catch(e => setError(e.response?.data?.error || 'This link is invalid, expired, or already used.'))
      .finally(() => setChecking(false));
  }, [token]);

  const submit = async e => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');

    setSaving(true);
    try {
      const { data } = await api.post('/auth/invite/accept', { token, password });
      setToken(data.token);
      // Full navigation rather than client-side routing: it remounts
      // AuthProvider, which reads the new token and loads the session cleanly.
      window.location.href = '/projects';
    } catch (err) {
      setError(err.response?.data?.error || 'Could not set your password.');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-brand-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-600 mb-4">
            <ClipboardCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">QualChek</h1>
          <p className="text-gray-500 mt-1">
            {invitee
              ? (invitee.mode === 'reset' ? 'Choose a new password' : 'Choose a password to activate your account')
              : 'Set your password'}
          </p>
        </div>

        {checking && (
          <div className="flex items-center justify-center gap-2 text-gray-500 text-sm py-6">
            <Loader className="w-4 h-4 animate-spin" /> Checking your link...
          </div>
        )}

        {!checking && error && !invitee && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              {error}
              <div className="mt-2 text-red-600">
                Request a new link from the sign-in page with <Link to="/forgot-password" className="underline">Forgot your password?</Link>,
                or ask an administrator to resend your invite.
              </div>
            </div>
          </div>
        )}

        {!checking && invitee && (
          <>
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 mb-4 text-sm">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>{invitee.mode === 'reset' ? 'Resetting' : 'Setting'} the password for <span className="font-medium">{invitee.email}</span></span>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label">New Password</label>
                <PasswordInput
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="label">Confirm Password</label>
                <PasswordInput
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-full justify-center py-2.5">
                {saving ? 'Saving...' : (invitee.mode === 'reset' ? 'Reset password and sign in' : 'Set password and sign in')}
              </button>
            </form>

            <p className="text-xs text-gray-400 mt-4 text-center">
              This link works once. After you set your password it stops working.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
