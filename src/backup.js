// Nächtliche Datensicherung nach BACKUP_DIR (z. B. eine eingebundene Synology-Freigabe)
// Inhalt: Datenbank (konsistente Kopie per VACUUM INTO), Push-Schlüssel, Profilbilder, eigene Fragen.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const T = require('./time');
const { db } = require('./db');

let last = null; // { at, dir, ok, error, size }

async function run() {
  const n = T.now();
  const name = `abendkasse-${n.date}`;
  const target = path.join(cfg.BACKUP_DIR, name);
  const tmp = path.join(cfg.BACKUP_DIR, `.${name}.tmp`);
  const localDb = path.join(cfg.DATA_DIR, '.backup.db');
  try {
    fs.mkdirSync(cfg.BACKUP_DIR, { recursive: true });
    fs.rmSync(localDb, { force: true });
    // erst lokal sichern (Netzfreigaben mögen SQLite-Sperren nicht), dann kopieren
    db.exec(`VACUUM INTO '${localDb.replace(/'/g, "''")}'`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    fs.copyFileSync(localDb, path.join(tmp, 'abendkasse.db'));
    fs.rmSync(localDb, { force: true });
    for (const f of ['vapid.json']) {
      const src = path.join(cfg.DATA_DIR, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, f));
    }
    for (const d of ['avatars', 'questions']) {
      const src = path.join(cfg.DATA_DIR, d);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, d), { recursive: true });
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);

    // Alte Sicherungen aufräumen
    const all = fs.readdirSync(cfg.BACKUP_DIR).filter((d) => /^abendkasse-\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
    for (const old of all.slice(Math.max(1, cfg.BACKUP_KEEP))) fs.rmSync(path.join(cfg.BACKUP_DIR, old), { recursive: true, force: true });

    const size = fs.statSync(path.join(target, 'abendkasse.db')).size;
    last = { at: new Date().toISOString(), dir: target, ok: true, size, kept: Math.min(all.length, cfg.BACKUP_KEEP) };
    console.log(`[Backup] gesichert nach ${target} (${Math.round(size / 1024)} KB)`);
  } catch (e) {
    last = { at: new Date().toISOString(), dir: target, ok: false, error: e.message };
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return last;
}

module.exports = { run, status: () => last };
