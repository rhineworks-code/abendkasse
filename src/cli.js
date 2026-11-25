// Kommandozeile für den Notfall, z. B.:
//   docker exec -u node abendkasse node src/cli.js admins            Spieler und Admins anzeigen
//   docker exec -u node abendkasse node src/cli.js admin "Alex"      Alex zum Admin machen
//   docker exec -u node abendkasse node src/cli.js kein-admin "Sarah"
process.env.NODE_NO_WARNINGS = '1';
const { db } = require('./db');
const [cmd, ...rest] = process.argv.slice(2);
const name = rest.join(' ').trim();

const list = () => db.prepare('SELECT id, name, is_admin FROM players ORDER BY id').all()
  .forEach((p) => console.log(`${String(p.id).padStart(3)}  ${p.is_admin ? '🛡️  Admin ' : '         '}  ${p.name}`));

function find() {
  const all = db.prepare('SELECT id, name, is_admin FROM players WHERE name = ? COLLATE NOCASE').all(name);
  if (!all.length) { console.error(`Kein Spieler „${name}“ gefunden.`); list(); process.exit(1); }
  if (all.length > 1) { console.error(`Mehrere Spieler heißen „${name}“ – bitte die ID angeben:`); list(); process.exit(1); }
  return all[0];
}

if (cmd === 'admins' || !cmd) list();
else if (cmd === 'admin') {
  const p = /^\d+$/.test(name) ? db.prepare('SELECT * FROM players WHERE id = ?').get(+name) : find();
  if (!p) { console.error('Spieler nicht gefunden.'); process.exit(1); }
  db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(p.id); console.log(`${p.name} ist jetzt Admin.`);
} else if (cmd === 'kein-admin') {
  const p = /^\d+$/.test(name) ? db.prepare('SELECT * FROM players WHERE id = ?').get(+name) : find();
  if (!p) { console.error('Spieler nicht gefunden.'); process.exit(1); }
  if (db.prepare('SELECT COUNT(*) AS c FROM players WHERE is_admin = 1').get().c <= 1 && p.is_admin) { console.error('Es muss mindestens einen Admin geben.'); process.exit(1); }
  db.prepare('UPDATE players SET is_admin = 0 WHERE id = ?').run(p.id); console.log(`${p.name} ist kein Admin mehr.`);
} else { console.log('Befehle: admins | admin <Name oder ID> | kein-admin <Name oder ID>'); }
