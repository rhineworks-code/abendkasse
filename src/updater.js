// Update-Funktion: prüft auf GitHub, ob ein neues Docker-Image gebaut wurde,
// und stößt auf Wunsch den Updater-Container (Watchtower) an, der das Image zieht und die App neu startet.
const cfg = require('./config');
const { db } = require('./db');
const P = require('./push');

const current = { sha: process.env.APP_VERSION || 'dev', date: process.env.BUILD_DATE || null };
let latest = null;   // { sha, date, message, changes, behind, checkedAt }
let lastError = null;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const managers = () => db.prepare('SELECT id FROM players WHERE is_admin = 1').all().map((r) => r.id);
const configured = () => !!(cfg.UPDATE_URL && cfg.UPDATE_TOKEN);
const available = () => !!latest && current.sha !== 'dev' && latest.sha !== current.sha;

async function gh(path) {
  const r = await fetch(`https://api.github.com/repos/${cfg.UPDATE_REPO}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'abendkasse-updater' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`GitHub antwortet mit ${r.status}`);
  return r.json();
}

// Neueste Version = letzter erfolgreicher Image-Build auf main (nicht nur der letzte Commit)
async function check() {
  if (!cfg.UPDATE_REPO) return status();
  try {
    const runs = await gh('/actions/runs?branch=main&status=success&per_page=1');
    const run = runs.workflow_runs && runs.workflow_runs[0];
    if (!run) throw new Error('Noch kein fertiger Build gefunden');
    latest = { sha: run.head_sha, date: run.updated_at, message: (run.head_commit?.message || '').split('\n')[0], changes: [], behind: 0, checkedAt: new Date().toISOString() };
    if (available()) {
      try {
        const cmp = await gh(`/compare/${current.sha}...${latest.sha}`);
        latest.behind = cmp.ahead_by || 0;
        latest.changes = (cmp.commits || []).map((c) => c.commit.message.split('\n')[0]).reverse().slice(0, 15);
      } catch (e) { latest.changes = [latest.message]; }
      if (P.once(0, `update:${latest.sha}`)) {
        P.send(managers(), { title: '⬆️ Update für Abendkasse verfügbar', body: latest.message || 'Eine neue Version ist bereit.', url: '/admin', tag: 'update' });
      }
    }
    lastError = null;
  } catch (e) {
    lastError = e.message;
    console.error('[Update] Prüfung fehlgeschlagen:', e.message);
  }
  return status();
}

function status() {
  return { current, latest, available: available(), configured: configured(), error: lastError, repo: cfg.UPDATE_REPO };
}

// Updater anstoßen. Vorher Sicherung. Die App wird dabei neu gestartet – die Antwort kommt evtl. nie an.
async function apply() {
  if (!configured()) throw httpError(409, 'Der Updater ist noch nicht eingerichtet (siehe README → Update aus der App).');
  try { await require('./backup').run(); } catch (e) { throw httpError(500, `Sicherung vor dem Update fehlgeschlagen: ${e.message}`); }
  console.log(`[Update] Starte Update ${current.sha.slice(0, 7)} → ${latest ? latest.sha.slice(0, 7) : '?'}`);
  const call = (method) => fetch(`${cfg.UPDATE_URL.replace(/\/$/, '')}/v1/update`, {
    method, headers: { Authorization: `Bearer ${cfg.UPDATE_TOKEN}` }, signal: AbortSignal.timeout(5000),
  });
  try {
    let r = await call('POST');
    if (r.status === 405) r = await call('GET');
    if (r.status === 401 || r.status === 403) throw httpError(502, 'Der Updater lehnt das Token ab (UPDATE_TOKEN prüfen).');
    if (!r.ok) throw httpError(502, `Der Updater meldet Fehler ${r.status}.`);
    return { started: true, finished: true }; // schnell fertig = es gab nichts zu tun oder es lief sehr schnell
  } catch (e) {
    if (e.status) throw e;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return { started: true }; // läuft – die App startet gleich neu
    throw httpError(502, `Updater nicht erreichbar (${e.cause?.code || e.message}).`);
  }
}

// Regelmäßig prüfen
if (cfg.UPDATE_REPO) {
  setTimeout(check, 20_000).unref();
  setInterval(check, Math.max(1, cfg.UPDATE_CHECK_HOURS) * 3600_000).unref();
}

module.exports = { check, status, apply, current };
