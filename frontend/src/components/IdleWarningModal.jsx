import { Clock } from 'lucide-react';

// Shown in the final minutes before an idle session ends. It exists so nobody
// loses half-written test notes to a silent logout - the countdown is explicit
// and staying signed in takes one click.
export default function IdleWarningModal({ secondsLeft, onStay, onSignOut }) {
  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
      aria-describedby="idle-desc"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 text-amber-600" />
          </div>
          <div className="min-w-0">
            <h2 id="idle-title" className="text-lg font-semibold text-gray-900">
              Still there?
            </h2>
            <p id="idle-desc" className="text-sm text-gray-600 mt-1">
              You'll be signed out in{' '}
              <span className="font-semibold text-gray-900 tabular-nums">
                {mins}:{secs}
              </span>{' '}
              because of inactivity. Anything you haven't saved will be lost.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onSignOut} className="btn-ghost">Sign out now</button>
          <button onClick={onStay} className="btn-primary" autoFocus>Stay signed in</button>
        </div>
      </div>
    </div>
  );
}
