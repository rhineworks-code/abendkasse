// Statistik und Abzeichen pro Spiel
const { db } = require('./db');
const cfg = require('./config');
const T = require('./time');
const P = require('./push');

const G = () => require('./game');
const rate = (s) => (s.n ? Math.round((s.c / s.n) * 100) : null);

function compute(gameId) {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  const players = G().gamePlayers(gameId);
  const days = db.prepare("SELECT * FROM days WHERE game_id = ? AND paid = 1 AND voided = 0 ORDER BY date").all(gameId)
    .map((d) => ({ ...d, questions: JSON.parse(d.questions).map((q) => ({ type: 'mc', ...q })), duel: d.duel ? JSON.parse(d.duel) : null }));

  const S = {};
  for (const p of players) {
    S[p.id] = {
      id: p.id, name: p.name, avatar: p.avatar,
      total: { n: 0, c: 0 }, genres: {}, levels: { 1: { n: 0, c: 0 }, 2: { n: 0, c: 0 }, 3: { n: 0, c: 0 } }, types: {},
      tempo: 0, stakeWon: 0, stakeLost: 0, stake30Won: 0, jokers: 0,
      duels: 0, duelsWon: 0, duelExact: 0, perfectDays: 0, perfectNoJoker: 0, extras: 0, playedDates: new Set(),
      dayWins: 0, draws: 0, weekWins: 0, points: 0,
    };
  }

  for (const d of days) {
    const res = {};
    db.prepare('SELECT player_id, correct, total, points FROM results WHERE day_id = ?').all(d.id).forEach((r) => (res[r.player_id] = r));
    const duelVals = {};
    db.prepare('SELECT player_id, value FROM duel_answers WHERE day_id = ?').all(d.id).forEach((r) => (duelVals[r.player_id] = r.value));
    for (const p of players) {
      const s = S[p.id];
      const rows = G().answerRows(d.id, p.id);
      const jokers = db.prepare('SELECT COUNT(*) AS c FROM jokers WHERE day_id = ? AND player_id = ?').get(d.id, p.id).c;
      s.jokers += jokers;
      if (Object.keys(rows).length) {
        if (d.kind === 'day') s.playedDates.add(d.date);
        if (d.kind === 'extra') s.extras++;
      }
      d.questions.forEach((q, i) => {
        const a = rows[i];
        if (!a) return;
        const ok = G().isCorrect(q, a);
        const add = (o) => { o.n++; if (ok) o.c++; };
        add(s.total);
        add((s.genres[q.genre] = s.genres[q.genre] || { n: 0, c: 0 }));
        add(s.levels[q.level || 2]);
        add((s.types[q.type] = s.types[q.type] || { n: 0, c: 0 }));
        if (ok && a.ms != null && a.ms <= cfg.TEMPO_SECONDS * 1000) s.tempo++;
        if (a.stake) { if (ok) { s.stakeWon += a.stake; if (a.stake >= cfg.MAX_STAKE) s.stake30Won++; } else s.stakeLost += a.stake; }
      });
      const r = res[p.id];
      if (r) {
        s.points += r.points;
        if (r.total > 0 && r.correct === r.total) { s.perfectDays++; if (!jokers) s.perfectNoJoker++; }
      }
      if (d.duel && duelVals[p.id] !== undefined) {
        s.duels++;
        const dist = Math.abs(duelVals[p.id] - d.duel.answer);
        const others = Object.entries(duelVals).filter(([id]) => +id !== p.id).map(([, v]) => Math.abs(v - d.duel.answer));
        if (others.every((o) => dist <= o)) s.duelsWon++;
        if (dist <= Math.abs(d.duel.answer) * 0.01) s.duelExact++;
      }
    }
    // Tagessieg im direkten Vergleich (nur Tagesrunden mit mindestens zwei Ergebnissen)
    const ids = Object.keys(res).map(Number).filter((id) => S[id]);
    if (d.kind === 'day' && ids.length >= 2) {
      const best = Math.max(...ids.map((id) => res[id].points));
      const top = ids.filter((id) => res[id].points === best);
      if (top.length === 1) S[top[0]].dayWins++; else top.forEach((id) => S[id].draws++);
    }
  }

  // Wochen: Siege und Verlauf
  const weeks = db.prepare('SELECT week_no, scores, winners FROM weeks WHERE game_id = ? ORDER BY week_no').all(gameId)
    .map((w) => ({ week: w.week_no, scores: JSON.parse(w.scores), winners: JSON.parse(w.winners) }));
  weeks.forEach((w) => w.winners.forEach((id) => S[id] && S[id].weekWins++));
  const current = {};
  db.prepare(`SELECT r.player_id, SUM(r.points) AS pts FROM results r JOIN days d ON d.id = r.day_id
    WHERE d.game_id = ? AND d.week_no = ? GROUP BY r.player_id`).all(gameId, game.week_no).forEach((r) => (current[r.player_id] = r.pts));
  const history = [...weeks.map((w) => ({ week: w.week, scores: w.scores, done: true })), { week: game.week_no, scores: current, done: false }];

  // Serien: aufeinanderfolgende Spieltage
  const today = T.now().date;
  for (const s of Object.values(S)) {
    const dates = [...s.playedDates].sort();
    let longest = 0, run = 0, prev = null;
    for (const d of dates) { run = prev && T.diffDays(prev, d) === 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = d; }
    let currentStreak = 0;
    if (prev && T.diffDays(prev, today) <= 1) currentStreak = run;
    s.streak = { current: currentStreak, longest };
    s.daysPlayed = dates.length;
    delete s.playedDates;
    s.total.rate = rate(s.total);
    for (const o of [...Object.values(s.genres), ...Object.values(s.levels), ...Object.values(s.types)]) o.rate = rate(o);
  }
  return { game, players: Object.values(S), history };
}

