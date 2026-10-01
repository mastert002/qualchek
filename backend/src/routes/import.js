const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

router.post('/', async (req, res) => {
  const token = req.headers['x-import-token'];
  if (token !== process.env.IMPORT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'sql is required' });

  const db = getDb();

  if (sql.trim().toUpperCase().startsWith('SELECT')) {
    try {
      const rows = await db.prepare(sql).all();
      return res.json({ rows });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const statements = sql.split('\n').filter(line =>
    line.trim() && !line.trim().startsWith('--')
  );

  let ok = 0, failed = 0, errors = [];
  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    try {
      await db.exec(stmt);
      ok++;
    } catch (e) {
      failed++;
      if (errors.length < 20) errors.push({ stmt: stmt.slice(0, 80), err: e.message });
    }
  }

  res.json({ ok, failed, errors });
});

module.exports = router;