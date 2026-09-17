const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'festou.db');
const dir = path.dirname(dbPath);
require('fs').mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    device TEXT,
    browser TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    duration INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  )
`);

const insertStmt = db.prepare(
  'INSERT INTO access_log (user_name, timestamp, device, browser, screen_width, screen_height) VALUES (?, ?, ?, ?, ?, ?)'
);
const updateDurationStmt = db.prepare(
  'UPDATE access_log SET duration = ? WHERE id = ?'
);

app.post('/api/access', (req, res) => {
  const { userName, timestamp, device, browser, screenWidth, screenHeight } = req.body;
  if (!userName || !timestamp) return res.status(400).json({ error: 'userName and timestamp required' });
  const result = insertStmt.run(userName, timestamp, device || '', browser || '', screenWidth || 0, screenHeight || 0);
  res.json({ id: result.lastInsertRowid });
});

app.patch('/api/access/:id/duration', (req, res) => {
  const { duration } = req.body;
  const id = parseInt(req.params.id);
  if (!id || duration == null) return res.status(400).json({ error: 'invalid' });
  updateDurationStmt.run(duration, id);
  res.json({ ok: true });
});

app.get('/api/access', (req, res) => {
  const { search, period, page, limit } = req.query;
  const perPage = Math.min(parseInt(limit) || 15, 100);
  const pageNum = parseInt(page) || 0;
  const offset = pageNum * perPage;

  let where = '1=1';
  const params = [];

  if (search) {
    where += ' AND user_name LIKE ?';
    params.push('%' + search + '%');
  }

  if (period === 'today') {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    where += ' AND timestamp >= ?';
    params.push(todayStart.getTime());
  } else if (period === 'week') {
    where += ' AND timestamp >= ?';
    params.push(Date.now() - 7 * 86400000);
  } else if (period === 'month') {
    where += ' AND timestamp >= ?';
    params.push(Date.now() - 30 * 86400000);
  }

  const countRow = db.prepare('SELECT COUNT(*) as total FROM access_log WHERE ' + where).get(...params);
  const rows = db.prepare('SELECT * FROM access_log WHERE ' + where + ' ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(...params, perPage, offset);

  res.json({ total: countRow.total, page: pageNum, perPage, rows });
});

app.get('/api/access/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM access_log').get().c;
  const uniqueUsers = db.prepare('SELECT COUNT(DISTINCT user_name) as c FROM access_log').get().c;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = db.prepare('SELECT COUNT(*) as c FROM access_log WHERE timestamp >= ?').get(todayStart.getTime()).c;
  const weekCount = db.prepare('SELECT COUNT(*) as c FROM access_log WHERE timestamp >= ?').get(Date.now() - 7 * 86400000).c;
  const avgRow = db.prepare('SELECT AVG(duration) as avg FROM access_log WHERE duration > 0').get();

  res.json({
    total,
    uniqueUsers,
    todayCount,
    weekCount,
    avgDuration: Math.round(avgRow.avg || 0)
  });
});

app.delete('/api/access', (req, res) => {
  db.exec('DELETE FROM access_log');
  res.json({ ok: true });
});

const upsertUserData = db.prepare(
  `INSERT INTO user_data (user_name, data, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(user_name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
);

app.post('/api/userdata', (req, res) => {
  const { userName, data } = req.body;
  if (!userName || !data) return res.status(400).json({ error: 'userName and data required' });
  upsertUserData.run(userName, JSON.stringify(data), Date.now());
  res.json({ ok: true });
});

app.get('/api/userdata', (req, res) => {
  const rows = db.prepare('SELECT * FROM user_data ORDER BY updated_at DESC').all();
  const result = rows.map(r => ({ userName: r.user_name, data: JSON.parse(r.data), updatedAt: r.updated_at }));
  res.json(result);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Festou server running on port ' + PORT);
});
