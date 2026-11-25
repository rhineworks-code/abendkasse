// Kommandozeile für den Notfall:
//   docker exec -it -u node abendkasse node src/cli.js passwort <Benutzer>   Admin-Konto anlegen / Passwort neu setzen
//   docker exec -u node abendkasse node src/cli.js admin-konten              Admin-Konten anzeigen
//   docker exec -u node abendkasse node src/cli.js spieler                   Spieler anzeigen
process.removeAllListeners('warning'); // „SQLite is an experimental feature“ ausblenden
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w.message); });
const { db } = require('./db');
const A = require('./admin');
const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.join(' ').trim();

function ask(q, hidden) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.startsWith(q)) rl.output.write(q); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  if (cmd === 'passwort') {
    if (!arg) { console.error('Bitte Benutzernamen angeben: node src/cli.js passwort <Benutzer>'); process.exit(1); }
    let pw = process.env.ADMIN_PASSWORD;
    if (!pw) {
      if (!process.stdin.isTTY) { console.error('Interaktiv starten (docker exec -it …) oder ADMIN_PASSWORD setzen.'); process.exit(1); }
      pw = await ask('Neues Passwort: ', true);
      if (pw !== await ask('Wiederholen:    ', true)) { console.error('Passwörter stimmen nicht überein.'); process.exit(1); }
    }
    try { A.setPassword(arg, pw); } catch (e) { console.error(e.message); process.exit(1); }
    console.log(`Admin-Konto „${arg}“ gespeichert. Anmelden unter /admin`);
  } else if (cmd === 'admin-konten') {
    const rows = db.prepare('SELECT id, username, created_at FROM admin_users ORDER BY id').all();
    if (!rows.length) console.log('Noch kein Admin-Konto. Einrichten unter /admin (Code im Log) oder mit: passwort <Benutzer>');
    rows.forEach((u) => console.log(`${String(u.id).padStart(3)}  ${u.username}  (seit ${u.created_at})`));
  } else if (cmd === 'admin-loeschen') {
    const r = db.prepare('DELETE FROM admin_users WHERE username = ?').run(arg);
    console.log(r.changes ? `Admin-Konto „${arg}“ gelöscht.` : 'Nicht gefunden.');
  } else if (cmd === 'spieler') {
    db.prepare('SELECT id, name, is_admin FROM players ORDER BY id').all()
      .forEach((p) => console.log(`${String(p.id).padStart(3)}  ${p.is_admin ? '🔔' : '  '}  ${p.name}`));
  } else {
    console.log('Befehle: passwort <Benutzer> | admin-konten | admin-loeschen <Benutzer> | spieler');
  }
})();
