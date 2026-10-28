import Database from 'better-sqlite3-multiple-ciphers'

export type Db = Database.Database

const MIGRATIONS: string[] = [
  `CREATE TABLE servers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     provider TEXT NOT NULL DEFAULT '',
     host TEXT NOT NULL DEFAULT '',
     port INTEGER NOT NULL DEFAULT 22,
     username TEXT NOT NULL DEFAULT '',
     ssh_alias TEXT NOT NULL DEFAULT '',
     identity_file TEXT NOT NULL DEFAULT '',
     enpass_item_uuid TEXT NOT NULL DEFAULT '',
     monthly_cost REAL NOT NULL DEFAULT 0,
     currency TEXT NOT NULL DEFAULT 'USD',
     billing_day INTEGER,
     project TEXT NOT NULL DEFAULT '',
     panel_url TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE services (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'other',
     url TEXT NOT NULL DEFAULT '',
     port INTEGER,
     description TEXT NOT NULL DEFAULT '',
     enpass_item_uuid TEXT NOT NULL DEFAULT '',
     expected INTEGER NOT NULL DEFAULT 1,
     notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX services_server_id ON services(server_id);`,
  `CREATE TABLE snapshots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
     taken_at TEXT NOT NULL,
     data TEXT NOT NULL
   );
   CREATE INDEX snapshots_server_taken ON snapshots(server_id, taken_at);
   CREATE TABLE audit_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     trigger TEXT NOT NULL,
     status TEXT NOT NULL,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     data TEXT NOT NULL
   );
   CREATE TABLE decisions (
     key TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     until TEXT,
     note TEXT NOT NULL DEFAULT '',
     decided_at TEXT NOT NULL
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  // Audits became per-server; earlier all-server runs keep a NULL server_id.
  `ALTER TABLE audit_runs ADD COLUMN server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE;
   CREATE INDEX audit_runs_server ON audit_runs(server_id, id);`,
  `CREATE TABLE finding_chats (
     server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
     finding_key TEXT NOT NULL,
     data TEXT NOT NULL,
     PRIMARY KEY (server_id, finding_key)
   );`
]

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version])
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}
