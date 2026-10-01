// Seat limits.
//
// Plans are priced by team size rather than per seat, so the cap is the thing
// being sold and has to actually hold. The limit lives on the workspace rather
// than being looked up from the plan each time: a workspace may be moved onto a
// bespoke arrangement, and the row should say what it is entitled to without a
// join that could silently disagree with what was agreed.
//
// Deactivated accounts do not count. They keep their history and cannot sign
// in, so charging a seat for one would mean paying to retain an audit trail.

const DEFAULT_CAP = 3;

/**
 * @returns {Promise<{allowed: boolean, used: number, cap: number}>}
 */
async function checkSeat(db, tenant) {
  const cap = Number(tenant && tenant.max_users) || DEFAULT_CAP;
  const row = await db.prepare(
    'SELECT COUNT(*)::int AS n FROM users WHERE is_active = TRUE'
  ).get();
  const used = Number(row && row.n) || 0;
  return { allowed: used < cap, used, cap };
}

/**
 * Express guard for routes that add a person. Returns 403 with the numbers in
 * it, because "you have reached your limit" without saying what the limit is
 * leaves somebody guessing whether to buy a bigger plan or deactivate a leaver.
 */
function seatMessage({ used, cap }) {
  return `Your plan covers ${cap} ${cap === 1 ? 'person' : 'people'} and ${used} `
    + `${used === 1 ? 'is' : 'are'} already active. Deactivate someone, or move to a larger plan.`;
}

module.exports = { checkSeat, seatMessage, DEFAULT_CAP };
