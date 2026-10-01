import { useQuery } from '@tanstack/react-query';
import { Clock, Lock } from 'lucide-react';
import api from '../utils/api';

// How many days left before it is worth saying anything. Counting down from
// fourteen is nagging; the last stretch is information.
const NOTICE_FROM_DAYS = 7;

function daysLeft(trialEndsAt) {
  if (!trialEndsAt) return null;
  return Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000);
}

/**
 * The state of the workspace's subscription, shown only when it affects what
 * the person can do. A paid workspace shows nothing at all.
 */
export default function TrialBanner() {
  const { data } = useQuery({
    queryKey: ['workspace'],
    queryFn: () => api.get('/auth/workspace').then(r => r.data),
    // The trial does not change minute to minute, and this renders on every
    // page - refetching on each mount would be noise.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!data) return null;
  if (data.status !== 'trial' && data.status !== 'past_due') return null;

  const left = daysLeft(data.trial_ends_at);
  const expired = data.status === 'past_due' || (left !== null && left <= 0);

  if (expired) {
    return (
      <div className="flex items-center gap-2.5 border-b border-warn-500/25 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
        <Lock className="w-4 h-4 flex-shrink-0" />
        <span className="font-semibold">
          {data.status === 'past_due' ? 'Payment overdue' : 'Your trial has ended'}
        </span>
        <span className="text-ink-600">
          — this workspace is read-only. Everything you created is still here.
        </span>
        <a href="/billing" className="ml-auto font-semibold text-brand-700 hover:underline whitespace-nowrap">
          Choose a plan
        </a>
      </div>
    );
  }

  if (left === null || left > NOTICE_FROM_DAYS) return null;

  return (
    <div className="flex items-center gap-2.5 border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] text-brand-800">
      <Clock className="w-4 h-4 flex-shrink-0" />
      <span>
        <span className="font-semibold">{left} {left === 1 ? 'day' : 'days'} left</span> of your trial.
      </span>
      <a href="/billing" className="ml-auto font-semibold text-brand-700 hover:underline whitespace-nowrap">
        Choose a plan
      </a>
    </div>
  );
}
