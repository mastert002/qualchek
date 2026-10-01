import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, MailCheck, ArrowLeft } from 'lucide-react';
import api from '../utils/api';

// Self-service password reset, for every account. The server answers the
// same way whether or not the address exists, and so does this page: it
// never confirms that an account was found.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      await api.post('/auth/forgot-password', { email });
    } catch {
      // The endpoint is designed never to fail visibly; if the network itself
      // drops, showing the same confirmation still leaks nothing.
    } finally {
      setSending(false);
      setSent(true);
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
          <p className="text-gray-500 mt-1">Reset your password</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">
              <MailCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Check your email</p>
                <p className="mt-1">
                  If an account exists for <span className="font-medium">{email}</span>, we've sent a link
                  to choose a new password. It works once and expires in 1 hour.
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-400 text-center">
              Nothing arrived? Check your spam folder, or make sure you used the address your account was created with.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter the email address for your account and we'll send you a link to choose a new password.
            </p>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
                autoComplete="email"
                required
              />
            </div>
            <button type="submit" disabled={sending || !email.trim()} className="btn-primary w-full justify-center py-2.5">
              {sending ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}

        <Link to="/login" className="mt-6 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>
      </div>
    </div>
  );
}
