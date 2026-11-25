// Training: alleine üben. Jede Antwort wird sofort aufgelöst, es gibt keine Punkte und kein Warten.
// Neue Runden lassen sich jederzeit starten. Fragen aus dem Training kommen im Duell erst, wenn sonst nichts mehr da ist.
const { db, tx } = require('./db');
const Q = require('./questions');
const G = () => require('./game');

const httpError = (status, message) => Object.assign(new Error(message), { status });
const COUNTS = [5, 10, 20];

// Fragen, die der Spieler in einem Duell-Spiel schon hatte (über die verwendeten Fragen seiner Spiele)
const gameSeen = (playerId) => new Set(db.prepare(`SELECT DISTINCT u.qid FROM used_questions u
  JOIN game_players gp ON gp.game_id = u.game_id WHERE gp.player_id = ?`).all(playerId).map((r) => r.qid));
const trainSeen = (playerId) => new Set(db.prepare('SELECT DISTINCT qid FROM train_answers WHERE player_id = ?').all(playerId).map((r) => r.qid));

// Offene Fehler: zuletzt falsch beantwortet (im Training oder in einer ausgezahlten Spielrunde)
function openMistakes(playerId) {
  const last = {}; // qid -> { ok, at }
  const put = (qid, ok, at) => { if (!last[qid] || last[qid].at <= at) last[qid] = { ok, at }; };
  const g = G();
  const days = db.prepare(`SELECT d.id, d.questions FROM days d JOIN game_players gp ON gp.game_id = d.game_id
    WHERE gp.player_id = ? AND d.paid = 1 AND d.voided = 0`).all(playerId);
  for (const d of days) {
    const qs = JSON.parse(d.questions);
    const rows = g.answerRows(d.id, playerId);
    for (const [i, a] of Object.entries(rows)) if (qs[i]) put(qs[i].id, g.isCorrect({ type: 'mc', ...qs[i] }, a), a.answered_at || '');
  }
  db.prepare('SELECT qid, correct, answered_at FROM train_answers WHERE player_id = ?').all(playerId).forEach((r) => put(r.qid, !!r.correct, r.answered_at));
  return new Set(Object.entries(last).filter(([, v]) => !v.ok).map(([k]) => k));
}

function start(player, { genres, difficulty, count, mode }) {
  const g = G();
  const known = new Set(Q.genres().map((x) => x.name));
  genres = (Array.isArray(genres) ? genres : []).filter((x) => known.has(x));
  if (!genres.length) genres = [...known];
  difficulty = g.normDifficulty(difficulty);
  count = COUNTS.includes(Number(count)) ? Number(count) : 10;
  mode = mode === 'fehler' ? 'fehler' : 'neu';

  const all = g.bank().filter((q) => genres.includes(q.genre));
  let picked;
  if (mode === 'fehler') {
    const wrong = openMistakes(player.id);
    picked = g.shuffle(all.filter((q) => wrong.has(q.id))).slice(0, count);
    if (!picked.length) throw httpError(409, 'Keine offenen Fehler in diesen Genres – stark! 💪');
  } else {
    const weights = g.DIFFICULTIES[difficulty];
    const weightOf = (q) => weights[q.level] || 0.2;
    const fitting = all.filter((q) => weights[q.level]);
    const tSeen = trainSeen(player.id);
    const gSeen = gameSeen(player.id);
    // 1. noch nie gesehen, 2. nur im Spiel gesehen, 3. alles der Stufe
    let pool = fitting.filter((q) => !tSeen.has(q.id) && !gSeen.has(q.id));
    if (pool.length < count) pool = fitting.filter((q) => !tSeen.has(q.id));
    if (pool.length < count) pool = fitting.length >= count ? fitting : all;
    picked = g.weightedOrder(pool, weightOf).slice(0, count)
      .sort((a, b) => a.level - b.level);
  }
  const questions = picked.map(g.snapshot);
  const r = db.prepare('INSERT INTO train_rounds (player_id, mode, settings, questions) VALUES (?, ?, ?, ?)')
    .run(player.id, mode, JSON.stringify({ genres, difficulty, count }), JSON.stringify(questions));
  return view(player, Number(r.lastInsertRowid));
}

function getRound(player, id) {
  const r = db.prepare('SELECT * FROM train_rounds WHERE id = ? AND player_id = ?').get(Number(id), player.id);
  if (!r) throw httpError(404, 'Trainingsrunde nicht gefunden.');
  r.questions = JSON.parse(r.questions);
  r.settings = JSON.parse(r.settings);
  return r;
}

