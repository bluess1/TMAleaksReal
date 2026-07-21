const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'tma-leaks.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    text TEXT,
    image_path TEXT,
    created_at INTEGER NOT NULL,
    reports INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    ip_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS report_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(post_id, ip_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
`);

module.exports = db;
