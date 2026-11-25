/* Abendkasse – Admin-Bereich (/admin) */
(() => {
  const $app = document.getElementById('app');
  const $who = document.getElementById('who');
  const $toast = document.getElementById('toast');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LEVEL = { 1: 'leicht', 2: 'mittel', 3: 'schwer' };
  const levelBadge = (l) => `<span class="lvl l${l}" title="${LEVEL[l]}">${'●'.repeat(l)}${'○'.repeat(3 - l)}</span>`;
  const DIFF = { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Schwer', gemischt: 'Gemischt' };
  const dt = (x) => (x ? new Date(String(x).replace(' ', 'T') + (/[zZ+]/.test(x) || /T.*-/.test(x) ? '' : 'Z')).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
  const d = (x) => (x ? new Date(x).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const shortSha = (s) => (s && s !== 'dev' ? s.slice(0, 7) : 'lokal');
  const HUES = [210, 330, 30, 150, 270, 0, 190, 90];
  function avatar(p, size = 30) {
    const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`;
    if (p.avatar) return `<img class="av" style="${st}" src="/avatars/${encodeURIComponent(p.avatar)}" alt="">`;
    const name = p.name || '?';
    const hue = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
    return `<span class="av ini" style="${st};background:hsl(${hue} 55% 45%)">${esc(name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span>`;
  }
  function toast(msg, err = false) {
    $toast.textContent = msg; $toast.className = 'toast' + (err ? ' err' : ''); $toast.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => ($toast.hidden = true), 3200);
  }
  async function api(path, opts = {}) {
    const res = await fetch('/api/a' + path, {
      method: opts.method || 'GET', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.method && opts.method !== 'GET' ? '{}' : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !opts.anon) { user = null; start(); throw new Error(data.error || 'Bitte anmelden.'); }
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    return data;
  }

  let user = null, tab = 'start', ov = null;

  // ---------- Anmeldung / Einrichtung ----------
  async function start() {
    const s = await api('/state', { anon: true });
    user = s.user;
    $who.innerHTML = user ? `<span class="small muted">${esc(user)}</span> <button class="btn ghost small" id="lo">Abmelden</button>` : '';
    if (user) { document.getElementById('lo').onclick = async () => { await api('/logout', { method: 'POST', anon: true }); start(); }; return render(); }
    if (s.setup) return viewSetup();
    viewLogin();
  }

  function viewLogin() {
    $app.innerHTML = `<div class="card login"><h1 style="margin-top:0">🛡️ Admin-Anmeldung</h1>
      <form id="lf"><label class="lbl">Benutzername</label><input type="text" name="user" autocomplete="username" required autofocus>
      <label class="lbl">Passwort</label><input type="password" name="password" autocomplete="current-password" required>
      <button class="btn block" style="margin-top:16px">Anmelden</button></form>
      <p class="small muted" style="margin-bottom:0">Passwort vergessen? Auf dem Server:<br><code>docker exec -it -u node abendkasse node src/cli.js passwort &lt;Benutzer&gt;</code></p></div>`;
    document.getElementById('lf').onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('/login', { method: 'POST', anon: true, body: { user: ev.target.user.value, password: ev.target.password.value } }); start(); }
      catch (e) { toast(e.message, true); }
    };
  }

  function viewSetup() {
    $app.innerHTML = `<div class="card login"><h1 style="margin-top:0">🛡️ Admin einrichten</h1>
      <p class="small muted">Es gibt noch kein Admin-Konto. Den Einrichtungscode findest du im Log des Containers:<br><code>docker logs abendkasse | grep Einrichtungscode</code></p>
      <form id="sf"><label class="lbl">Einrichtungscode</label><input type="text" name="code" autocomplete="off" placeholder="XXXXX-XXXXX" required>
      <label class="lbl">Benutzername</label><input type="text" name="user" autocomplete="username" value="admin" required>
      <label class="lbl">Passwort (mind. 8 Zeichen)</label><input type="password" name="password" autocomplete="new-password" minlength="8" required>
      <label class="lbl">Passwort wiederholen</label><input type="password" name="password2" autocomplete="new-password" minlength="8" required>
      <button class="btn block" style="margin-top:16px">Konto anlegen</button></form></div>`;
    document.getElementById('sf').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      if (f.password.value !== f.password2.value) return toast('Die Passwörter stimmen nicht überein.', true);
      try { await api('/setup', { method: 'POST', anon: true, body: { code: f.code.value, user: f.user.value, password: f.password.value } }); toast('Admin-Konto angelegt'); start(); }
      catch (e) { toast(e.message, true); }
    };
  }

  // ---------- Hauptansicht ----------
  async function render() {
    try { ov = await api('/overview'); } catch (e) { $app.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const tabs = [['start', 'Übersicht' + (ov.version.available ? ' <span class="pill">Update</span>' : '')], ['reports', `Meldungen${ov.openReports ? ` <span class="pill">${ov.openReports}</span>` : ''}`],
      ['players', 'Spieler'], ['games', 'Spiele'], ['account', 'Konto']];
    $app.innerHTML = `<div class="tabs">${tabs.map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${v}</button>`).join('')}</div><div id="tab"></div>`;
    $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
    const $t = document.getElementById('tab');
    ({ start: tabStart, reports: tabReports, players: tabPlayers, games: tabGames, account: tabAccount })[tab]($t);
  }

  function tabStart($t) {
    const u = ov.version, b = ov.backup, c = ov.counts;
    $t.innerHTML = `
      <div class="card"><div class="kpis">
        <div class="kpi"><b>${c.players}</b><span class="small muted">Spieler</span></div>
        <div class="kpi"><b>${c.games}</b><span class="small muted">Spiele</span></div>
        <div class="kpi"><b>${c.rounds}</b><span class="small muted">ausgezahlte Runden</span></div>
        <div class="kpi"><b>${c.answers}</b><span class="small muted">Antworten</span></div>
        <div class="kpi"><b>${c.devices}</b><span class="small muted">Push-Geräte</span></div>
      </div></div>
      <div class="card"><h2 style="margin-top:0">⬆️ Version & Updates</h2>
        <div class="srow" style="grid-template-columns:1fr 2fr"><span class="slabel">Installiert</span><span><code>${shortSha(u.current.sha)}</code> ${d(u.current.date)}</span></div>
        <div class="srow" style="grid-template-columns:1fr 2fr"><span class="slabel">Neueste</span><span>${u.latest ? `<code>${shortSha(u.latest.sha)}</code> ${d(u.latest.date)}` : '<span class="muted">noch nicht geprüft</span>'}</span></div>
        ${u.error ? `<p class="small" style="color:var(--bad)">Prüfung fehlgeschlagen: ${esc(u.error)}</p>` : ''}
        ${u.current.sha === 'dev' ? '<p class="small">Diese Version wurde lokal gebaut – ein Vergleich ist nicht möglich.</p>' : ''}
        ${u.available ? `<p style="margin:12px 0 6px"><b>Was ist neu:</b></p><ul class="changes">${(u.latest.changes.length ? u.latest.changes : [u.latest.message]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
          : u.latest && u.current.sha !== 'dev' ? '<p style="color:var(--ok);margin:12px 0">✅ Neueste Version installiert.</p>' : ''}
        ${!u.configured ? '<p class="small">Der Updater ist noch nicht eingerichtet: einmalig <code>./update.sh</code> auf dem Server ausführen.</p>' : ''}
        <div class="row" style="margin-top:10px">
          ${u.available ? `<button class="btn small" id="apply" ${u.configured ? '' : 'disabled'}>Jetzt einspielen</button>` : ''}
          <button class="btn ghost small" id="check">Nach Updates suchen</button>
        </div></div>
      <div class="card"><h2 style="margin-top:0">💾 Sicherung</h2>
        <p class="small muted" style="margin-top:0">Täglich um ${ov.backupHour}:00 Uhr nach <code>${esc(ov.backupTarget)}</code>, die letzten ${ov.backupKeep} bleiben erhalten.</p>
        ${b ? `<div class="small">${b.error ? `<span style="color:var(--bad)">Letzte Sicherung fehlgeschlagen: ${esc(b.error)}</span>` : `Letzte Sicherung: <b>${d(b.at)}</b>${b.dir ? ` – <code>${esc(b.dir)}</code>` : ''}`}</div>` : '<div class="small muted">Seit dem Start noch keine Sicherung.</div>'}
        <div class="row" style="margin-top:10px"><button class="btn ghost small" id="bk">Jetzt sichern</button></div></div>`;
    document.getElementById('check').onclick = async (ev) => {
      ev.target.disabled = true;
      try { const r = await api('/update/check', { method: 'POST' }); toast(r.available ? 'Update verfügbar!' : 'Keine neue Version.'); render(); }
      catch (e) { toast(e.message, true); ev.target.disabled = false; }
    };
    const ap = document.getElementById('apply');
    if (ap) ap.onclick = applyUpdate;
    document.getElementById('bk').onclick = async (ev) => {
      ev.target.disabled = true;
      try { await api('/backup', { method: 'POST' }); toast('Sicherung erstellt'); render(); }
      catch (e) { toast(e.message, true); ev.target.disabled = false; }
    };
  }

  async function applyUpdate() {
    if (!confirm('Update jetzt einspielen?\n\nVorher wird automatisch eine Sicherung erstellt. Die App ist etwa eine Minute nicht erreichbar.')) return;
    const from = ov.version.current.sha;
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="sheet center"><div class="big">⬆️</div><h2>Update wird eingespielt …</h2><p class="muted" id="updmsg">Sicherung wird erstellt …</p><div class="spinner"></div></div>';
    document.body.appendChild(m);
    const msg = (t) => { const el = document.getElementById('updmsg'); if (el) el.textContent = t; };
    try { const r = await api('/update/apply', { method: 'POST' }); msg(r.finished ? 'Updater fertig – prüfe die Version …' : 'Neue Version wird geladen und gestartet …'); }
    catch (e) {
      if (!/Failed to fetch|NetworkError|Load failed|Fehler 50[234]/.test(e.message)) { m.remove(); toast(e.message, true); return; }
      msg('App startet neu …');
    }
    const t0 = Date.now();
    const poll = async () => {
      try {
        const v = await fetch('/api/version', { cache: 'no-store' }).then((r) => r.json());
        if (v.sha && v.sha !== from) { msg('Fertig! Lade neu …'); setTimeout(() => location.reload(), 800); return; }
      } catch (e) { msg('App startet neu …'); }
      if (Date.now() - t0 > 180_000) { m.remove(); toast('Keine neue Version erkannt. Läuft der Updater? (docker logs abendkasse-updater)', true); render(); return; }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 4000);
  }

  async function tabReports($t, status = 'open') {
    const r = await api(`/reports?status=${status}`);
    $t.innerHTML = `
      <div class="seg" style="margin-bottom:16px;max-width:320px"><button data-s="open" class="${status === 'open' ? 'on' : ''}">Offen</button><button data-s="done" class="${status === 'done' ? 'on' : ''}">Erledigt</button></div>
      ${r.items.length ? '' : `<p class="muted">${status === 'open' ? 'Keine offenen Meldungen. 🎉' : 'Noch nichts erledigt.'}</p>`}
      ${r.items.map((it, n) => {
        const q = it.question;
        const answer = q.type === 'estimate' ? `${q.answer} ${q.unit || ''}` : q.type === 'order' ? (q.answer || []).map((k) => q.items[k]).join(' → ') : (q.options || [])[q.answer];
        return `<div class="card">
          <div class="qhead"><span>${esc(q.genre || '')} ${q.type === 'estimate' ? '<span class="pill">Duell-Schätzfrage</span>' : levelBadge(it.level)} ${it.disabled ? '<span class="pill">deaktiviert</span>' : ''}</span><span class="small muted">${esc(it.qid)}</span></div>
          <div class="qtext">${esc(q.q)}</div>
          <div class="small">Richtige Antwort laut Katalog: <b>${esc(answer)}</b></div>
          <div class="small muted" style="margin-top:4px">Bisher ${it.stats.correct}/${it.stats.answered} richtig${it.stats.answered ? ` (${Math.round((it.stats.correct / it.stats.answered) * 100)} %)` : ''}</div>
          <div style="margin:10px 0">${it.reports.map((x) => `<div class="small">• <b>${esc(x.reasonText)}</b> – ${esc(x.by || '?')}${x.comment ? `: „${esc(x.comment)}“` : ''}</div>`).join('')}</div>
          ${status === 'open' ? `<div class="row">
            ${it.inCatalog && q.type !== 'estimate' ? `<span class="small muted">Stufe:</span>${[1, 2, 3].map((l) => `<button class="btn ghost small ${it.level === l ? 'onlv' : ''}" data-n="${n}" data-lv="${l}">${levelBadge(l)}</button>`).join('')}` : ''}
            ${it.inCatalog ? `<button class="btn ghost small" data-n="${n}" data-dis="1">Aussortieren</button>` : ''}
            <button class="btn small" data-n="${n}" data-ok="1">Erledigt</button></div>` : ''}
        </div>`;
      }).join('')}
      <p class="small muted">Falsche Antworten korrigierst du dauerhaft in der JSON-Datei unter <code>questions/</code> bzw. <code>data/questions/</code>. „Aussortieren“ nimmt die Frage sofort aus dem Spiel.</p>`;
    $t.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => tabReports($t, b.dataset.s)));
    $t.querySelectorAll('[data-n]').forEach((b) => (b.onclick = async () => {
      const it = r.items[+b.dataset.n];
      const body = b.dataset.lv ? { level: +b.dataset.lv } : b.dataset.dis ? { disabled: true } : { dismiss: true };
      try { await api(`/reports/${encodeURIComponent(it.qid)}`, { method: 'POST', body }); toast(b.dataset.lv ? 'Stufe geändert' : b.dataset.dis ? 'Frage aussortiert' : 'Erledigt'); render(); }
      catch (e) { toast(e.message, true); }
    }));
  }

  function tabPlayers($t) {
    const names = {};
    ov.players.forEach((p) => { const k = p.name.toLowerCase(); names[k] = (names[k] || 0) + 1; });
    $t.innerHTML = `<div class="card">
      <p class="small muted" style="margin-top:0">🔔 = bekommt Admin-Hinweise per Push (z. B. „Update verfügbar“) – nur wenn der Spieler Benachrichtigungen erlaubt hat. Gleichnamige Konten sind markiert; meist ist eins davon ein altes Gerät.</p>
      <div class="tbl"><table><thead><tr><th></th><th>Name</th><th>Spiele</th><th>Zuletzt aktiv</th><th>Geräte</th><th>🔔</th><th></th></tr></thead><tbody>
      ${ov.players.map((p) => `<tr>
        <td>${avatar(p)}</td>
        <td><b>${esc(p.name)}</b> <span class="small muted">#${p.id}</span>${names[p.name.toLowerCase()] > 1 ? '<div class="dup">⚠ doppelter Name</div>' : ''}<div class="small muted">seit ${dt(p.created_at)}</div></td>
        <td class="small" data-l="Spiele">${p.games.length ? p.games.map((g) => `${esc(g.name)} <code>${esc(g.code)}</code>`).join('<br>') : '<span class="muted">keins</span>'}</td>
        <td class="small" data-l="Aktiv">${dt(p.last_active)}</td>
        <td class="small" data-l="Geräte">${p.devices}</td>
        <td><label class="switch"><input type="checkbox" data-notify="${p.id}" ${p.notify ? 'checked' : ''}><span></span></label></td>
        <td><button class="btn danger small" data-del="${p.id}">Löschen</button></td></tr>`).join('')}
      </tbody></table></div>
      ${ov.players.length ? '' : '<p class="muted">Noch keine Spieler.</p>'}
      <div class="row" style="margin-top:12px"><button class="btn ghost small" id="pt">Test-Push an 🔔-Spieler</button></div></div>`;
    $t.querySelectorAll('[data-notify]').forEach((c) => (c.onchange = async () => {
      try { await api(`/players/${c.dataset.notify}/notify`, { method: 'POST', body: { notify: c.checked } }); toast(c.checked ? 'Bekommt Admin-Hinweise' : 'Keine Admin-Hinweise mehr'); }
      catch (e) { toast(e.message, true); c.checked = !c.checked; }
    }));
    $t.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      const p = ov.players.find((x) => x.id === +b.dataset.del);
      if (!confirm(`Spieler „${p.name}“ (#${p.id}) wirklich löschen?\n\nAlle Antworten, Punkte und Profildaten dieses Kontos werden entfernt. Das lässt sich nicht rückgängig machen (außer über eine Sicherung).`)) return;
      try { await api(`/players/${p.id}/delete`, { method: 'POST' }); toast('Spieler gelöscht'); render(); } catch (e) { toast(e.message, true); }
    }));
    document.getElementById('pt').onclick = async () => {
      try { const r = await api('/push-test', { method: 'POST' }); toast(r.sent ? `An ${r.sent} Gerät(e) gesendet` : 'Kein Gerät erreichbar – 🔔 setzen und Push in der App erlauben.', !r.sent); }
      catch (e) { toast(e.message, true); }
    };
  }

  function tabGames($t) {
    $t.innerHTML = `<div class="card"><div class="tbl"><table><thead><tr><th>Spiel</th><th>Spieler</th><th>Woche</th><th>Runden</th><th>Letzte Runde</th><th></th></tr></thead><tbody>
      ${ov.games.map((g) => `<tr>
        <td><b>${esc(g.name)}</b> <code>${esc(g.code)}</code><div class="small muted">${DIFF[g.difficulty] || ''}${g.theme_mode ? ' · Themenwoche' : ''} · seit ${dt(g.created_at)}</div></td>
        <td class="small" data-l="Spieler">${esc(g.players || '–')}</td><td class="small" data-l="Woche">${g.week_no}</td><td class="small" data-l="Runden">${g.rounds}</td><td class="small" data-l="Zuletzt">${esc(g.last_round || '–')}</td>
        <td><button class="btn danger small" data-del="${g.id}">Löschen</button></td></tr>`).join('')}
      </tbody></table></div>${ov.games.length ? '' : '<p class="muted">Noch keine Spiele.</p>'}</div>`;
    $t.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      const g = ov.games.find((x) => x.id === +b.dataset.del);
      if (!confirm(`Spiel „${g.name}“ (${g.code}) mit allen Runden, Punkten und Statistiken löschen?\n\nDie Spieler-Konten bleiben erhalten.`)) return;
      try { await api(`/games/${g.id}/delete`, { method: 'POST' }); toast('Spiel gelöscht'); render(); } catch (e) { toast(e.message, true); }
    }));
  }

  function tabAccount($t) {
    $t.innerHTML = `<div class="card" style="max-width:420px"><h2 style="margin-top:0">🔑 Passwort ändern</h2>
      <form id="pf"><label class="lbl">Aktuelles Passwort</label><input type="password" name="old" autocomplete="current-password" required>
      <label class="lbl">Neues Passwort (mind. 8 Zeichen)</label><input type="password" name="pw" autocomplete="new-password" minlength="8" required>
      <label class="lbl">Wiederholen</label><input type="password" name="pw2" autocomplete="new-password" minlength="8" required>
      <button class="btn" style="margin-top:14px">Speichern</button></form>
      <p class="small muted">Andere angemeldete Geräte werden dabei abgemeldet.</p></div>`;
    document.getElementById('pf').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      if (f.pw.value !== f.pw2.value) return toast('Die Passwörter stimmen nicht überein.', true);
      try { await api('/password', { method: 'POST', body: { old: f.old.value, password: f.pw.value } }); toast('Passwort geändert'); f.reset(); }
      catch (e) { toast(e.message, true); }
    };
  }

  start().catch((e) => { $app.innerHTML = `<p class="muted">${esc(e.message)}</p>`; });
})();
