// Web-Push: Schlüssel verwalten, Abos speichern, Nachrichten senden
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const cfg = require('./config');
const { db } = require('./db');

// VAPID-Schlüssel einmalig erzeugen und in /data speichern
const keyFile = path.join(cfg.DATA_DIR, 'vapid.json');
let keys;
try { keys = JSON.parse(fs.readFileSync(keyFile, 'utf8')); } catch (e) {
  keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
  console.log('[Push] Neue VAPID-Schlüssel erzeugt');
}
webpush.setVapidDetails(cfg.VAPID_SUBJECT, keys.publicKey, keys.privateKey);

const publicKey = () => keys.publicKey;

function subscribe(player, sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
    const e = new Error('Ungültiges Push-Abo.'); e.status = 400; throw e;
  }
  const data = JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  db.prepare('INSERT OR REPLACE INTO push_subs (endpoint, player_id, data) VALUES (?, ?, ?)').run(sub.endpoint, player.id, data);
}

function unsubscribe(player, endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND player_id = ?').run(String(endpoint || ''), player.id);
}

const countFor = (playerId) => db.prepare('SELECT COUNT(*) AS c FROM push_subs WHERE player_id = ?').get(playerId).c;

// payload: {title, body, url, tag}
async function sendTo(playerIds, payload) {
  const ids = [...new Set(playerIds)].filter(Boolean);
  if (!ids.length) return 0;
  const subs = db.prepare(`SELECT endpoint, data FROM push_subs WHERE player_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(JSON.parse(s.data), JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint);
      else console.error('[Push] Fehler', e.statusCode || '', e.body || e.message);
    }
  }));
  return sent;
}

// Nur einmal senden (z. B. Morgen-Push pro Spiel und Tag). true = noch nicht gesendet
const once = (gameId, key) => db.prepare('INSERT OR IGNORE INTO notify_log (game_id, key) VALUES (?, ?)').run(gameId, key).changes > 0;

// Fire-and-forget: Fehler dürfen das Spiel nie stören
const send = (ids, payload) => { sendTo(ids, payload).catch((e) => console.error('[Push]', e.message)); };

module.exports = { publicKey, subscribe, unsubscribe, countFor, sendTo, send, once };