// ---------- Abzeichen ----------
const BADGES = [
  { key: 'perfect1', icon: '🌟', title: 'Perfekter Tag', desc: 'Alle Fragen einer Runde richtig', val: (s) => s.perfectDays, goal: 1 },
  { key: 'perfect5', icon: '💎', title: 'Perfektionist', desc: '5 perfekte Runden', val: (s) => s.perfectDays, goal: 5 },
  { key: 'nojoker', icon: '🎯', title: 'Ohne Netz', desc: 'Perfekte Runde ohne Joker', val: (s) => s.perfectNoJoker, goal: 1 },
  { key: 'week1', icon: '🏆', title: 'Wochensieger', desc: 'Eine Woche gewonnen', val: (s) => s.weekWins, goal: 1 },
  { key: 'week5', icon: '👑', title: 'Serienmeister', desc: '5 Wochen gewonnen', val: (s) => s.weekWins, goal: 5 },
  { key: 'week10', icon: '🏰', title: 'Dynastie', desc: '10 Wochen gewonnen', val: (s) => s.weekWins, goal: 10 },
  { key: 'streak7', icon: '🔥', title: 'Eine Woche dabei', desc: '7 Tage am Stück gespielt', val: (s) => s.streak.longest, goal: 7 },
  { key: 'streak30', icon: '🗓️', title: 'Unermüdlich', desc: '30 Tage am Stück gespielt', val: (s) => s.streak.longest, goal: 30 },
  { key: 'correct100', icon: '💯', title: 'Hundert', desc: '100 richtige Antworten', val: (s) => s.total.c, goal: 100 },
  { key: 'correct500', icon: '🧠', title: 'Quiz-Ass', desc: '500 richtige Antworten', val: (s) => s.total.c, goal: 500 },
  { key: 'tempo50', icon: '⚡', title: 'Blitzmerker', desc: '50-mal Tempo-Bonus', val: (s) => s.tempo, goal: 50 },
  { key: 'zocker', icon: '🎰', title: 'Zocker', desc: '10-mal den Höchsteinsatz gewonnen', val: (s) => s.stake30Won, goal: 10 },
  { key: 'duel10', icon: '⚔️', title: 'Duell-König', desc: '10 Duell-Fragen gewonnen', val: (s) => s.duelsWon, goal: 10 },
  { key: 'hellseher', icon: '🔮', title: 'Hellseher', desc: 'Duell-Frage auf 1 % genau geschätzt', val: (s) => s.duelExact, goal: 1 },
  { key: 'extra5', icon: '🎲', title: 'Nimmersatt', desc: '5 Extrarunden gespielt', val: (s) => s.extras, goal: 5 },
];
const genreBadge = (genre) => ({ key: `genre:${genre}`, icon: '🎓', title: `${genre}-Profi`, desc: `50 richtige Antworten in ${genre}`,
  val: (s) => (s.genres[genre] ? s.genres[genre].c : 0), goal: 50 });
