// Admin-Bereich unter /admin: eigene Konten (Benutzername + Passwort), getrennt von den Spielern.
// Erstes Konto nur mit Einrichtungscode aus dem Container-Log (docker logs abendkasse) oder per CLI.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const cfg = require('./config');
const { db, tx } = require('./db');
const R = require('./reports');
const U = require('./updater');
const P = require('./push');
const Backup = require('./backup');

const COOKIE = 'ak_admin';
const SESSION_DAYS = 30;
const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---------- Passwörter ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [, saltHex, keyHex] = String(stored).split('$');
  if (!saltHex || !keyHex) return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
const validCreds = (user, pw) => {
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(user || '')) throw httpError(400, 'Benutzername: 3–32 Zeichen (Buchstaben, Ziffern, . _ -).');
  if (String(pw || '').length < 8) throw httpError(400, 'Das Passwort braucht mindestens 8 Zeichen.');
};
function setPassword(username, password) {
  validCreds(username, password);
  const h = hashPassword(password);
  const ex = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username);
  if (ex) {
    db.prepare('UPDATE admin_users SET hash = ? WHERE id = ?').run(h, ex.id);
    db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(ex.id); // alle Sitzungen abmelden
  } else db.prepare('INSERT INTO admin_users (username, hash) VALUES (?, ?)').run(username, h);
}
const hasAdmin = () => !!db.prepare('SELECT 1 FROM admin_users').get();

// Einrichtungscode, solange es kein Admin-Konto gibt
let setupCode = null;
function ensureSetupCode() {
  if (hasAdmin()) { setupCode = null; return; }
  if (!setupCode) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    setupCode = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    console.log(`[Admin] Noch kein Admin-Konto. Einrichten unter /admin mit dem Einrichtungscode: ${setupCode}`);
  }
}

