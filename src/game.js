// Spiel-Logik: Wochen, Tagesrunden, Auszahlung
const crypto = require('crypto');
const { db, tx } = require('./db');
const cfg = require('./config');
const T = require('./time');
const Q = require('./questions');
const P = require('./push');

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const fmtDe = (d) => { const t = new Date(d + 'T12:00:00Z'); return `${WD[t.getUTCDay()]}, ${t.getUTCDate()}.${t.getUTCMonth() + 1}.`; };
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const gameUrl = (game, sub = '') => `/#/g/${game.code}${sub}`;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len = 6) {
  let s = '';
  for (const b of crypto.randomBytes(len)) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Schwierigkeitsstufen: welche Fragen-Level vorkommen und wie stark sie gewichtet werden
const DIFFICULTIES = {
  leicht: { 1: 1 },
  mittel: { 1: 1, 2: 1 },
  schwer: { 2: 1, 3: 3 },
  gemischt: { 1: 1, 2: 1, 3: 1 },
};
const normDifficulty = (d) => (DIFFICULTIES[d] ? d : 'mittel');

// Zufällige Reihenfolge mit Gewichten (Efraimidis-Spirakis)
function weightedOrder(list, weightOf) {
  return list.map((x) => ({ x, k: Math.random() ** (1 / weightOf(x)) })).sort((a, b) => b.k - a.k).map((e) => e.x);
}

const isAfterPayout = (n) => n.hour >= cfg.PAYOUT_HOUR;
// Erster Spieltag: heute, oder morgen wenn die Auszahlung für heute schon durch ist
const freshStart = (n) => (isAfterPayout(n) ? T.addDays(n.date, 1) : n.date);

// ---------- Spieler ----------

function createPlayer(name) {
  const token = crypto.randomBytes(24).toString('hex');
  const r = db.prepare('INSERT INTO players (name, token) VALUES (?, ?)').run(name, token);
  return { id: Number(r.lastInsertRowid), name, token };
}

const playerByToken = (token) => db.prepare('SELECT * FROM players WHERE token = ?').get(token);

function renamePlayer(player, name) {
  db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, player.id);
}

// Profilbild: Daten-URL (JPEG/PNG/WebP) -> Datei unter /data/avatars/<zufall>.<ext>
const fs = require('fs');
const path = require('path');
const AVATAR_DIR = path.join(cfg.DATA_DIR, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

function setAvatar(player, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw httpError(400, 'Bitte ein JPG-, PNG- oder WebP-Bild hochladen.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 400 * 1024) throw httpError(413, 'Das Bild ist zu groß (max. 400 KB).');
  const magic = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] }[m[1]];
  if (!magic.every((b, i) => buf[i] === b)) throw httpError(400, 'Die Datei ist kein gültiges Bild.');

  const file = `${crypto.randomBytes(12).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(AVATAR_DIR, file), buf);
  removeAvatarFile(player.avatar);
  db.prepare('UPDATE players SET avatar = ? WHERE id = ?').run(file, player.id);
  return file;
}

function clearAvatar(player) {
  removeAvatarFile(player.avatar);
  db.prepare('UPDATE players SET avatar = NULL WHERE id = ?').run(player.id);
}

function removeAvatarFile(file) {
  if (file && /^[a-f0-9]+\.(jpg|png|webp)$/.test(file)) fs.rm(path.join(AVATAR_DIR, file), { force: true }, () => {});
}

// ---------- Spiele ----------

function createGame(owner, { name, genres, mode, perDay, difficulty }) {
  const known = new Set(Q.genres().map((g) => g.name));
  genres = (genres || []).filter((g) => known.has(g));
  if (!genres.length) genres = [...known];
  mode = mode === 'daily' ? 'daily' : 'mix';
  perDay = Math.min(Math.max(parseInt(perDay, 10) || cfg.QUESTIONS_PER_DAY, 1), 20);
  difficulty = normDifficulty(difficulty);

  let code;
  do code = randomCode(); while (db.prepare('SELECT 1 FROM games WHERE code = ?').get(code));

  return tx(() => {
    const r = db.prepare(`INSERT INTO games (code, name, owner_id, genres, mode, per_day, week_start, difficulty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(code, name, owner.id, JSON.stringify(genres), mode, perDay, freshStart(T.now()), difficulty);
    db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)').run(r.lastInsertRowid, owner.id);
    P.once(Number(r.lastInsertRowid), `morning:${T.now().date}`); // wer gerade erstellt, braucht keinen Morgen-Push
    return getGame(code);
  });
}

function getGame(code) {
  const g = db.prepare('SELECT * FROM games WHERE code = ?').get(String(code || '').toUpperCase());
  if (g) g.genres = JSON.parse(g.genres);
  return g;
}

const gamePlayers = (gameId) => db.prepare(`
  SELECT p.id, p.name, p.avatar, COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.game_id = gp.game_id AND l.player_id = p.id), 0) AS balance
  FROM game_players gp JOIN players p ON p.id = gp.player_id
  WHERE gp.game_id = ? ORDER BY gp.joined_at, p.id`).all(gameId);

const isMember = (gameId, playerId) =>
  !!db.prepare('SELECT 1 FROM game_players WHERE game_id = ? AND player_id = ?').get(gameId, playerId);

