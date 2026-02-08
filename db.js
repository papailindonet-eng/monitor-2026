import Database from 'better-sqlite3';

const db = new Database('monitor.db');

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    plate TEXT NOT NULL,
    carrier TEXT NOT NULL,
    status TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS status_history (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    status TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    carrier TEXT NOT NULL,
    status TEXT NOT NULL,
    called_at TEXT NOT NULL,
    confirmed_by TEXT,
    confirmed_at TEXT,
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS monitoring_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_started_at TEXT NOT NULL,
    cycle_finished_at TEXT,
    status TEXT NOT NULL,
    response_time_ms INTEGER,
    error_message TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    username TEXT,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    metadata TEXT
  );
`);

export default db;
