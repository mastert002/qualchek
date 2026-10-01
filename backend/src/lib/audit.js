// Audit trail.
//
// Two rules shape this file:
//
// 1. Recording must NEVER break the action being recorded. Every write is
//    wrapped so a failed insert logs a warning and nothing more — an audit
//    problem must not stop someone signing in or deleting a stale record.
//
// 2. Actor and target are DENORMALISED (name/email/label copied in, not
//    joined). The whole point is to answer "who deleted this user?", and a
//    join cannot answer that once the row is gone. Storing the text keeps the
//    history readable after the people and objects in it are deleted.

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');

/** Best-effort client IP, allowing for Vercel's proxy. */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || null;
}

/**
 * Write one audit entry. Never throws.
 *
 * @param req              the request, for actor (req.user) and IP
 * @param action           dotted verb, e.g. 'user.deleted'
 * @param target           { type, id, label } — label is denormalised on purpose
 * @param detail           optional plain object with extra context
 * @param actorOverride    for events with no req.user yet (e.g. a failed login)
 */
async function record(req, action, target = {}, detail = null, actorOverride = null) {
  try {
    const actor = actorOverride || req?.user || {};
    await getDb()
      .prepare(
        `INSERT INTO audit_log
           (id, at, actor_id, actor_name, actor_email, action, target_type, target_id, target_label, detail, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uuidv4(),
        new Date().toISOString(),
        actor.id || null,
        actor.name || null,
        actor.email || null,
        action,
        target.type || null,
        target.id || null,
        target.label || null,
        detail ? JSON.stringify(detail) : null,
        req ? clientIp(req) : null
      );
  } catch (err) {
    console.warn(`[audit] could not record ${action}: ${err.message}`);
  }
}

/**
 * Describe what actually changed on an update, so the log says
 * "role: tester -> admin" rather than just "user.updated".
 * Returns null when nothing of interest changed.
 */
function diff(before, after, fields) {
  const changes = {};
  for (const f of fields) {
    const from = before?.[f];
    const to = after?.[f];
    if (to !== undefined && String(from ?? '') !== String(to ?? '')) {
      changes[f] = { from: from ?? null, to };
    }
  }
  return Object.keys(changes).length ? changes : null;
}

module.exports = { record, diff };