function joinGame(code, player) {
  const g = getGame(code);
  if (!g) throw httpError(404, 'Kein Spiel mit diesem Code gefunden.');
  if (isMember(g.id, player.id)) return g;
  const count = db.prepare('SELECT COUNT(*) AS c FROM game_players WHERE game_id = ?').get(g.id).c;
  if (count >= cfg.MAX_PLAYERS) throw httpError(409, 'Dieses Spiel ist schon voll.');
  db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)').run(g.id, player.id);
  return g;
}

// Einstellungen eines laufenden Spiels ändern (gilt ab der nächsten neuen Runde)
function updateSettings(game, { difficulty }) {
  if (difficulty !== undefined) {
    if (!DIFFICULTIES[difficulty]) throw httpError(400, 'Unbekannte Schwierigkeit.');
    db.prepare('UPDATE games SET difficulty = ? WHERE id = ?').run(difficulty, game.id);
  }
  return { ok: true, difficulty: getGame(game.code).difficulty };
}

const gamesOfPlayer = (playerId) => db.prepare(`
  SELECT g.code, g.name, g.week_no, g.week_start, g.difficulty,
    (SELECT COUNT(*) FROM game_players x WHERE x.game_id = g.id) AS players,
    COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.game_id = g.id AND l.player_id = ?), 0) AS balance
  FROM games g JOIN game_players gp ON gp.game_id = g.id
  WHERE gp.player_id = ? ORDER BY g.created_at DESC`).all(playerId, playerId);

// ---------- Tagesrunde ----------

function dayGenre(game, date) {
  if (game.mode !== 'daily') return null;
  const idx = ((T.diffDays(game.created_at.slice(0, 10), date) % game.genres.length) + game.genres.length) % game.genres.length;
  return game.genres[idx];
}

function pickQuestions(game, genre, count = game.per_day) {
  const allowed = genre ? [genre] : game.genres;
  const weights = DIFFICULTIES[normDifficulty(game.difficulty)];
  let inGenres = Q.all().filter((q) => allowed.includes(q.genre) && weights[q.level]);
  // Zu wenige Fragen dieser Stufe -> auf alle Stufen ausweichen
  if (inGenres.length < count) inGenres = Q.all().filter((q) => allowed.includes(q.genre));
  const weightOf = (q) => weights[q.level] || 0.2;
  const used = new Set(db.prepare('SELECT qid FROM used_questions WHERE game_id = ?').all(game.id).map((r) => r.qid));
  let pool = inGenres.filter((q) => !used.has(q.id));

  if (pool.length < count) {
    // Katalog für diese Genres aufgebraucht -> wieder von vorne
    const del = db.prepare('DELETE FROM used_questions WHERE game_id = ? AND qid = ?');
    inGenres.forEach((q) => del.run(game.id, q.id));
    pool = inGenres;
  }
  // Im Mix-Modus möglichst gleichmäßig über die Genres verteilen
  let picked;
  if (!genre && allowed.length > 1) {
    const byGenre = {};
    weightedOrder(pool, weightOf).forEach((q) => (byGenre[q.genre] = byGenre[q.genre] || []).push(q));
    const order = shuffle(Object.keys(byGenre));
    picked = [];
    while (picked.length < count && order.some((g) => byGenre[g].length)) {
      for (const g of order) if (byGenre[g].length && picked.length < count) picked.push(byGenre[g].shift());
    }
  } else {
    picked = weightedOrder(pool, weightOf).slice(0, count);
  }
  // Innerhalb des Tages von leicht nach schwer
  return picked.map((q, i) => ({ q, i })).sort((a, b) => a.q.level - b.q.level || a.i - b.i).map((e) => e.q);
}

function newQuestions(game, date, count = game.per_day, mix = false) {
  let genre = mix ? null : dayGenre(game, date);
  if (genre && Q.all().filter((q) => q.genre === genre).length < count) genre = null;
  const questions = pickQuestions(game, genre, count).map((q) => {
    const options = shuffle([q.correct, ...q.wrong]);
    return { id: q.id, genre: q.genre, level: q.level, q: q.q, options, answer: options.indexOf(q.correct) };
  });
  const ins = db.prepare('INSERT OR IGNORE INTO used_questions (game_id, qid) VALUES (?, ?)');
  questions.forEach((q) => ins.run(game.id, q.id));
  return { genre, questions };
}

