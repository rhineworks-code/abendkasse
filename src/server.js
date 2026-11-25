const path = require('path');
const express = require('express');
const cfg = require('./config');
const G = require('./game');
const { db } = require('./db');
const Q = require('./questions');
const P = require('./push');
const R = require('./reports');
const Stats = require('./stats');
const Backup = require('./backup');
const U = require('./updater');

const app = express();
app.set('trust proxy', true); // hinter Reverse Proxy (NPM, Traefik, Caddy …)
app.disable('x-powered-by');
const smallJson = express.json({ limit: '32kb' });
const bigJson = express.json({ limit: '700kb' }); // nur für Profilbilder
app.use((req, res, next) => (req.path === '/api/me/avatar' ? bigJson : smallJson)(req, res, next));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

// Einfaches Rate-Limit pro IP für Konto-Erstellung und Beitritt
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const h = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (h.length >= max) return res.status(429).json({ error: 'Zu viele Versuche – bitte kurz warten.' });
    h.push(now);
    hits.set(key, h);
    next();
  };
}
setInterval(() => hits.clear(), 3600_000).unref();

const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Interner Fehler' });
  }
};

function auth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const p = token && G.playerByToken(token);
  if (!p) return res.status(401).json({ error: 'Nicht angemeldet.' });
  req.player = p;
  next();
}

function member(req, res, next) {
  const g = G.getGame(req.params.code);
  if (!g) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  if (!G.isMember(g.id, req.player.id)) return res.status(403).json({ error: 'Du bist nicht in diesem Spiel.' });
  G.tick(); // ausstehende Auszahlungen / Wochenwechsel sofort verbuchen
  req.game = G.getGame(req.params.code);
  next();
}

const cleanName = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- API ----------

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/version', (req, res) => res.json(U.current));

// Update aus der App (nur Spielleiter)
const manager = (req, res, next) => (R.canManage(req.player) ? next() : res.status(403).json({ error: 'Nur Admins dürfen das.' }));

// Admins verwalten
app.get('/api/admins', auth, manager, wrap(() => db.prepare('SELECT id, name, avatar, is_admin AS admin FROM players ORDER BY name').all()
  .map((p) => ({ ...p, admin: !!p.admin }))));
