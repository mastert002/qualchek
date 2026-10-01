const jwt = require('jsonwebtoken');
const { getDb, getPool } = require('../db/database');
const { withTenant } = require('../db/tenantContext');

const { JWT_SECRET } = require('../lib/secret');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.slice(7);

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // The tenant comes from the signed token, so it cannot be chosen by the
  // caller: altering it invalidates the signature. Everything from here runs
  // inside that tenant's context, including the user lookup below - so a token
  // naming a tenant the user does not belong to simply finds no user, rather
  // than being a case anyone has to remember to check.
  if (!decoded.tenant_id) {
    return res.status(401).json({ error: 'Token predates workspaces; sign in again' });
  }

  try {
    return await withTenant(getPool(), decoded.tenant_id, async () => {
      const db = getDb();
      // Re-read on every request so a role change or a deactivation takes
      // effect immediately rather than when the token happens to expire.
      const user = await db.prepare(
        'SELECT id, name, email, role, is_active, is_super_admin, tenant_id FROM users WHERE id = ?'
      ).get(decoded.id);
      if (!user) return res.status(401).json({ error: 'User not found' });
      if (user.is_active === false) {
        return res.status(401).json({ error: 'This account has been deactivated' });
      }

      // The workspace itself can be suspended or its trial can lapse. Read it
      // here so every route gets the state without asking for it.
      const tenant = await db.prepare(
        'SELECT id, name, slug, status, plan, trial_ends_at FROM tenants WHERE id = ?'
      ).get(decoded.tenant_id);
      if (!tenant) return res.status(401).json({ error: 'Workspace not found' });

      req.user = user;
      req.tenant = tenant;
      return next();
    });
  } catch (err) {
    console.error('authenticate:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function signToken(user) {
  // tenant_id is part of the signed payload rather than something looked up
  // later: it decides which rows every query in the request can see, so it has
  // to be as tamper-proof as the user id itself.
  if (!user.tenant_id) throw new Error('signToken: user has no tenant_id');
  return jwt.sign(
    { id: user.id, tenant_id: user.tenant_id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    // Short on purpose. This token is readable by JavaScript and cannot be
    // revoked, so its lifetime is the only bound on a copy taken from the
    // browser. Sessions no longer depend on it lasting: the refresh cookie
    // (lib/refresh.js) silently issues a new one every 15 minutes, and that
    // half IS revocable.
    { expiresIn: '15m' }
  );
}

module.exports = { authenticate, requireRole, signToken };
