// Fragenkatalog laden: mitgelieferte Fragen + eigene JSON-Dateien aus /data/questions
//
// Format (pro Datei): { "Genre": [ ["Frage", "richtige Antwort", "falsch 1", "falsch 2", "falsch 3"], ... ] }
// Die richtige Antwort steht immer an Position 1 – gemischt wird beim Erstellen der Tagesrunde.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let bank = [];   // [{id, genre, q, correct, wrong:[...]}]
let genres = []; // [{name, count}]

function addFile(file, prefix) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [genre, list] of Object.entries(raw)) {
    list.forEach((row, i) => {
      if (!Array.isArray(row) || row.length < 3) return;
      const [q, correct, ...wrong] = row;
      bank.push({ id: `${prefix}:${slug(genre)}:${i}`, genre, q, correct, wrong: wrong.slice(0, 3) });
    });
  }
}

function load() {
  bank = [];
  // Mitgelieferte Fragen: questions/*.json (fragen.json behält das Präfix "base")
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
  bank.forEach((q) => { counts[q.genre] = (counts[q.genre] || 0) + 1; });
  genres = Object.entries(counts).map(([name, count]) => ({ name, count }));
  console.log(`[Fragen] ${bank.length} Fragen in ${genres.length} Genres geladen`);
}

load();

module.exports = {
  all: () => bank,
  genres: () => genres,
  reload: load,
};