function createDay(game, date, dueDate = null, replay = 0) {
  return tx(() => {
    const { genre, questions } = newQuestions(game, date);
    db.prepare('INSERT OR IGNORE INTO days (game_id, date, week_no, genre, questions, due_date, replay) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(game.id, date, game.week_no, genre, JSON.stringify(questions), dueDate, replay);
    return getDay(game.id, date, 'day');
  });
}

function parseDay(d) {
  if (!d) return d;
  d.questions = JSON.parse(d.questions);
  d.history = d.history ? JSON.parse(d.history) : [];
  return d;
}

const getDay = (gameId, date, kind = 'day') =>
  parseDay(db.prepare('SELECT * FROM days WHERE game_id = ? AND date = ? AND kind = ?').get(gameId, date, kind));
const dueOf = (d) => d.due_date || d.date;

// Ist eine Nachholrunde (Tag in der Vergangenheit) gerade spielbar?
function replayOpen(d, n = T.now()) {
  if (!d || d.paid || !d.replay) return false;
  const due = dueOf(d);
  return due > n.date || (due === n.date && !isAfterPayout(n));
}

// Extrarunde: nur am selben Tag bis zur Auszahlung spielbar
function extraOpen(d, n = T.now()) {
  return !!d && d.kind === 'extra' && !d.paid && d.date === n.date && !isAfterPayout(n);
}

// Runde, auf die geantwortet werden darf: heute, eine offene Nachholrunde oder die Extrarunde
function playableDay(game, date, kind = 'day') {
  const n = T.now();
  if (kind === 'extra') {
    const d = getDay(game.id, date || n.date, 'extra');
    if (!extraOpen(d, n)) throw httpError(409, 'Die Extrarunde ist nicht offen.');
    return d;
  }
  if (!date || date === n.date) {
    const st = todayState(game);
    if (st.state !== 'open') throw httpError(409, 'Die heutige Runde ist geschlossen.');
    return st.day;
  }
  const d = getDay(game.id, date);
  if (!replayOpen(d, n)) throw httpError(409, 'Diese Runde ist nicht offen.');
  return d;
}

// Status der heutigen Runde
function todayState(game) {
  const n = T.now();
  if (n.date < game.week_start) return { state: 'upcoming', date: n.date };
  if (n.hour < cfg.OPEN_HOUR) return { state: 'waiting', date: n.date };
  const day = getDay(game.id, n.date);
  if (day && day.paid) return { state: 'paid', date: n.date, day }; // auch nach vorzeitiger Admin-Auszahlung
  if (isAfterPayout(n)) return { state: day && day.paid ? 'paid' : 'closed', date: n.date, day };
  return { state: 'open', date: n.date, day: day || createDay(game, n.date) };
}

function answer(game, player, idx, choice, date, kind) {
  const day = playableDay(game, date, kind);
  if (!Number.isInteger(idx) || idx < 0 || idx >= day.questions.length) throw httpError(400, 'Ungültige Frage.');
  if (!Number.isInteger(choice) || choice < 0 || choice >= day.questions[idx].options.length) throw httpError(400, 'Ungültige Antwort.');
  const j = jokersOf(day.id, player.id).find((x) => x.idx === idx);
  if (j && j.removed.includes(choice)) throw httpError(400, 'Diese Antwort wurde vom Joker entfernt.');
  const r = db.prepare('INSERT OR IGNORE INTO answers (day_id, player_id, idx, choice) VALUES (?, ?, ?, ?)')
    .run(day.id, player.id, idx, choice);
  if (!r.changes) throw httpError(409, 'Diese Frage hast du schon beantwortet.');
  const mine = answersOf(day.id, player.id);
  if (Object.keys(mine).length === day.questions.length) {
    try { onRoundFinished(game, player, day); } catch (e) { console.error('[Push] Fehler bei Rundenende', e); }
  }
  return mine;
}

const roundName = (d) => (d.kind === 'extra' ? 'Extrarunde' : d.replay ? `Nachholrunde für ${fmtDe(d.date)}` : 'Tagesrunde');
const finishedRound = (d, playerId) =>
  db.prepare('SELECT COUNT(*) AS c FROM answers WHERE day_id = ? AND player_id = ?').get(d.id, playerId).c >= d.questions.length;

// Spieler hat alle Fragen einer Runde beantwortet -> Partner benachrichtigen, ggf. Extrarunde anbieten
function onRoundFinished(game, player, day) {
  const players = gamePlayers(game.id);
  const url = day.kind === 'extra' ? gameUrl(game, `/extra/${day.date}`) : day.replay ? gameUrl(game, `/tag/${day.date}`) : gameUrl(game);
  for (const p of players.filter((x) => x.id !== player.id)) {
    const done = finishedRound(day, p.id);
    P.send([p.id], done
      ? { title: `${player.name} ist auch fertig ✅`, body: `Ihr habt beide die ${roundName(day)} gespielt. Auflösung um ${hh(cfg.PAYOUT_HOUR)} Uhr.`, url, tag: `done-${game.code}-${day.id}` }
      : { title: `${player.name} hat gespielt 🎯`, body: `${player.name} hat die ${roundName(day)} abgeschlossen – jetzt bist du dran!`, url, tag: `done-${game.code}-${day.id}` });
  }

  // Extrarunde anbieten: normale Tagesrunde, alle fertig, vor EXTRA_BEFORE_HOUR
  const n = T.now();
  if (day.kind === 'day' && !day.replay && day.date === n.date && n.hour < cfg.EXTRA_BEFORE_HOUR && players.length >= 2
      && players.every((p) => finishedRound(day, p.id)) && !getExtraOffer(game, n.date)) {
    saveExtraOffer(game, n.date, { ok: [], declinedBy: null, at: new Date().toISOString() });
    P.send(players.map((p) => p.id), {
      title: 'Lust auf eine Extrarunde? 🎲',
      body: `Ihr habt beide vor ${hh(cfg.EXTRA_BEFORE_HOUR)} Uhr gespielt. ${cfg.EXTRA_QUESTIONS} Extra-Fragen – wenn beide zustimmen.`,
      url: gameUrl(game), tag: `extra-${game.code}-${n.date}`,
    });
  }
}

// ---------- Extrarunde ----------

function getExtraOffer(game, date) {
  const r = db.prepare('SELECT data FROM extra_offers WHERE game_id = ? AND date = ?').get(game.id, date);
  return r ? JSON.parse(r.data) : null;
}
const saveExtraOffer = (game, date, o) =>
  db.prepare('INSERT OR REPLACE INTO extra_offers (game_id, date, data) VALUES (?, ?, ?)').run(game.id, date, JSON.stringify(o));

function answerExtra(game, player, accept) {
  const n = T.now();
  const offer = getExtraOffer(game, n.date);
  if (!offer || isAfterPayout(n)) throw httpError(409, 'Heute gibt es kein Angebot für eine Extrarunde.');
  if (offer.declinedBy) throw httpError(409, 'Die Extrarunde wurde abgelehnt.');
  if (getDay(game.id, n.date, 'extra')) throw httpError(409, 'Die Extrarunde läuft schon.');
  const players = gamePlayers(game.id);
  const others = players.filter((p) => p.id !== player.id).map((p) => p.id);

  if (!accept) {
    offer.declinedBy = player.id;
    saveExtraOffer(game, n.date, offer);
    P.send(others, { title: 'Keine Extrarunde heute', body: `${player.name} hat die Extrarunde abgelehnt. Bis zur Auflösung um ${hh(cfg.PAYOUT_HOUR)} Uhr!`, url: gameUrl(game), tag: `extra-${game.code}-${n.date}` });
    return { status: 'declined' };
  }
  if (!offer.ok.includes(player.id)) offer.ok.push(player.id);
  saveExtraOffer(game, n.date, offer);

  if (!players.every((p) => offer.ok.includes(p.id))) {
    P.send(others, { title: `${player.name} will eine Extrarunde 🎲`, body: `${cfg.EXTRA_QUESTIONS} zusätzliche Fragen – stimmst du auch zu?`, url: gameUrl(game), tag: `extra-${game.code}-${n.date}` });
    return { status: 'pending' };
  }

  tx(() => {
    const { questions } = newQuestions(game, n.date, cfg.EXTRA_QUESTIONS, true);
    db.prepare("INSERT OR IGNORE INTO days (game_id, date, kind, week_no, questions, due_date) VALUES (?, ?, 'extra', ?, ?, ?)")
      .run(game.id, n.date, game.week_no, JSON.stringify(questions), n.date);
  });
  P.send(players.map((p) => p.id), {
    title: 'Extrarunde startet! 🎲', body: `Beide sind dabei: ${cfg.EXTRA_QUESTIONS} Extra-Fragen bis ${hh(cfg.PAYOUT_HOUR)} Uhr.`,
    url: gameUrl(game, `/extra/${n.date}`), tag: `extra-${game.code}-${n.date}`,
  });
  return { status: 'started' };
}

// Status der Extrarunde für die Ansicht
function extraView(game, me) {
  const n = T.now();
  const offer = getExtraOffer(game, n.date);
  const round = getDay(game.id, n.date, 'extra');
  if (!offer && !round) return null;
  const players = gamePlayers(game.id);
  return {
    date: n.date, questions: cfg.EXTRA_QUESTIONS, deadline: cfg.PAYOUT_HOUR,
    status: round ? (round.paid ? 'paid' : extraOpen(round, n) ? 'open' : 'closed') : offer.declinedBy ? 'declined' : isAfterPayout(n) ? 'expired' : 'offer',
    declinedBy: offer && offer.declinedBy ? players.find((p) => p.id === offer.declinedBy)?.name || '?' : null,
    accepted: offer ? offer.ok.includes(me.id) : false,
    waitingFor: offer ? players.filter((p) => !offer.ok.includes(p.id)).map((p) => p.name) : [],
    finished: round ? finishedRound(round, me.id) : false,
  };
}

// ---------- 50:50-Joker ----------

const jokersOf = (dayId, playerId) =>
  db.prepare('SELECT idx, removed FROM jokers WHERE day_id = ? AND player_id = ?').all(dayId, playerId)
    .map((j) => ({ idx: j.idx, removed: JSON.parse(j.removed) }));

function useJoker(game, player, idx, date, kind) {
  const day = playableDay(game, date, kind);
  if (!Number.isInteger(idx) || idx < 0 || idx >= day.questions.length) throw httpError(400, 'Ungültige Frage.');
  if (answersOf(day.id, player.id)[idx] !== undefined) throw httpError(409, 'Diese Frage ist schon beantwortet.');
  const used = jokersOf(day.id, player.id);
  if (used.some((j) => j.idx === idx)) return used.find((j) => j.idx === idx);
  if (used.length >= cfg.JOKERS_PER_DAY) throw httpError(409, 'Dein Joker für diese Runde ist schon verbraucht.');

  const q = day.questions[idx];
  const wrong = q.options.map((_, i) => i).filter((i) => i !== q.answer);
  const removed = shuffle(wrong).slice(0, Math.max(0, q.options.length - 2)).sort();
  db.prepare('INSERT INTO jokers (day_id, player_id, idx, removed) VALUES (?, ?, ?, ?)')
    .run(day.id, player.id, idx, JSON.stringify(removed));
  return { idx, removed };
}

function answersOf(dayId, playerId) {
  const out = {};
  db.prepare('SELECT idx, choice FROM answers WHERE day_id = ? AND player_id = ?').all(dayId, playerId)
    .forEach((a) => (out[a.idx] = a.choice));
  return out;
}

// ---------- Auszahlung ----------

function payoutDay(day) {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(day.game_id);
  const players = gamePlayers(day.game_id);
  const total = day.questions.length;
  const summary = [];

  tx(() => {
    const fresh = db.prepare('SELECT paid FROM days WHERE id = ?').get(day.id);
    if (fresh.paid) return;
    for (const p of players) {
      const ans = answersOf(day.id, p.id);
      const correct = day.questions.filter((q, i) => ans[i] === q.answer).length;
      const points = correct * cfg.POINTS_PER_CORRECT + (correct === total && total > 0 ? cfg.PERFECT_DAY_BONUS : 0);
      db.prepare('INSERT OR REPLACE INTO results (day_id, player_id, correct, total, points) VALUES (?, ?, ?, ?, ?)')
        .run(day.id, p.id, correct, total, points);
      if (points > 0) {
        const kind = day.kind === 'extra' ? 'Extrarunde' : day.replay ? 'Nachholrunde' : 'Tagesrunde';
        const reason = correct === total ? `${kind}: ${correct}/${total} richtig (inkl. Perfekt-Bonus)` : `${kind}: ${correct}/${total} richtig`;
        db.prepare('INSERT INTO ledger (game_id, player_id, amount, reason, ref) VALUES (?, ?, ?, ?, ?)')
          .run(day.game_id, p.id, points, reason, day.date);
      }
      summary.push({ id: p.id, name: p.name, correct, total, points, balance: p.balance + points });
    }
    db.prepare('UPDATE days SET paid = 1 WHERE id = ?').run(day.id);
  });

  console.log(`[Auszahlung] ${game.code} ${day.date}:`, summary.map((s) => `${s.name} ${s.correct}/${s.total} +${s.points}`).join(', '));
  if (summary.length) notify({ type: 'payout', game: game.name, code: game.code, date: day.date, kind: day.kind, results: summary.map(({ id, ...r }) => r) });
  return { game, day, summary };
}

// Eine Push-Nachricht pro Spiel und Spieler mit allen gerade ausgezahlten Runden
function pushPayouts(paid) {
  const byGame = {};
  for (const r of paid) if (r && r.summary.length) (byGame[r.game.id] = byGame[r.game.id] || []).push(r);
  for (const list of Object.values(byGame)) {
    const game = list[0].game;
    for (const me of list[0].summary) {
      const lines = list.map(({ day, summary }) => {
        const mine = summary.find((x) => x.id === me.id);
        const others = summary.filter((x) => x.id !== me.id).map((x) => `${x.name} ${x.correct}/${x.total}`).join(', ');
        return `${roundName(day)}: Du ${mine ? `${mine.correct}/${mine.total} (+${mine.points} P)` : '–'}${others ? ` · ${others}` : ''}`;
      });
      P.send([me.id], { title: 'Kassensturz! 💰 Die Auflösung ist da', body: lines.join('\n'), url: gameUrl(game), tag: `payout-${game.code}` });
    }
  }
}

// Morgens: „Neue Tagesrunde“ an alle, die heute noch nicht gespielt haben
function morningPush(n) {
  const start = Math.max(cfg.MORNING_HOUR, cfg.OPEN_HOUR);
  if (n.hour < start || isAfterPayout(n)) return;
  for (const g of db.prepare('SELECT * FROM games WHERE week_start <= ?').all(n.date)) {
    if (!P.once(g.id, `morning:${n.date}`)) continue;
    const players = gamePlayers(g.id);
    const day = getDay(g.id, n.date, 'day');
    const todo = players.filter((p) => !day || !finishedRound(day, p.id)).map((p) => p.id);
    P.send(todo, {
      title: 'Neue Tagesrunde ☀️', body: `${g.per_day} neue Fragen in „${g.name}“ warten auf dich. Auszahlung um ${hh(cfg.PAYOUT_HOUR)} Uhr.`,
      url: `/#/g/${g.code}`, tag: `morning-${g.code}`,
    });
  }
}

// ---------- Tag wiederholen / streichen (mit Zustimmung aller Mitspieler) ----------
//
// replay: Punkte des Tages werden storniert, es gibt neue Fragen als Nachholrunde bis zur nächsten Auszahlung.
//         Funktioniert auch für Tage, an denen gar nicht gespielt wurde (z. B. Server war aus).
// void:   Punkte des Tages werden storniert, der Tag zählt nicht.

const ACTIONS = { replay: 'wiederholen', void: 'streichen' };

function checkActionable(game, date, type) {
  const n = T.now();
  if (!ACTIONS[type]) throw httpError(400, 'Unbekannte Aktion.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Ungültiges Datum.');
  const end = T.addDays(game.week_start, cfg.WEEK_DAYS - 1);
  if (date < game.week_start || date > end) throw httpError(409, 'Nur Tage der laufenden Woche können geändert werden.');
  const d = getDay(game.id, date);
  if (date > n.date || (date === n.date && !(d && d.paid))) throw httpError(409, 'Die Runde läuft noch – das geht erst nach der Auszahlung.');
  if (d && !d.paid) throw httpError(409, 'Für diesen Tag läuft schon eine Nachholrunde.');
  if (d && d.voided && type === 'void') throw httpError(409, 'Der Tag ist schon gestrichen.');
  if (!d && type === 'void') throw httpError(409, 'An diesem Tag gibt es keine Punkte zu streichen.');
  if (type === 'replay' && date === end && n.date === end && isAfterPayout(n)) throw httpError(409, 'Die Woche ist schon abgerechnet.');
  return d;
}

function requestDayAction(game, player, date, type) {
  checkActionable(game, date, type);
  if (getRequest(game, date)) throw httpError(409, 'Für diesen Tag gibt es schon eine offene Anfrage.');
  const req = { type, by: player.id, at: new Date().toISOString(), ok: [player.id] };
  saveRequest(game, date, req);
  P.send(gamePlayers(game.id).filter((p) => p.id !== player.id).map((p) => p.id), {
    title: `${player.name} möchte einen Tag ${ACTIONS[type]}`, body: `${fmtDe(date)} ${ACTIONS[type]} – stimmst du zu?`,
    url: gameUrl(game), tag: `req-${game.code}-${date}`,
  });
  notify({ type: 'request', game: game.name, code: game.code, date, action: type, by: player.name });
  return applyIfAgreed(game, date, req);
}

function getRequest(game, date) {
  const r = db.prepare('SELECT data FROM day_requests WHERE game_id = ? AND date = ?').get(game.id, date);
  return r ? JSON.parse(r.data) : null;
}

function saveRequest(game, date, req) {
  if (req) db.prepare('INSERT OR REPLACE INTO day_requests (game_id, date, data) VALUES (?, ?, ?)').run(game.id, date, JSON.stringify(req));
  else db.prepare('DELETE FROM day_requests WHERE game_id = ? AND date = ?').run(game.id, date);
}

function answerDayRequest(game, player, date, accept) {
  const req = getRequest(game, date);
  if (!req) throw httpError(404, 'Keine offene Anfrage für diesen Tag.');
  if (!accept) { saveRequest(game, date, null); return { status: 'rejected' }; }
  if (!req.ok.includes(player.id)) req.ok.push(player.id);
  saveRequest(game, date, req);
  return applyIfAgreed(game, date, req);
}

function applyIfAgreed(game, date, req) {
  const ids = gamePlayers(game.id).map((p) => p.id);
  if (!ids.every((id) => req.ok.includes(id))) return { status: 'pending' };
  try { checkActionable(game, date, req.type); } catch (e) { saveRequest(game, date, null); throw e; }
  const n = T.now();
  const players = gamePlayers(game.id);
  let d = getDay(game.id, date);

  tx(() => {
    if (d) {
      // Punkte stornieren und alten Stand archivieren
      const results = db.prepare('SELECT player_id, correct, total, points FROM results WHERE day_id = ?').all(d.id);
      for (const r of results) {
        if (r.points > 0) {
          db.prepare('INSERT INTO ledger (game_id, player_id, amount, reason, ref) VALUES (?, ?, ?, ?, ?)')
            .run(game.id, r.player_id, -r.points, req.type === 'void' ? 'Storno: Tag gestrichen' : 'Storno: Tag wird wiederholt', date);
        }
      }
      d.history.push({
        at: new Date().toISOString(), action: req.type, by: req.by,
        questions: d.questions, results,
        answers: db.prepare('SELECT player_id, idx, choice FROM answers WHERE day_id = ?').all(d.id),
        jokers: db.prepare('SELECT player_id, idx, removed FROM jokers WHERE day_id = ?').all(d.id),
      });
      ['results', 'answers', 'jokers'].forEach((t) => db.prepare(`DELETE FROM ${t} WHERE day_id = ?`).run(d.id));
    }

    if (req.type === 'void') {
      db.prepare('UPDATE days SET voided = 1, history = ? WHERE id = ?').run(JSON.stringify(d.history), d.id);
    } else {
      const due = freshStart(n); // spielbar bis zur nächsten Auszahlung
      if (d) {
        const { genre, questions } = newQuestions(game, date);
        db.prepare(`UPDATE days SET questions = ?, genre = ?, paid = 0, voided = 0, replay = replay + 1,
          due_date = ?, history = ? WHERE id = ?`)
          .run(JSON.stringify(questions), genre, due, JSON.stringify(d.history), d.id);
      } else {
        const { genre, questions } = newQuestions(game, date);
        db.prepare('INSERT INTO days (game_id, date, week_no, genre, questions, due_date, replay) VALUES (?, ?, ?, ?, ?, ?, 1)')
          .run(game.id, date, game.week_no, genre, JSON.stringify(questions), due);
      }
    }
  });
  saveRequest(game, date, null);
  console.log(`[Tag] ${game.code} ${date}: ${ACTIONS[req.type]} (von allen bestätigt)`);
  P.send(players.map((p) => p.id), req.type === 'void'
    ? { title: 'Tag gestrichen', body: `${fmtDe(date)} zählt nicht, die Punkte wurden zurückgebucht.`, url: gameUrl(game, '/woche'), tag: `req-${game.code}-${date}` }
    : { title: 'Nachholrunde ist offen 🔁', body: `Neue Fragen für ${fmtDe(date)} – spielbar bis zur nächsten Auszahlung.`, url: gameUrl(game, `/tag/${date}`), tag: `req-${game.code}-${date}` });
  notify({ type: req.type === 'void' ? 'day_voided' : 'day_replay', game: game.name, code: game.code, date,
    players: players.map((p) => p.name) });
  return { status: req.type === 'void' ? 'voided' : 'replay' };
}

// Woche abschließen, wenn der letzte Tag ausgezahlt ist
function closeWeekIfDue(game) {
  const n = T.now();
  const end = T.addDays(game.week_start, cfg.WEEK_DAYS - 1);
  if (!(n.date > end || (n.date === end && isAfterPayout(n)))) return false;

  const played = db.prepare('SELECT COUNT(*) AS c FROM days WHERE game_id = ? AND week_no = ?').get(game.id, game.week_no).c;
  if (!played) {
    // Niemand hat gespielt: Woche einfach neu starten, ohne Archiv-Eintrag
    db.prepare('UPDATE games SET week_start = ? WHERE id = ?').run(freshStart(n), game.id);
    return true;
  }

  const players = gamePlayers(game.id);
  const scores = {};
  players.forEach((p) => (scores[p.id] = 0));
  db.prepare(`SELECT r.player_id, SUM(r.points) AS pts FROM results r JOIN days d ON d.id = r.day_id
    WHERE d.game_id = ? AND d.week_no = ? GROUP BY r.player_id`).all(game.id, game.week_no)
    .forEach((r) => (scores[r.player_id] = r.pts));
  const max = Math.max(0, ...Object.values(scores));
  const winners = max > 0 ? Object.keys(scores).filter((id) => scores[id] === max).map(Number) : [];

  let next = T.addDays(end, 1);
  if (next < n.date) next = freshStart(n); // lange Pause -> ab heute/morgen neu

  tx(() => {
    db.prepare('INSERT OR IGNORE INTO weeks (game_id, week_no, start_date, end_date, scores, winners) VALUES (?, ?, ?, ?, ?, ?)')
      .run(game.id, game.week_no, game.week_start, end, JSON.stringify(scores), JSON.stringify(winners));
    for (const id of winners) {
      db.prepare('INSERT INTO ledger (game_id, player_id, amount, reason, ref) VALUES (?, ?, ?, ?, ?)')
        .run(game.id, id, cfg.WEEK_WIN_BONUS, winners.length > 1 ? `Wochensieg (geteilt), Woche ${game.week_no}` : `Wochensieg, Woche ${game.week_no}`, `W${game.week_no}`);
    }
    db.prepare('UPDATE games SET week_no = week_no + 1, week_start = ? WHERE id = ?').run(next, game.id);
  });

  const names = players.filter((p) => winners.includes(p.id)).map((p) => p.name);
  console.log(`[Woche] ${game.code} Woche ${game.week_no} beendet. Sieger: ${names.join(', ') || '–'}`);
  notify({ type: 'week', game: game.name, code: game.code, week: game.week_no, winners: names,
    scores: players.map((p) => ({ name: p.name, points: scores[p.id] })) });
  return true;
}

// Läuft jede Minute (und bei Bedarf). force = heutige Runden sofort auszahlen (Admin/Test).
function tick(force = false) {
  const n = T.now();
  const due = db.prepare('SELECT * FROM days WHERE paid = 0').all().filter((d) =>
    dueOf(d) < n.date || (dueOf(d) === n.date && (isAfterPayout(n) || force)));
  const paid = [];
  for (const d of due) {
    parseDay(d);
    try { paid.push(payoutDay(d)); } catch (e) { console.error('[Auszahlung] Fehler', e); }
  }
  try { pushPayouts(paid); } catch (e) { console.error('[Push]', e); }
  try { morningPush(n); } catch (e) { console.error('[Push]', e); }
  for (const g of db.prepare('SELECT * FROM games').all()) {
    g.genres = JSON.parse(g.genres);
    let guard = 0;
    try { while (guard++ < 60 && closeWeekIfDue(getGame(g.code))); } catch (e) { console.error('[Woche] Fehler', e); }
  }
}

// ---------- Ansichten für die API ----------

function overview(game, me) {
  const players = gamePlayers(game.id);
  const weekEnd = T.addDays(game.week_start, cfg.WEEK_DAYS - 1);
  const n = T.now();

  const weekScores = {};
  players.forEach((p) => (weekScores[p.id] = 0));
  db.prepare(`SELECT r.player_id, SUM(r.points) AS pts FROM results r JOIN days d ON d.id = r.day_id
    WHERE d.game_id = ? AND d.week_no = ? GROUP BY r.player_id`).all(game.id, game.week_no)
    .forEach((r) => (weekScores[r.player_id] = r.pts));

  const days = db.prepare('SELECT * FROM days WHERE game_id = ? ORDER BY date DESC LIMIT 60').all(game.id)
    .map(parseDay).map((d) => ({
      date: d.date, kind: d.kind, week: d.week_no, genre: d.genre, paid: !!d.paid, voided: !!d.voided, replay: d.replay,
      due: dueOf(d), replayOpen: replayOpen(d, n),
      results: d.paid ? db.prepare('SELECT player_id AS id, correct, total, points FROM results WHERE day_id = ?').all(d.id) : [],
    }));

  // Offene Anfragen (Wiederholen/Streichen) für die laufende Woche
  const names = Object.fromEntries(players.map((p) => [p.id, p.name]));
  const weekEndDate = T.addDays(game.week_start, cfg.WEEK_DAYS - 1);
  // Anfragen aus vergangenen Wochen verfallen
  db.prepare('DELETE FROM day_requests WHERE game_id = ? AND (date < ? OR date > ?)').run(game.id, game.week_start, weekEndDate);
  const requests = db.prepare('SELECT date, data FROM day_requests WHERE game_id = ?').all(game.id)
    .map((r) => ({ date: r.date, ...JSON.parse(r.data) }));
  const reqView = requests.map((r) => ({
    date: r.date, type: r.type, by: r.by, byName: names[r.by] || '?', mine: r.by === me.id,
    needMe: !r.ok.includes(me.id), waitingFor: players.filter((p) => !r.ok.includes(p.id)).map((p) => p.name),
  })).sort((a, b) => a.date.localeCompare(b.date));

  const weeks = db.prepare('SELECT * FROM weeks WHERE game_id = ? ORDER BY week_no DESC').all(game.id)
    .map((w) => ({ week: w.week_no, start: w.start_date, end: w.end_date, scores: JSON.parse(w.scores), winners: JSON.parse(w.winners) }));

  return {
    code: game.code, name: game.name, genres: game.genres, mode: game.mode, perDay: game.per_day,
    difficulty: normDifficulty(game.difficulty),
    isOwner: game.owner_id === me.id, maxPlayers: cfg.MAX_PLAYERS, publicUrl: cfg.PUBLIC_URL,
    week: { no: game.week_no, start: game.week_start, end: weekEnd, length: cfg.WEEK_DAYS,
      day: n.date < game.week_start ? 0 : T.diffDays(game.week_start, n.date) + 1 },
    players: players.map((p) => ({ ...p, week: weekScores[p.id] || 0, me: p.id === me.id })),
    days, weeks, requests: reqView, today: n.date, afterPayout: isAfterPayout(n),
    extra: extraView(game, me), push: P.countFor(me.id) > 0,
    rules: { perCorrect: cfg.POINTS_PER_CORRECT, perfectBonus: cfg.PERFECT_DAY_BONUS, weekBonus: cfg.WEEK_WIN_BONUS, payoutHour: cfg.PAYOUT_HOUR,
      extraBefore: cfg.EXTRA_BEFORE_HOUR, extraQuestions: cfg.EXTRA_QUESTIONS },
    msUntilPayout: T.msUntilHour(cfg.PAYOUT_HOUR),
  };
}

function dayView(game, me, date, st, kind = 'day') {
  const day = st ? st.day : getDay(game.id, date, kind);
  if (!st && (replayOpen(day) || extraOpen(day))) st = { state: 'open', date, day };
  const base = { state: st ? st.state : day ? (day.paid ? 'paid' : 'pending') : 'none', date,
    kind: day ? day.kind : kind, replay: day ? day.replay : 0, voided: day ? !!day.voided : false, due: day ? dueOf(day) : date,
    msUntilPayout: T.msUntilHour(cfg.PAYOUT_HOUR), payoutHour: cfg.PAYOUT_HOUR };
  if (!day) return base;

  const players = gamePlayers(game.id);
  const reveal = !!day.paid;
  const mine = answersOf(day.id, me.id);
  const myJokers = jokersOf(day.id, me.id);

  const view = {
    ...base, genre: day.genre, week: day.week_no,
    questions: day.questions.map((q, i) => ({
      q: q.q, genre: q.genre, level: q.level || 2, options: q.options,
      ...(reveal ? { answer: q.answer } : {}),
      mine: mine[i] ?? null,
      removed: myJokers.find((j) => j.idx === i)?.removed || [],
    })),
    jokers: { total: cfg.JOKERS_PER_DAY, left: Math.max(0, cfg.JOKERS_PER_DAY - myJokers.length) },
    progress: players.map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, me: p.id === me.id,
      answered: db.prepare('SELECT COUNT(*) AS c FROM answers WHERE day_id = ? AND player_id = ?').get(day.id, p.id).c,
      total: day.questions.length,
    })),
  };
  if (reveal) {
    view.results = players.map((p) => {
      const r = db.prepare('SELECT correct, total, points FROM results WHERE day_id = ? AND player_id = ?').get(day.id, p.id)
        || { correct: 0, total: day.questions.length, points: 0 };
      return { id: p.id, name: p.name, avatar: p.avatar, me: p.id === me.id, ...r,
        answers: answersOf(day.id, p.id), jokers: jokersOf(day.id, p.id).map((j) => j.idx) };
    });
  }
  return view;
}

const ledgerOf = (gameId, playerId) => db.prepare(
  'SELECT amount, reason, ref, created_at FROM ledger WHERE game_id = ? AND player_id = ? ORDER BY id DESC LIMIT 200').all(gameId, playerId);

// ---------- Sonstiges ----------

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function notify(payload) {
  if (!cfg.WEBHOOK_URL) return;
  fetch(cfg.WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .catch((e) => console.error('[Webhook] fehlgeschlagen:', e.message));
}

module.exports = {
  createPlayer, playerByToken, createGame, getGame, joinGame, isMember, gamesOfPlayer,
  updateSettings, renamePlayer, setAvatar, clearAvatar, AVATAR_DIR, useJoker, requestDayAction, answerDayRequest, answerExtra,
  todayState, answer, tick, overview, dayView, ledgerOf, httpError,
};