const badgesFor = (game) => [...BADGES, ...JSON.parse(game.genres).map(genreBadge)];

function badgeView(game, s) {
  const earned = {};
  db.prepare('SELECT key, created_at FROM achievements WHERE game_id = ? AND player_id = ?').all(game.id, s.id).forEach((a) => (earned[a.key] = a.created_at));
  return badgesFor(game).map((b) => ({ key: b.key, icon: b.icon, title: b.title, desc: b.desc, goal: b.goal,
    progress: Math.min(b.goal, b.val(s)), earned: earned[b.key] || null }));
}

// Neue Abzeichen vergeben (nach jeder Auszahlung) und per Push melden
function award(gameId) {
  const { game, players } = compute(gameId);
  for (const s of players) {
    const fresh = [];
    for (const b of badgesFor(game)) {
      if (b.val(s) < b.goal) continue;
      const r = db.prepare('INSERT OR IGNORE INTO achievements (game_id, player_id, key) VALUES (?, ?, ?)').run(gameId, s.id, b.key);
      if (r.changes) fresh.push(b);
    }
    if (!fresh.length) continue;
    P.send([s.id], fresh.length === 1
      ? { title: `🏅 Neues Abzeichen: ${fresh[0].icon} ${fresh[0].title}`, body: fresh[0].desc, url: `/#/g/${game.code}/statistik`, tag: `badge-${game.code}` }
      : { title: `🏅 ${fresh.length} neue Abzeichen`, body: fresh.map((b) => `${b.icon} ${b.title}`).join(', '), url: `/#/g/${game.code}/statistik`, tag: `badge-${game.code}` });
  }
}
const awardAll = (ids) => [...new Set(ids.filter(Boolean))].forEach((id) => award(id));

// Ansicht für die Statistik-Seite
function view(gameId, me) {
  const { game, players, history } = compute(gameId);
  const mine = players.find((p) => p.id === me.id);
  const others = players.filter((p) => p.id !== me.id);
  // Vergleich: „Du bist in Geschichte stärker als Sarah“
  const insights = [];
  if (mine) {
    for (const o of others) {
      for (const [g, st] of Object.entries(mine.genres)) {
        const ot = o.genres[g];
        if (!ot || st.n < 5 || ot.n < 5) continue;
        const diff = st.rate - ot.rate;
        if (diff >= 10) insights.push({ good: true, text: `Du bist in ${g} stärker als ${o.name} (${st.rate} % zu ${ot.rate} %).`, diff });
        if (diff <= -10) insights.push({ good: false, text: `${o.name} ist in ${g} stärker als du (${ot.rate} % zu ${st.rate} %).`, diff: -diff });
      }
    }
  }
  insights.sort((a, b) => b.diff - a.diff);
  return {
    players: players.map((p) => ({ ...p, me: p.id === me.id, badges: badgeView(game, p) })),
    history, insights: insights.slice(0, 6), genres: JSON.parse(game.genres),
  };
}

module.exports = { compute, view, award, awardAll, BADGES };
