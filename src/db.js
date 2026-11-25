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
  kind TEXT NOT NULL DEFAULT 'day', -- day = Tagesrunde, extra = Extrarunde
  week_no INTEGER NOT NULL,
  genre TEXT,                       -- Tagesgenre (nur im Modus daily)
  questions TEXT NOT NULL,          -- JSON-Snapshot inkl. Lösung
  paid INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,                    -- Auszahlungstag (Nachholrunde: später als date)
  replay INTEGER NOT NULL DEFAULT 0,
  voided INTEGER NOT NULL DEFAULT 0,
  history TEXT,
  UNIQUE (game_id, date, kind)
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

-- Offene Anfragen „Tag wiederholen/streichen“ (auch für Tage ohne eigene Runde)
CREATE TABLE IF NOT EXISTS day_requests (
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (game_id, date)
);

-- Extrarunde: Angebot und Zustimmungen pro Spiel und Tag
CREATE TABLE IF NOT EXISTS extra_offers (
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  data TEXT NOT NULL,               -- JSON {ok:[playerId], declinedBy}
  PRIMARY KEY (game_id, date)
);

-- Push-Abos (ein Eintrag pro Gerät/Browser)
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Merkt sich, welche Benachrichtigungen schon verschickt wurden (z. B. Morgen-Push)
CREATE TABLE IF NOT EXISTS notify_log (
  game_id INTEGER,
  key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, key)
);

-- Aufgedeckte Fragen: Startzeit (Tempo-Bonus) und Einsatz
CREATE TABLE IF NOT EXISTS opens (
  day_id INTEGER REFERENCES days(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  opened_at INTEGER NOT NULL,       -- ms seit 1970
  stake INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day_id, player_id, idx)
);

-- Duell-Frage des Tages (Schätzfrage)
CREATE TABLE IF NOT EXISTS duel_answers (
  day_id INTEGER REFERENCES days(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  value REAL NOT NULL,
  answered_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day_id, player_id)
);

-- Gemeldete Fragen
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  qid TEXT NOT NULL,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  comment TEXT,
  question TEXT NOT NULL,           -- JSON-Snapshot
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Korrekturen am Fragenkatalog (Stufe ändern, Frage deaktivieren)
CREATE TABLE IF NOT EXISTS question_overrides (
  qid TEXT PRIMARY KEY,
  level INTEGER,
  disabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Erreichte Abzeichen
CREATE TABLE IF NOT EXISTS achievements (
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, player_id, key)
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
const gcols = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
if (!gcols.includes('difficulty')) db.exec("ALTER TABLE games ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'mittel'");
// Themenwoche
if (!gcols.includes('theme_mode')) db.exec('ALTER TABLE games ADD COLUMN theme_mode INTEGER NOT NULL DEFAULT 0');
if (!gcols.includes('week_theme')) db.exec('ALTER TABLE games ADD COLUMN week_theme TEXT');
if (!gcols.includes('theme_chooser')) db.exec('ALTER TABLE games ADD COLUMN theme_chooser INTEGER');

const addCol = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addCol('answers', 'value', 'TEXT');                       // Reihenfolge-Antwort (JSON)
addCol('answers', 'stake', 'INTEGER NOT NULL DEFAULT 0'); // Einsatz
addCol('answers', 'ms', 'INTEGER');                       // Antwortzeit
addCol('results', 'detail', 'TEXT');                      // Aufschlüsselung der Punkte (JSON)
addCol('players', 'is_admin', 'INTEGER NOT NULL DEFAULT 0'); // Admin: Updates, Fragenkatalog
// Gibt es noch keinen Admin, wird der zuerst registrierte Spieler Admin
if (!db.prepare('SELECT 1 FROM players WHERE is_admin = 1').get()) {
  const first = db.prepare('SELECT id, name FROM players ORDER BY id LIMIT 1').get();
  if (first) { db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(first.id); console.log(`[Admin] ${first.name} ist jetzt Admin`); }
}
const dcols = db.prepare('PRAGMA table_info(days)').all().map((c) => c.name);
// Tag wiederholen / streichen
if (!dcols.includes('due_date')) db.exec('ALTER TABLE days ADD COLUMN due_date TEXT');        // Auszahlungstag (Nachholrunde: später als date)
if (!dcols.includes('replay')) db.exec('ALTER TABLE days ADD COLUMN replay INTEGER NOT NULL DEFAULT 0'); // wie oft wiederholt
if (!dcols.includes('voided')) db.exec('ALTER TABLE days ADD COLUMN voided INTEGER NOT NULL DEFAULT 0'); // gestrichen
if (!dcols.includes('history')) db.exec('ALTER TABLE days ADD COLUMN history TEXT');          // frühere Versuche (JSON)

// Extrarunde: days braucht die Spalte kind und einen neuen eindeutigen Schlüssel -> Tabelle umbauen
if (!db.prepare('PRAGMA table_info(days)').all().some((c) => c.name === 'kind')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE days_new (
  id INTEGER PRIMARY KEY,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'day', -- day = Tagesrunde, extra = Extrarunde
  week_no INTEGER NOT NULL,
  genre TEXT,                       -- Tagesgenre (nur im Modus daily)
  questions TEXT NOT NULL,          -- JSON-Snapshot inkl. Lösung
  paid INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,                    -- Auszahlungstag (Nachholrunde: später als date)
  replay INTEGER NOT NULL DEFAULT 0,
  voided INTEGER NOT NULL DEFAULT 0,
  history TEXT,
  UNIQUE (game_id, date, kind)
);
    INSERT INTO days_new (id, game_id, date, week_no, genre, questions, paid, due_date, replay, voided, history)
      SELECT id, game_id, date, week_no, genre, questions, paid, due_date, replay, voided, history FROM days;
    DROP TABLE days;
    ALTER TABLE days_new RENAME TO days;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
  console.log('[DB] Tabelle days für Extrarunden umgebaut');
}
addCol('days', 'duel', 'TEXT');                           // Duell-Frage des Tages (JSON)

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