app.post('/api/admins/:id', auth, manager, wrap((req) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id, name, is_admin FROM players WHERE id = ?').get(id);
  if (!target) throw G.httpError(404, 'Spieler nicht gefunden.');
  const admin = !!req.body.admin;
  if (!admin && target.is_admin && db.prepare('SELECT COUNT(*) AS c FROM players WHERE is_admin = 1').get().c <= 1) {
    throw G.httpError(409, 'Es muss mindestens einen Admin geben.');
  }
  db.prepare('UPDATE players SET is_admin = ? WHERE id = ?').run(admin ? 1 : 0, id);
  console.log(`[Admin] ${req.player.name} hat ${target.name} ${admin ? 'zum Admin gemacht' : 'als Admin entfernt'}`);
  return { ok: true };
}));
// Admin-Rechte mit dem ADMIN_TOKEN aus der .env freischalten (Rettungsweg)
app.post('/api/admin-claim', auth, limit(5, 3600_000), wrap((req) => {
  if (!cfg.ADMIN_TOKEN || String(req.body.token || '') !== cfg.ADMIN_TOKEN) throw G.httpError(403, 'Token stimmt nicht.');
  db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(req.player.id);
  console.log(`[Admin] ${req.player.name} hat sich per ADMIN_TOKEN zum Admin gemacht`);
  return { ok: true };
}));
app.get('/api/update', auth, manager, wrap(() => U.status()));
app.post('/api/update/check', auth, manager, limit(20, 3600_000), async (req, res) => res.json(await U.check()));
app.post('/api/update/apply', auth, manager, limit(10, 3600_000), async (req, res) => {
  try { res.json(await U.apply()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/genres', (req, res) => res.json(Q.genres()));

app.post('/api/players', limit(10, 3600_000), wrap((req) => {
  const name = cleanName(req.body.name, 24);
  if (name.length < 2) throw G.httpError(400, 'Bitte einen Namen mit mindestens 2 Zeichen eingeben.');
  return G.createPlayer(name);
}));

// ---------- Push ----------
app.get('/api/push/key', (req, res) => res.json({ key: P.publicKey() }));
app.post('/api/push/subscribe', auth, limit(30, 3600_000), wrap((req) => { P.subscribe(req.player, req.body.subscription); return { ok: true }; }));
app.post('/api/push/unsubscribe', auth, wrap((req) => { P.unsubscribe(req.player, req.body.endpoint); return { ok: true }; }));
app.post('/api/push/test', auth, limit(10, 600_000), async (req, res) => {
  const sent = await P.sendTo([req.player.id], { title: 'Abendkasse 🔔', body: 'Push-Benachrichtigungen funktionieren!', url: '/', tag: 'test' });
  res.json({ sent });
});

app.get('/api/me', auth, wrap((req) => ({
  id: req.player.id, name: req.player.name, avatar: req.player.avatar, games: G.gamesOfPlayer(req.player.id),
  canManage: R.canManage(req.player), isAdmin: R.canManage(req.player), adminClaimable: !!cfg.ADMIN_TOKEN,
  openReports: R.openCount(req.player),
})));

app.put('/api/me', auth, wrap((req) => {
  const name = cleanName(req.body.name, 24);
  if (name.length < 2) throw G.httpError(400, 'Bitte einen Namen mit mindestens 2 Zeichen eingeben.');
  G.renamePlayer(req.player, name);
  return { ok: true, name };
}));

app.post('/api/me/avatar', auth, limit(30, 3600_000), wrap((req) => ({ avatar: G.setAvatar(req.player, req.body.image) })));
app.delete('/api/me/avatar', auth, wrap((req) => { G.clearAvatar(req.player); return { ok: true }; }));

app.post('/api/games', auth, wrap((req) => {
  const name = cleanName(req.body.name, 40) || `${req.player.name}s Quiz`;
  const g = G.createGame(req.player, { name, genres: req.body.genres, mode: req.body.mode, perDay: req.body.perDay, difficulty: req.body.difficulty });
  return { code: g.code };
}));

app.post('/api/games/join', auth, limit(20, 600_000), wrap((req) => {
  const g = G.joinGame(cleanName(req.body.code, 10).toUpperCase(), req.player);
  return { code: g.code };
}));

app.get('/api/games/:code', auth, member, wrap((req) => G.overview(req.game, req.player)));

app.get('/api/games/:code/today', auth, member, wrap((req) => {
  const st = G.todayState(req.game);
  return G.dayView(req.game, req.player, st.date, st);
}));

app.post('/api/games/:code/answer', auth, member, wrap((req) => {
  return G.answer(req.game, req.player, Number(req.body.idx), Number(req.body.choice), req.body.date,
    req.body.kind === 'extra' ? 'extra' : 'day', req.body.order);
}));

app.post('/api/games/:code/joker', auth, member, wrap((req) => G.useJoker(req.game, req.player, Number(req.body.idx), req.body.date, req.body.kind === 'extra' ? 'extra' : 'day')));

// Extrarunde: zustimmen / ablehnen, ansehen
app.post('/api/games/:code/extra', auth, member, wrap((req) => G.answerExtra(req.game, req.player, !!req.body.accept)));
app.get('/api/games/:code/extra/:date', auth, member, wrap((req) => {
  const v = G.dayView(req.game, req.player, req.params.date, null, 'extra');
  if (v.state === 'none') throw G.httpError(404, 'An diesem Tag gab es keine Extrarunde.');
  if (v.state !== 'paid' && v.state !== 'open') throw G.httpError(403, `Die Auflösung gibt es erst um ${cfg.PAYOUT_HOUR}:00 Uhr.`);
  return v;
}));

// Tag wiederholen / streichen: Anfrage stellen, zustimmen oder ablehnen
app.post('/api/games/:code/days/:date/request', auth, member, wrap((req) =>
  G.requestDayAction(req.game, req.player, req.params.date, String(req.body.type || ''))));
app.post('/api/games/:code/days/:date/answer', auth, member, wrap((req) =>
  G.answerDayRequest(req.game, req.player, req.params.date, !!req.body.accept)));

app.get('/api/games/:code/days/:date', auth, member, wrap((req) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) throw G.httpError(400, 'Ungültiges Datum.');
  const v = G.dayView(req.game, req.player, req.params.date);
  if (v.state === 'none') throw G.httpError(404, 'An diesem Tag gab es keine Runde.');
  if (v.state !== 'paid' && v.state !== 'open') throw G.httpError(403, `Die Auflösung gibt es erst um ${cfg.PAYOUT_HOUR}:00 Uhr.`);
  return v;
}));

app.put('/api/games/:code/settings', auth, member, wrap((req) => G.updateSettings(req.game, req.player, {
  difficulty: req.body.difficulty, themeMode: req.body.themeMode, theme: req.body.theme,
})));

// Frage aufdecken (mit Einsatz) und Duell-Frage
app.post('/api/games/:code/open', auth, member, wrap((req) => G.openQuestion(req.game, req.player, Number(req.body.idx),
  Number(req.body.stake) || 0, req.body.date, req.body.kind === 'extra' ? 'extra' : 'day')));
app.post('/api/games/:code/duel', auth, member, wrap((req) => G.answerDuel(req.game, req.player, req.body.value, req.body.date)));

// Statistik & Abzeichen
app.get('/api/games/:code/stats', auth, member, wrap((req) => Stats.view(req.game.id, req.player)));

// Fragen melden und Meldungen bearbeiten
app.post('/api/games/:code/report', auth, member, limit(30, 3600_000), wrap((req) => R.report(req.game, req.player, req.body)));
app.get('/api/reports', auth, wrap((req) => ({ reasons: R.REASONS, items: R.list(req.player, req.query.status === 'done' ? 'done' : 'open') })));
app.post('/api/reports/:qid', auth, wrap((req) => R.resolve(req.player, req.params.qid, req.body)));

app.get('/api/games/:code/ledger', auth, member, wrap((req) => G.ledgerOf(req.game.id, req.player.id)));

// ---------- Admin (nur wenn ADMIN_TOKEN gesetzt) ----------

function admin(req, res, next) {
  if (!cfg.ADMIN_TOKEN || req.get('x-admin-token') !== cfg.ADMIN_TOKEN) return res.status(403).json({ error: 'Kein Zugriff.' });
  next();
}
app.post('/api/admin/payout-now', admin, wrap(() => { G.tick(true); return { ok: true }; }));
app.post('/api/admin/backup', admin, async (req, res) => {
  try { res.json(await Backup.run()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/backup', admin, wrap(() => Backup.status() || { info: 'Seit dem Start noch keine Sicherung.' }));
app.post('/api/admin/reload-questions', admin, wrap(() => { Q.reload(); return Q.genres(); }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Unbekannter Endpunkt.' }));

// ---------- Frontend ----------

// Bilder für eigene Bildfragen: data/questions/bilder/… -> /eigene/…
app.use('/eigene', express.static(path.join(cfg.DATA_DIR, 'questions', 'bilder'), { maxAge: '1d', fallthrough: false }));
app.use('/avatars', express.static(G.AVATAR_DIR, { maxAge: '30d', immutable: true, fallthrough: false }));

// index.html mit Versionsnummer an app.js/app.css ausliefern -> nach einem Update lädt jeder Browser
// (auch die installierte App) sofort die neuen Dateien statt einer zwischengespeicherten alten Version.
const fs = require('fs');
const VERSION = (process.env.APP_VERSION || 'dev').slice(0, 12) + (process.env.APP_VERSION ? '' : '-' + Date.now());
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')
  .replace(/(href|src)="\/app\.(css|js)"/g, `$1="/app.$2?v=${VERSION}"`);
const sendIndex = (req, res) => res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' }).send(indexHtml);
app.get(['/', '/index.html'], sendIndex);

app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: false,
  setHeaders: (res, file, stat) => {
    if (/\.(js|css|html|webmanifest)$/.test(file)) res.set('Cache-Control', 'no-cache'); // immer kurz beim Server nachfragen (ETag -> 304)
    else res.set('Cache-Control', 'public, max-age=604800'); // Bilder, Flaggen, Icons: 7 Tage
  },
}));
app.get('*', sendIndex);

// ---------- Start ----------

G.tick();
setInterval(() => { try { G.tick(); } catch (e) { console.error(e); } }, 30_000);

app.listen(cfg.PORT, () => {
  console.log(`[Abendkasse] läuft auf Port ${cfg.PORT} · Zeitzone ${cfg.TZ} · Auszahlung ${cfg.PAYOUT_HOUR}:00 Uhr`);
});