// ---------- Sitzungen ----------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: SESSION_DAYS * 864e5 });
}
function sessionUser(req) {
  const t = readCookie(req, COOKIE);
  if (!t) return null;
  const s = db.prepare(`SELECT u.id, u.username, s.expires_at FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(sha(t));
  if (!s || s.expires_at < Date.now()) return null;
  return { id: s.id, username: s.username };
}

// ---------- Fehlversuche bremsen ----------
const fails = new Map(); // ip -> [zeitstempel]
function throttle(req) {
  const now = Date.now();
  const list = (fails.get(req.ip) || []).filter((t) => now - t < 15 * 60_000);
  fails.set(req.ip, list);
  if (list.length >= 8) throw httpError(429, 'Zu viele Fehlversuche – bitte 15 Minuten warten.');
}
const fail = (req) => fails.set(req.ip, [...(fails.get(req.ip) || []), Date.now()]);

// ---------- Verwaltung ----------
function overview() {
  const players = db.prepare(`SELECT p.id, p.name, p.avatar, p.created_at, p.is_admin AS notify,
      (SELECT COUNT(*) FROM push_subs s WHERE s.player_id = p.id) AS devices,
      (SELECT MAX(a.answered_at) FROM answers a WHERE a.player_id = p.id) AS last_active,
      (SELECT GROUP_CONCAT(g.code || ':' || g.name, '|') FROM game_players gp JOIN games g ON g.id = gp.game_id WHERE gp.player_id = p.id) AS games
    FROM players p ORDER BY p.name COLLATE NOCASE, p.id`).all()
    .map((p) => ({ ...p, notify: !!p.notify, games: p.games ? p.games.split('|').map((x) => { const [code, ...n] = x.split(':'); return { code, name: n.join(':') }; }) : [] }));
  const games = db.prepare(`SELECT g.id, g.code, g.name, g.week_no, g.created_at, g.difficulty, g.theme_mode,
      (SELECT name FROM players WHERE id = g.owner_id) AS owner,
      (SELECT GROUP_CONCAT(p.name, ', ') FROM game_players gp JOIN players p ON p.id = gp.player_id WHERE gp.game_id = g.id) AS players,
      (SELECT MAX(date) FROM days d WHERE d.game_id = g.id) AS last_round,
      (SELECT COUNT(*) FROM days d WHERE d.game_id = g.id AND d.paid = 1) AS rounds
    FROM games g ORDER BY g.created_at DESC`).all();
  return {
    version: U.status(), backup: Backup.status(), openReports: R.openCount(),
    counts: { players: players.length, games: games.length, rounds: db.prepare('SELECT COUNT(*) AS c FROM days WHERE paid = 1').get().c,
      answers: db.prepare('SELECT COUNT(*) AS c FROM answers').get().c, devices: db.prepare('SELECT COUNT(*) AS c FROM push_subs').get().c },
    backupTarget: cfg.BACKUP_DIR, backupHour: cfg.BACKUP_HOUR, backupKeep: cfg.BACKUP_KEEP,
    players, games,
  };
}

function deletePlayer(id) {
  const p = db.prepare('SELECT id, name FROM players WHERE id = ?').get(id);
  if (!p) throw httpError(404, 'Spieler nicht gefunden.');
  tx(() => {
    db.prepare('UPDATE games SET owner_id = NULL WHERE owner_id = ?').run(id);
    db.prepare('UPDATE games SET theme_chooser = NULL WHERE theme_chooser = ?').run(id);
    db.prepare('DELETE FROM players WHERE id = ?').run(id); // Antworten, Konto, Push-Abos … werden mitgelöscht
  });
  console.log(`[Admin] Spieler ${p.name} (#${id}) gelöscht`);
}
function deleteGame(id) {
  const g = db.prepare('SELECT id, code, name FROM games WHERE id = ?').get(id);
  if (!g) throw httpError(404, 'Spiel nicht gefunden.');
  db.prepare('DELETE FROM games WHERE id = ?').run(id);
  db.prepare('DELETE FROM notify_log WHERE game_id = ?').run(id);
  console.log(`[Admin] Spiel ${g.name} (${g.code}) gelöscht`);
}

// ---------- Routen ----------
function mount(app, { wrap }) {
  ensureSetupCode();
  const json = (req, res, next) => (req.method === 'GET' || req.is('application/json') ? next() : res.status(415).json({ error: 'JSON erwartet.' }));
  const need = (req, res, next) => {
    const u = sessionUser(req);
    if (!u) return res.status(401).json({ error: 'Bitte als Admin anmelden.' });
    req.admin = u; next();
  };

  app.get('/api/a/state', (req, res) => { ensureSetupCode(); const u = sessionUser(req); res.json({ setup: !hasAdmin(), user: u ? u.username : null }); });

  app.post('/api/a/setup', json, wrap((req, res) => {
    throttle(req);
    if (hasAdmin()) throw httpError(409, 'Es gibt schon ein Admin-Konto.');
    ensureSetupCode();
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!setupCode || code !== setupCode) { fail(req); throw httpError(403, 'Einrichtungscode stimmt nicht. Er steht in „docker logs abendkasse“.'); }
    setPassword(String(req.body.user || '').trim(), String(req.body.password || ''));
    const u = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(String(req.body.user).trim());
    setupCode = null;
    startSession(req, res, u.id);
    console.log(`[Admin] Admin-Konto „${req.body.user}“ eingerichtet`);
    return { ok: true };
  }));

  app.post('/api/a/login', json, wrap((req, res) => {
    throttle(req);
    const u = db.prepare('SELECT id, hash FROM admin_users WHERE username = ?').get(String(req.body.user || '').trim());
    // auch bei unbekanntem Namen rechnen, damit die Antwortzeit nichts verrät
    const ok = verifyPassword(String(req.body.password || ''), u ? u.hash : hashPassword('x'));
    if (!u || !ok) { fail(req); throw httpError(401, 'Benutzername oder Passwort falsch.'); }
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());
    startSession(req, res, u.id);
    return { ok: true };
  }));

  app.post('/api/a/logout', (req, res) => {
    const t = readCookie(req, COOKIE);
    if (t) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha(t));
    res.clearCookie(COOKIE, { path: '/' }).json({ ok: true });
  });

  app.use('/api/a', json, need);
  app.get('/api/a/overview', wrap(() => overview()));
  app.post('/api/a/update/check', async (req, res) => res.json(await U.check()));
  app.post('/api/a/update/apply', async (req, res) => {
    try { res.json(await U.apply()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/a/reports', wrap((req) => ({ reasons: R.REASONS, items: R.list(req.query.status === 'done' ? 'done' : 'open') })));
  app.post('/api/a/reports/:qid', wrap((req) => R.resolve(req.params.qid, req.body)));
  app.post('/api/a/players/:id/notify', wrap((req) => {
    db.prepare('UPDATE players SET is_admin = ? WHERE id = ?').run(req.body.notify ? 1 : 0, Number(req.params.id));
    return { ok: true };
  }));
  app.post('/api/a/players/:id/delete', wrap((req) => { deletePlayer(Number(req.params.id)); return { ok: true }; }));
  app.post('/api/a/games/:id/delete', wrap((req) => { deleteGame(Number(req.params.id)); return { ok: true }; }));
  app.post('/api/a/backup', async (req, res) => { try { res.json(await Backup.run()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/a/push-test', async (req, res) => {
    const ids = db.prepare('SELECT id FROM players WHERE is_admin = 1').all().map((r) => r.id);
    res.json({ sent: await P.sendTo(ids, { title: 'Abendkasse Admin 🔔', body: 'Test: So kommen Update-Hinweise an.', url: '/', tag: 'admin-test' }) });
  });
  app.post('/api/a/password', wrap((req, res) => {
    const u = db.prepare('SELECT id, username, hash FROM admin_users WHERE id = ?').get(req.admin.id);
    if (!verifyPassword(String(req.body.old || ''), u.hash)) throw httpError(403, 'Das aktuelle Passwort stimmt nicht.');
    setPassword(u.username, String(req.body.password || ''));
    startSession(req, res, u.id); // neu anmelden, andere Sitzungen sind beendet
    return { ok: true };
  }));
}

module.exports = { mount, setPassword, hasAdmin };
