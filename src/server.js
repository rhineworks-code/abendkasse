const path = require('path');
const express = require('express');
const cfg = require('./config');
const G = require('./game');
const Q = require('./questions');

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

app.get('/api/genres', (req, res) => res.json(Q.genres()));

app.post('/api/players', limit(10, 3600_000), wrap((req) => {
  const name = cleanName(req.body.name, 24);
  if (name.length < 2) throw G.httpError(400, 'Bitte einen Namen mit mindestens 2 Zeichen eingeben.');
  return G.createPlayer(name);
}));

app.get('/api/me', auth, wrap((req) => ({
  id: req.player.id, name: req.player.name, avatar: req.player.avatar, games: G.gamesOfPlayer(req.player.id),
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
  const g = G.createGame(req.player, { name, genres: req.body.genres, mode: req.body.mode, perDay: req.body.perDay });
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
  const mine = G.answer(req.game, req.player, Number(req.body.idx), Number(req.body.choice), req.body.date);
  return { ok: true, answered: Object.keys(mine).length };
}));

app.post('/api/games/:code/joker', auth, member, wrap((req) => G.useJoker(req.game, req.player, Number(req.body.idx), req.body.date)));

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

app.get('/api/games/:code/ledger', auth, member, wrap((req) => G.ledgerOf(req.game.id, req.player.id)));

// ---------- Admin (nur wenn ADMIN_TOKEN gesetzt) ----------

function admin(req, res, next) {
  if (!cfg.ADMIN_TOKEN || req.get('x-admin-token') !== cfg.ADMIN_TOKEN) return res.status(403).json({ error: 'Kein Zugriff.' });
  next();
}
app.post('/api/admin/payout-now', admin, wrap(() => { G.tick(true); return { ok: true }; }));
app.post('/api/admin/reload-questions', admin, wrap(() => { Q.reload(); return Q.genres(); }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Unbekannter Endpunkt.' }));

// ---------- Frontend ----------

app.use('/avatars', express.static(G.AVATAR_DIR, { maxAge: '30d', immutable: true, fallthrough: false }));

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// ---------- Start ----------

G.tick();
setInterval(() => { try { G.tick(); } catch (e) { console.error(e); } }, 30_000);

app.listen(cfg.PORT, () => {
  console.log(`[Abendkasse] läuft auf Port ${cfg.PORT} · Zeitzone ${cfg.TZ} · Auszahlung ${cfg.PAYOUT_HOUR}:00 Uhr`);
});