// Antwort einer Frage für die Anzeige
const solution = (q) => ({ answer: q.answer, explain: q.explain || '', id: q.id });

function view(player, id) {
  const r = getRound(player, id);
  const given = Object.fromEntries(db.prepare('SELECT idx, correct, given FROM train_answers WHERE round_id = ?').all(r.id)
    .map((a) => [a.idx, { correct: !!a.correct, given: a.given ? JSON.parse(a.given) : null }]));
  return {
    id: r.id, mode: r.mode, settings: r.settings, finished: !!r.finished_at,
    questions: r.questions.map((q, i) => {
      const item = { type: q.type, genre: q.genre, level: q.level || 2, q: q.q, image: q.image || null };
      if (q.type === 'order') item.items = q.items; else item.options = q.options;
      if (given[i]) Object.assign(item, given[i], solution(q));
      return item;
    }),
    correct: Object.values(given).filter((a) => a.correct).length,
  };
}

function answer(player, id, idx, { choice, order }) {
  const g = G();
  const r = getRound(player, id);
  if (!Number.isInteger(idx) || idx < 0 || idx >= r.questions.length) throw httpError(400, 'Ungültige Frage.');
  const q = r.questions[idx];
  let a, given;
  if (q.type === 'order') {
    const n = q.items.length;
    if (!Array.isArray(order) || order.length !== n || new Set(order).size !== n || !order.every((v) => Number.isInteger(v) && v >= 0 && v < n)) {
      throw httpError(400, 'Bitte alle Einträge in eine Reihenfolge bringen.');
    }
    a = { choice: 0, value: order }; given = order;
  } else {
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) throw httpError(400, 'Ungültige Antwort.');
    a = { choice }; given = choice;
  }
  const correct = g.isCorrect(q, a);
  tx(() => {
    const ins = db.prepare(`INSERT OR IGNORE INTO train_answers (round_id, idx, player_id, qid, genre, level, correct, given)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(r.id, idx, player.id, q.id, q.genre, q.level || 2, correct ? 1 : 0, JSON.stringify(given));
    if (!ins.changes) throw httpError(409, 'Diese Frage hast du schon beantwortet.');
    const done = db.prepare('SELECT COUNT(*) AS c FROM train_answers WHERE round_id = ?').get(r.id).c >= r.questions.length;
    if (done) db.prepare('UPDATE train_rounds SET finished_at = CURRENT_TIMESTAMP WHERE id = ?').run(r.id);
  });
  return { correct, given, ...solution(q) };
}

function stats(player) {
  const g = G();
  const rows = db.prepare('SELECT genre, level, correct, answered_at FROM train_answers WHERE player_id = ?').all(player.id);
  const genres = {};
  rows.forEach((r) => { const x = (genres[r.genre] = genres[r.genre] || { n: 0, c: 0 }); x.n++; if (r.correct) x.c++; });
  const days = [...new Set(rows.map((r) => r.answered_at.slice(0, 10)))].sort();
  // Trainings-Serie: aufeinanderfolgende Tage bis heute/gestern
  let streak = 0;
  if (days.length) {
    const today = new Date().toISOString().slice(0, 10);
    let cur = new Date(days[days.length - 1] + 'T12:00:00Z');
    const diff = (new Date(today + 'T12:00:00Z') - cur) / 864e5;
    if (diff <= 1) {
      const set = new Set(days);
      while (set.has(cur.toISOString().slice(0, 10))) { streak++; cur = new Date(cur - 864e5); }
    }
  }
  const catalog = g.bank().length;
  const seen = new Set(db.prepare('SELECT DISTINCT qid FROM train_answers WHERE player_id = ?').all(player.id).map((r) => r.qid));
  const unfinished = db.prepare('SELECT id FROM train_rounds WHERE player_id = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1').get(player.id);
  return {
    answered: rows.length, correct: rows.filter((r) => r.correct).length,
    rounds: db.prepare('SELECT COUNT(*) AS c FROM train_rounds WHERE player_id = ? AND finished_at IS NOT NULL').get(player.id).c,
    streak, catalog, seen: seen.size, mistakes: openMistakes(player.id).size,
    genres: Object.entries(genres).map(([name, x]) => ({ name, ...x })).sort((a, b) => b.n - a.n),
    unfinished: unfinished ? unfinished.id : null,
  };
}

module.exports = { start, view, answer, stats, COUNTS };
