// Refresh tokens: the durable half of a session.
//
// The access token is now short-lived (15 minutes), which is only useful if
// something can quietly replace it. That something is this: a random secret
// held in an httpOnly cookie, exchanged at /api/auth/refresh for a new access
// token and a new refresh token.
//
// Three properties matter here, and each one is a deliberate choice:
//
//   1. It is a random secret, not a JWT. There are no claims to read, nothing
//      to decode, and it cannot be forged from JWT_SECRET alone. Its only
//      meaning is "this row exists in the database and is not revoked", which
//      is precisely what a JWT could never give us: real revocation.
//
//   2. Only the SHA-256 is stored. A leaked database dump cannot be replayed
//      against the API. No salt or bcrypt: the token is 32 random bytes, so
//      there is no dictionary to attack and a fast hash is the right choice.
//
//   3. Every use rotates it, and reusing a spent token revokes the whole
//      family. See rotate() below - this is what turns a stolen refresh token
//      from silent permanent access into a detectable event.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb, nowISO } = require('../db/database');

// How long a session can live before the user must sign in again, regardless
// of activity. The cookie is session-scoped so it normally dies with the
// browser first; this is the backstop for a browser left open for days.
const REFRESH_TTL_HOURS = Number(process.env.REFRESH_TTL_HOURS || 12);

const sha256 = raw => crypto.createHash('sha256').update(raw).digest('hex');

const mint = () => crypto.randomBytes(32).toString('base64url');

/**
 * Create a refresh token for a user and return the raw value, which is the
 * only moment it exists in plaintext anywhere.
 *
 * @param {string} userId
 * @param {string} [familyId] continue an existing rotation family; a new
 *   family is started when omitted (i.e. at sign-in).
 */
async function issue(userId, familyId = uuidv4()) {
  const db = getDb();
  const raw = mint();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_HOURS * 3600 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, familyId, sha256(raw), expiresAt, nowISO());
  return raw;
}

/**
 * Exchange a refresh token for a fresh one, enforcing single use.
 *
 * Returns { userId, raw } on success. Throws on any failure, deliberately
 * without distinguishing the reasons to the caller: expired, unknown and
 * replayed all look identical from outside, so nothing can be probed.
 */
async function rotate(rawToken) {
  const db = getDb();
  const row = await db.prepare(
    `SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?`
  ).get(sha256(rawToken || ''));

  if (!row) throw new Error('unknown refresh token');

  // Reuse detection. A refresh token is single-use, so a second presentation
  // of one already spent means two parties hold it - the legitimate user and
  // someone who copied it. We cannot tell which one is calling now, so we end
  // the whole family and make both sign in again. Losing one session is the
  // correct price for closing a live compromise.
  if (row.revoked_at) {
    await revokeFamily(row.family_id);
    throw new Error('refresh token reused');
  }

  if (new Date(row.expires_at) <= new Date()) throw new Error('refresh token expired');

  await db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?`).run(nowISO(), row.id);
  const raw = await issue(row.user_id, row.family_id);
  return { userId: row.user_id, raw };
}

async function revokeFamily(familyId) {
  const db = getDb();
  await db.prepare(
    `UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`
  ).run(nowISO(), familyId);
}

/** Every session for this user, everywhere. Used on sign-out and whenever a
 *  password changes - that is the self-service kill switch the app lacked. */
async function revokeAllForUser(userId) {
  const db = getDb();
  await db.prepare(
    `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`
  ).run(nowISO(), userId);
}

/** Revoke just the session this token belongs to, leaving the user's other
 *  browsers signed in. Silent when the token is unknown: signing out must
 *  always appear to succeed. */
async function revokeByToken(rawToken) {
  if (!rawToken) return;
  const db = getDb();
  const row = await db.prepare(
    `SELECT family_id FROM refresh_tokens WHERE token_hash = ?`
  ).get(sha256(rawToken));
  if (row) await revokeFamily(row.family_id);
}

/** Spent and expired rows accumulate; nothing reads them after their family
 *  is closed. Called opportunistically on sign-in rather than on a schedule,
 *  because a serverless deployment has nowhere to run a cron. */
async function prune() {
  const db = getDb();
  await db.prepare(
    `DELETE FROM refresh_tokens WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`
  ).run(nowISO(), new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
}

module.exports = {
  issue, rotate, revokeFamily, revokeAllForUser, revokeByToken, prune, sha256,
  REFRESH_TTL_HOURS,
};
