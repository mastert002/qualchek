// Creates the first QualChek operator. Run once per environment.
//   node migrations/005-seed-platform-user.js "Name" email@example.com [password]
// Prints a generated password if none is given, and only then.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { Client } = require('pg');

const [, , name, email, given] = process.argv;
if (!name || !email) {
  console.error('usage: node migrations/005-seed-platform-user.js "Full Name" email@example.com [password]');
  process.exit(1);
}
const password = given || crypto.randomBytes(12).toString('base64url');

(async () => {
  const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  await c.query(
    `INSERT INTO platform_users (id, name, email, password_hash) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash`,
    ['plt_' + uuid(), name, email.toLowerCase(), bcrypt.hashSync(password, 10)]);
  console.log(`platform operator ready: ${email}`);
  if (!given) console.log(`generated password (shown once): ${password}`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
