// Fragen melden („Antwort falsch“, „zu schwer“ …) und Korrekturen am Katalog
const { db } = require('./db');
const Q = require('./questions');

const REASONS = { wrong: 'Antwort falsch', hard: 'Zu schwer', easy: 'Zu leicht', unclear: 'Unklar formuliert', other: 'Sonstiges' };
const G = () => require('./game');

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// Frage aus einer Runde melden. idx = Fragenindex oder "duel"
function report(game, player, { date, kind, idx, reason, comment }) {
  if (!REASONS[reason]) throw httpError(400, 'Bitte einen Grund wählen.');
  const day = G().getDay(game.id, String(date || ''), kind === 'extra' ? 'extra' : 'day');
  if (!day) throw httpError(404, 'Runde nicht gefunden.');
  let q;
  if (idx === 'duel') q = day.duel ? { ...day.duel, type: 'estimate' } : null;
  else q = day.questions[Number(idx)];
  if (!q) throw httpError(404, 'Frage nicht gefunden.');
  // Vor der Auflösung nur aufgedeckte Fragen melden (sonst verrät die Meldung nichts, aber die Lösung bleibt geheim)
  const snap = { ...q };
  if (db.prepare('SELECT 1 FROM reports WHERE qid = ? AND player_id = ? AND reason = ? AND status = ?').get(q.id, player.id, reason, 'open')) {
    throw httpError(409, 'Du hast diese Frage schon aus diesem Grund gemeldet.');
  }
  db.prepare('INSERT INTO reports (qid, player_id, game_id, reason, comment, question) VALUES (?, ?, ?, ?, ?, ?)')
    .run(q.id, player.id, game.id, reason, String(comment || '').slice(0, 300), JSON.stringify(snap));
  return { ok: true };
}

// Katalog-Korrekturen gelten für alle Spiele -> nur Admins
const canManage = (player) => !!db.prepare('SELECT is_admin FROM players WHERE id = ?').get(player.id)?.is_admin;

// Trefferquote einer Frage über alle Runden aller Spiele
function questionStats(qids) {
  const want = new Set(qids);
  const out = {};
  for (const d of db.prepare('SELECT id, questions FROM days WHERE paid = 1').all()) {
    const qs = JSON.parse(d.questions);
    qs.forEach((q, i) => {
      if (!want.has(q.id)) return;
      const rows = db.prepare('SELECT choice, value FROM answers WHERE day_id = ? AND idx = ?').all(d.id, i);
      const s = (out[q.id] = out[q.id] || { answered: 0, correct: 0 });
      for (const a of rows) {
        s.answered++;
        const val = a.value ? JSON.parse(a.value) : null;
        if (G().isCorrect({ type: 'mc', ...q }, { choice: a.choice, value: val })) s.correct++;
      }
    });
  }
  return out;
}

function list(player, status = 'open') {
  if (!canManage(player)) throw httpError(403, 'Nur Admins können Meldungen bearbeiten.');
  const rows = db.prepare(`SELECT r.*, p.name AS player_name FROM reports r LEFT JOIN players p ON p.id = r.player_id
    WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 300`).all(status);
  const byQ = {};
  for (const r of rows) {
    const g = (byQ[r.qid] = byQ[r.qid] || { qid: r.qid, question: JSON.parse(r.question), reports: [], reasons: {} });
    g.reports.push({ id: r.id, reason: r.reason, reasonText: REASONS[r.reason], comment: r.comment, by: r.player_name, at: r.created_at });
    g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
  }
  const stats = questionStats(Object.keys(byQ));
  const ov = {};
  db.prepare('SELECT * FROM question_overrides').all().forEach((o) => (ov[o.qid] = o));
  return Object.values(byQ).map((g) => {
    const orig = Q.byId(g.qid);
    return { ...g, stats: stats[g.qid] || { answered: 0, correct: 0 }, level: ov[g.qid]?.level || orig?.level || g.question.level || 2,
      disabled: !!ov[g.qid]?.disabled, inCatalog: !!orig };
  });
}

// Stufe ändern / Frage deaktivieren / Meldungen erledigen
function resolve(player, qid, { level, disabled, dismiss }) {
  if (!canManage(player)) throw httpError(403, 'Nur Admins können Meldungen bearbeiten.');
  if (level !== undefined || disabled !== undefined) {
    const cur = db.prepare('SELECT * FROM question_overrides WHERE qid = ?').get(qid) || { level: null, disabled: 0 };
    const lv = level !== undefined ? (level ? Math.min(3, Math.max(1, Number(level))) : null) : cur.level;
    const dis = disabled !== undefined ? (disabled ? 1 : 0) : cur.disabled;
    db.prepare('INSERT OR REPLACE INTO question_overrides (qid, level, disabled, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(qid, lv, dis);
    G().loadOverrides();
  }
  db.prepare("UPDATE reports SET status = 'done' WHERE qid = ? AND status = 'open'").run(qid);
  return { ok: true, dismissed: !!dismiss };
}

const openCount = (player) => (canManage(player) ? db.prepare("SELECT COUNT(DISTINCT qid) AS c FROM reports WHERE status = 'open'").get().c : 0);

module.exports = { REASONS, report, list, resolve, canManage, openCount };
