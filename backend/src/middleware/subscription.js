// What a workspace may do, given the state of its subscription.
//
// An expired trial goes read-only rather than locking the door. The data is
// theirs, they can still see it, export it and show it to whoever signs off the
// purchase - and the thing they cannot do is add more. Locking people out of
// their own test cases to encourage a payment tends to produce a cancellation
// and a bad word rather than a sale.
//
// Runs after authenticate(), which has already put the workspace on req.tenant.

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Still reachable when read-only, because they are how somebody leaves, pays,
// or keeps their session alive - refusing them would trap the user.
const ALWAYS_ALLOWED = [
  /^\/api\/auth\/logout$/,
  /^\/api\/auth\/refresh$/,
  /^\/api\/auth\/me\b/,
  /^\/api\/billing\b/,
];

/** Days remaining, rounded up, or null when there is no trial running. */
function trialDaysLeft(tenant) {
  if (!tenant || !tenant.trial_ends_at) return null;
  const ms = new Date(tenant.trial_ends_at).getTime() - Date.now();
  return Math.ceil(ms / 86400_000);
}

function isTrialExpired(tenant) {
  if (!tenant || tenant.status !== 'trial') return false;
  if (!tenant.trial_ends_at) return false;
  return new Date(tenant.trial_ends_at).getTime() <= Date.now();
}

function enforceSubscription(req, res, next) {
  const tenant = req.tenant;
  if (!tenant) return next();           // unauthenticated routes handle themselves

  // Suspension is an administrative action rather than a billing state, so it
  // stops everything.
  if (tenant.status === 'suspended') {
    return res.status(403).json({
      error: 'This workspace has been suspended.',
      workspace_status: 'suspended',
    });
  }

  const expired = isTrialExpired(tenant) || tenant.status === 'past_due';
  if (!expired) return next();

  if (READ_METHODS.has(req.method)) return next();
  if (ALWAYS_ALLOWED.some(re => re.test(req.originalUrl || req.url))) return next();

  // 402 rather than 403: this is not "you may not", it is "not until you pay",
  // and the client renders a different thing for each.
  return res.status(402).json({
    error: tenant.status === 'past_due'
      ? 'Payment is overdue, so this workspace is read-only. Update your billing details to continue.'
      : 'Your trial has ended, so this workspace is read-only. Choose a plan to continue adding and editing.',
    workspace_status: tenant.status === 'past_due' ? 'past_due' : 'trial_expired',
    read_only: true,
  });
}

module.exports = { enforceSubscription, trialDaysLeft, isTrialExpired };
