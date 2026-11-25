// Fragenkatalog laden: mitgelieferte Fragen (questions/*.json) + eigene JSON-Dateien aus /data/questions
//
// Format pro Datei: { "Genre": [ ...Fragen ] }. Eine Frage ist entweder
//   - Multiple Choice als Array: ["Frage", "richtig", "falsch 1", "falsch 2", "falsch 3", Stufe?, "Erklärung"?]
//     (Stufe: 1 = leicht, 2 = mittel, 3 = schwer – optional, Standard 2)
//   - ein Objekt mit "type":
//       {"type": "tf", "q": "Aussage", "answer": true, "level": 1, "explain": "…"}              Wahr/Falsch
//       {"type": "order", "q": "Ordne …", "items": ["1.", "2.", "3.", "4."], "level": 2}        Reihenfolge (richtig sortiert angeben)
//       {"type": "mc", "q": "…", "correct": "…", "wrong": ["…","…","…"], "image": "/pfad.png"}  Multiple Choice, optional mit Bild
//       {"type": "estimate", "q": "…", "answer": 330, "unit": "Meter"}                          Schätzfrage (nur Duell-Frage)
// flaggen.json erzeugt automatisch Bildfragen „Welches Land hat diese Flagge?“.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clampLevel = (l) => (typeof l === 'number' ? Math.min(3, Math.max(1, Math.round(l))) : 2);

let bank = [];      // Rundenfragen
let estimates = []; // Schätzfragen für das Duell
let genres = [];

function addRow(genre, row, id) {
  if (Array.isArray(row)) {
    const strings = row.filter((x) => typeof x === 'string');
    if (strings.length < 3) return;
    const [q, correct, ...rest] = strings;
    const wrong = rest.slice(0, 3);
    const explain = rest.length > 3 ? rest[3] : '';
    const level = clampLevel(row.find((x) => typeof x === 'number'));
    bank.push({ id, genre, type: 'mc', q, correct, wrong, level, explain });
    return;
  }
  if (!row || typeof row !== 'object' || typeof row.q !== 'string') return;
  const base = { id, genre, q: row.q, level: clampLevel(row.level), explain: row.explain || '' };
  switch (row.type) {
    case 'tf':
      if (typeof row.answer === 'boolean') bank.push({ ...base, type: 'tf', answer: row.answer });
      break;
    case 'order':
      if (Array.isArray(row.items) && row.items.length >= 3) bank.push({ ...base, type: 'order', items: row.items.slice(0, 6) });
      break;
    case 'estimate':
      if (typeof row.answer === 'number') estimates.push({ ...base, type: 'estimate', answer: row.answer, unit: row.unit || '' });
      break;
    case 'mc':
    case undefined:
      if (row.correct && Array.isArray(row.wrong) && row.wrong.length) {
        bank.push({ ...base, type: row.image ? 'image' : 'mc', correct: row.correct, wrong: row.wrong.slice(0, 3), image: row.image || null });
      }
      break;
    default:
  }
}

function addFile(file, prefix) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw.laender)) return addFlags(raw.laender);
  for (const [genre, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    list.forEach((row, i) => addRow(genre, row, `${prefix}:${slug(genre)}:${i}`));
  }
}

// Flaggen als Bildfragen (Genre Geografie). Falsche Antworten werden beim Erstellen der Runde gewählt.
function addFlags(list) {
  const names = list.map((l) => ({ name: l[1], level: l[3] }));
  for (const [code, name, hint, level] of list) {
    bank.push({
      id: `flag:${code}`, genre: 'Geografie', type: 'image', q: 'Welches Land hat diese Flagge?',
      image: `/flags/${code}.svg`, correct: name, wrong: null, level: clampLevel(level), explain: hint || '',
      wrongPool: names.filter((n) => n.name !== name),
    });
  }
}

function load() {
  bank = []; estimates = [];
  const builtin = path.join(__dirname, '..', 'questions');
  for (const f of fs.readdirSync(builtin).filter((f) => f.endsWith('.json')).sort()) {
    addFile(path.join(builtin, f), f === 'fragen.json' ? 'base' : slug(f.replace(/\.json$/, '')));
  }
  const extra = path.join(DATA_DIR, 'questions');
  if (fs.existsSync(extra)) {
    for (const f of fs.readdirSync(extra).filter((f) => f.endsWith('.json')).sort()) {
      try { addFile(path.join(extra, f), slug(f.replace(/\.json$/, ''))); }
      catch (e) { console.error(`[Fragen] ${f} konnte nicht gelesen werden:`, e.message); }
    }
  }
  const counts = {};
  bank.forEach((q) => {
    const c = (counts[q.genre] = counts[q.genre] || { count: 0, levels: { 1: 0, 2: 0, 3: 0 }, types: {} });
    c.count++; c.levels[q.level]++; c.types[q.type] = (c.types[q.type] || 0) + 1;
  });
  genres = Object.entries(counts).map(([name, c]) => ({ name, ...c }));
  const types = bank.reduce((a, q) => ((a[q.type] = (a[q.type] || 0) + 1), a), {});
  console.log(`[Fragen] ${bank.length} Fragen in ${genres.length} Genres (${Object.entries(types).map(([t, n]) => `${t}: ${n}`).join(', ')}), ${estimates.length} Schätzfragen`);
}

load();

module.exports = {
  all: () => bank,
  estimates: () => estimates,
  genres: () => genres,
  byId: (id) => bank.find((q) => q.id === id) || estimates.find((q) => q.id === id),
  reload: load,
};
