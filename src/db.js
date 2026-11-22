// SQLite über das in Node eingebaute Modul node:sqlite – keine nativen Abhängigkeiten
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'abendkasse.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  owner_id INTEGER REFERENCES players(id),
  genres TEXT NOT NULL,             -- JSON-Array
  mode TEXT NOT NULL DEFAULT 'mix', -- mix | daily (Tagesgenre rotiert)
  per_day INTEGER NOT NULL,
  week_no INTEGER NOT NULL DEFAULT 1,
  week_start TEXT NOT NULL,         -- YYYY-MM-DD
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS days (
  id INTEGER PRIMARY KEY,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  week_no INTEGER NOT NULL,
  genre TEXT,                       -- Tagesgenre (nur im Modus daily)
  questions TEXT NOT NULL,          -- JSON-Snapshot inkl. Lösung
  paid INTEGER NOT NULL DEFAULT 0,
  UNIQUE (game_id, date)
);

CREATE TABLE IF NOT EXISTS answers (
  day_id INTEGER REFERENCES days(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  choice INTEGER NOT NULL,
  answered_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day_id, player_id, idx)
);

CREATE TABLE IF NOT EXISTS results (
  day_id INTEGER REFERENCES days(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  points INTEGER NOT NULL,
  PRIMARY KEY (day_id, player_id)
);

-- Punktekonto: jede Gutschrift ist eine Buchung
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weeks (
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  week_no INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  scores TEXT NOT NULL,             -- JSON {playerId: punkte}
  winners TEXT NOT NULL,            -- JSON [playerId]
  PRIMARY KEY (game_id, week_no)
);

-- 50:50-Joker: welche Frage, welche zwei falschen Antworten wurden entfernt
CREATE TABLE IF NOT EXISTS jokers (
  day_id INTEGER REFERENCES days(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  removed TEXT NOT NULL,
  PRIMARY KEY (day_id, player_id, idx)
);

CREATE TABLE IF NOT EXISTS used_questions (
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  qid TEXT NOT NULL,
  PRIMARY KEY (game_id, qid)
);
`);

// Migrationen für bestehende Datenbanken
const cols = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
if (!cols.includes('avatar')) db.exec('ALTER TABLE players ADD COLUMN avatar TEXT');

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx };
