/* Abendkasse – Frontend (Vanilla JS, keine Abhängigkeiten) */
(() => {
  const $app = document.getElementById('app');
  const $who = document.getElementById('who');
  const $toast = document.getElementById('toast');
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

  let token = localStorage.getItem('ak_token') || '';
  let me = null;
  let refreshTimer = null;

  // ---------- Darstellung (Hell/Dunkel, Schriftgröße) ----------
  function applyLook() {
    const t = localStorage.getItem('ak_theme') || 'auto';
    const dark = t === 'dark' || (t === 'auto' && !window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.font = localStorage.getItem('ak_font') || 'normal';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#14122b' : '#f6f4fb');
  }
  applyLook();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyLook);

  // ---------- Helfer ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => { const t = new Date(d + 'T12:00:00Z'); return `${WD[t.getUTCDay()]}, ${t.getUTCDate()}.${t.getUTCMonth() + 1}.`; };
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
  const DIFF = {
    leicht: { label: 'Leicht', hint: 'Nur leichte Fragen – entspannt für jeden Tag.' },
    mittel: { label: 'Mittel', hint: 'Leichte und mittlere Fragen, keine richtig schweren.' },
    schwer: { label: 'Schwer', hint: 'Vor allem schwere Fragen, dazu mittlere.' },
    gemischt: { label: 'Gemischt', hint: 'Alle Stufen – jeder Tag geht von leicht nach schwer.' },
  };
  const LEVEL = { 1: 'leicht', 2: 'mittel', 3: 'schwer' };
  const levelBadge = (l) => `<span class="lvl l${l}" title="${LEVEL[l]}">${'●'.repeat(l)}${'○'.repeat(3 - l)}</span>`;
  function diffSeg(id, current) {
    return `<div class="seg" id="${id}">${Object.entries(DIFF).map(([k, v]) =>
      `<button type="button" data-d="${k}" class="${k === current ? 'on' : ''}">${v.label}</button>`).join('')}</div>
      <p class="small muted" id="${id}-hint" style="margin:6px 0 0">${DIFF[current].hint}</p>`;
  }
  function bindDiffSeg(id, onPick) {
    document.querySelectorAll(`#${id} button`).forEach((b) => (b.onclick = () => {
      document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      document.getElementById(`${id}-hint`).textContent = DIFF[b.dataset.d].hint;
      onPick(b.dataset.d);
    }));
  }
  const HUES = [210, 330, 30, 150, 270, 0, 190, 90];
  function avatar(p, size = 36) {
    const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`;
    if (p && p.avatar) return `<img class="av" style="${st}" src="/avatars/${encodeURIComponent(p.avatar)}" alt="">`;
    const name = (p && p.name) || '?';
    const hue = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
    const ini = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return `<span class="av ini" style="${st};background:hsl(${hue} 55% 45%)">${esc(ini)}</span>`;
  }
  function setWho() { $who.innerHTML = me ? `<a href="#/profil" class="whoa">${avatar(me, 30)}<span>${esc(me.name)}</span></a>` : ''; }

  function toast(msg, err = false) {
    $toast.textContent = msg;
    $toast.className = 'toast' + (err ? ' err' : '');
    $toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => ($toast.hidden = true), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) { logout(false); throw new Error('Bitte neu anmelden.'); }
    if (!res.ok) throw new Error(data.error || 'Fehler ' + res.status);
    return data;
  }

  function logout(go = true) {
    token = ''; me = null;
    localStorage.removeItem('ak_token');
    $who.textContent = '';
    if (go) location.hash = '#/';
  }

  // Countdown-Elemente: <span data-until="timestamp">
  setInterval(() => {
    document.querySelectorAll('[data-until]').forEach((el) => {
      const ms = +el.dataset.until - Date.now();
      if (ms <= 0) {
        el.textContent = '00:00:00';
        if (!el.dataset.fired) { el.dataset.fired = 1; setTimeout(route, 4000); }
        return;
      }
      const s = Math.floor(ms / 1000);
      el.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':');
    });
  }, 1000);

  // ---------- Push ----------
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
  async function currentSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function enablePush() {
    if (!pushSupported()) throw new Error(isIOS && !standalone ? 'Auf dem iPhone zuerst „Zum Home-Bildschirm“ hinzufügen und von dort öffnen.' : 'Dieser Browser unterstützt hier keine Push-Nachrichten (HTTPS nötig).');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt – das lässt sich in den Browser-Einstellungen ändern.');
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { key } = await api('/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  }
  async function disablePush() {
    const sub = await currentSub();
    if (sub) { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
  }
  // Bestehendes Abo dieses Geräts dem angemeldeten Spieler zuordnen (z. B. nach Neuanmeldung)
  let pushSynced = false;
  async function syncPush() {
    if (pushSynced || !token) return; pushSynced = true;
    try { const sub = await currentSub(); if (sub && Notification.permission === 'granted') await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } }); } catch (e) { /* egal */ }
  }

  // Stoppuhr für aufgedeckte Fragen: <span class="timer" data-start="ms" data-tempo="5">
  setInterval(() => {
    document.querySelectorAll('.timer[data-start]').forEach((el) => {
      const s = (Date.now() - +el.dataset.start) / 1000;
      const fast = s <= +el.dataset.tempo;
      el.textContent = `${fast ? '⚡ ' : '⏱ '}${s.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
      el.classList.toggle('fast', fast);
    });
  }, 100);

  // ---------- App installieren (PWA) ----------
  let deferredInstall = null;
  const isSafariLike = isIOS; // auf iOS nutzen alle Browser WebKit und „Zum Home-Bildschirm“
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (token) setTimeout(maybeInstallPopup, 800);
    const pb = document.getElementById('installbox'); if (pb) renderInstallBox();
  });
  window.addEventListener('appinstalled', () => {
    localStorage.setItem('ak_installed', '1');
    deferredInstall = null;
    document.querySelector('.modal.install')?.remove();
    toast('Abendkasse ist jetzt als App installiert 🎉');
  });
  const canInstall = () => !standalone && (!!deferredInstall || isSafariLike);
  function installSnoozed() {
    const v = localStorage.getItem('ak_install_later');
    return v === 'never' || (v && Date.now() - +v < 7 * 864e5);
  }
  function maybeInstallPopup() {
    if (!token || standalone || localStorage.getItem('ak_installed') || installSnoozed()) return;
    if (document.querySelector('.modal')) return; // nicht über andere Dialoge legen
    if (deferredInstall || isSafariLike) openInstall();
  }
  const iosSteps = `
    <ol class="steps">
      <li>Unten (iPad: oben rechts) auf <b>Teilen</b> tippen <span class="shareico">⬆︎</span></li>
      <li>Nach unten scrollen und <b>„Zum Home-Bildschirm“</b> wählen</li>
      <li>Oben rechts auf <b>„Hinzufügen“</b> tippen</li>
      <li>Abendkasse ab jetzt <b>über das Symbol auf dem Home-Bildschirm</b> öffnen</li>
    </ol>`;
  async function doInstall() {
    if (!deferredInstall) return false;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferredInstall = null;
    if (outcome !== 'accepted') localStorage.setItem('ak_install_later', String(Date.now()));
    return outcome === 'accepted';
  }
  function openInstall() {
    const native = !!deferredInstall;
    const wrap = document.createElement('div');
    wrap.className = 'modal install';
    wrap.innerHTML = `
      <div class="sheet" role="dialog" aria-label="App installieren">
        <div class="spread"><h2 style="margin:0">📲 Als App installieren</h2><button class="x" aria-label="Schließen">✕</button></div>
        <div class="row" style="margin:14px 0 6px; gap:14px; flex-wrap:nowrap">
          <img src="/icon-192.png" alt="" width="56" height="56" style="border-radius:14px; flex:none">
          <p class="small" style="margin:0">Abendkasse startet dann wie eine richtige App vom Home-Bildschirm bzw. Startmenü – ohne Browserleiste und mit Push-Nachrichten${isIOS ? ' (die gibt es auf dem iPhone nur so)' : ''}.</p>
        </div>
        ${native ? '' : iosSteps}
        <div class="row" style="margin-top:14px">
          ${native ? '<button class="btn" id="instyes">Installieren</button>' : '<button class="btn" id="instok">Verstanden</button>'}
          <button class="btn ghost" id="instlater">Später</button>
        </div>
        <p class="small" style="margin:12px 0 0"><a href="#" id="instnever" class="muted">Nicht mehr fragen</a></p>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    const later = () => { localStorage.setItem('ak_install_later', String(Date.now())); close(); };
    wrap.onclick = (ev) => { if (ev.target === wrap) later(); };
    wrap.querySelector('.x').onclick = later;
    wrap.querySelector('#instlater').onclick = later;
    wrap.querySelector('#instnever').onclick = (ev) => { ev.preventDefault(); localStorage.setItem('ak_install_later', 'never'); close(); toast('Okay – findest du jederzeit unter Profil.'); };
    const ok = wrap.querySelector('#instok'); if (ok) ok.onclick = later;
    const yes = wrap.querySelector('#instyes'); if (yes) yes.onclick = async () => { close(); await doInstall(); };
  }
  // Bereich im Profil
  function renderInstallBox() {
    const box = document.getElementById('installbox');
    if (!box) return;
    if (standalone || localStorage.getItem('ak_installed')) { box.innerHTML = '<p style="margin:0">✅ Abendkasse läuft als App auf diesem Gerät.</p>'; return; }
    if (deferredInstall) {
      box.innerHTML = '<p class="small muted" style="margin:0 0 10px">Installiere Abendkasse auf diesem Gerät – startet wie eine App, ohne Browserleiste.</p><button class="btn small" id="instnow">App installieren</button>';
      document.getElementById('instnow').onclick = doInstall;
    } else if (isSafariLike) {
      box.innerHTML = `<p class="small muted" style="margin:0">So geht's auf dem iPhone/iPad:</p>${iosSteps}`;
    } else {
      box.innerHTML = '<p class="small muted" style="margin:0">Im Browsermenü (⋮) gibt es „App installieren“ bzw. „Zum Startbildschirm hinzufügen“. Falls nicht: Die Installation braucht HTTPS und Chrome, Edge oder Samsung Internet.</p>';
    }
  }

  // ---------- Update aus der App ----------
  let upd = null, updAt = 0;
  async function loadUpdate(force = false) {
    if (!me || !me.canManage) return null;
    if (!force && upd && Date.now() - updAt < 5 * 60_000) return upd;
    try { upd = await api('/update'); updAt = Date.now(); } catch (e) { upd = null; }
    return upd;
  }
  const shortSha = (s) => (s && s !== 'dev' ? s.slice(0, 7) : 'lokal');
  function updateBanner() {
    if (!upd || !upd.available) return '';
    return `<div class="notice upd"><div>⬆️ <b>Update verfügbar</b>
      <div class="small muted">${esc(upd.latest.message || 'Neue Version')}${upd.latest.behind > 1 ? ` (+${upd.latest.behind - 1} weitere Änderungen)` : ''}</div></div>
      <div class="row"><button class="btn small" data-upd-apply>Jetzt einspielen</button><a class="btn ghost small" href="#/profil">Details</a></div></div>`;
  }
  function bindUpdate() {
    document.querySelectorAll('[data-upd-apply]').forEach((b) => (b.onclick = applyUpdate));
  }
  async function applyUpdate() {
    if (!upd || !upd.configured) { toast('Der Updater ist noch nicht eingerichtet – einmalig ./update.sh auf dem Server ausführen.', true); return; }
    if (!confirm('Update jetzt einspielen?\n\nVorher wird automatisch eine Sicherung erstellt. Die App ist etwa eine Minute nicht erreichbar und lädt danach neu.')) return;
    const from = upd.current.sha;
    const ov = document.createElement('div');
    ov.className = 'modal';
    ov.innerHTML = `<div class="sheet center"><div class="big">⬆️</div><h2>Update wird eingespielt …</h2>
      <p class="muted" id="updmsg">Sicherung wird erstellt …</p><div class="spinner"></div></div>`;
    document.body.appendChild(ov);
    const msg = (t) => { const el = document.getElementById('updmsg'); if (el) el.textContent = t; };
    try {
      const r = await api('/update/apply', { method: 'POST' });
      msg(r.finished ? 'Updater fertig – prüfe die Version …' : 'Neue Version wird geladen und gestartet …');
    } catch (e) {
      // Verbindung bricht ab, wenn die App schon neu startet – das ist normal
      if (!/Failed to fetch|NetworkError|Load failed|Fehler 50[234]/.test(e.message)) { ov.remove(); toast(e.message, true); return; }
      msg('App startet neu …');
    }
    const t0 = Date.now();
    const poll = async () => {
      try {
        const v = await fetch('/api/version', { cache: 'no-store' }).then((r) => r.json());
        if (v.sha && v.sha !== from) { msg('Fertig! Lade neu …'); setTimeout(() => location.reload(), 800); return; }
      } catch (e) { msg('App startet neu …'); }
      if (Date.now() - t0 > 180_000) {
        ov.remove();
        toast('Keine neue Version erkannt. Läuft der Updater-Container? (docker logs abendkasse-updater)', true);
        upd = null; route();
        return;
      }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 4000);
  }

  // ---------- Router ----------
  window.addEventListener('hashchange', route);

  async function route() {
    clearInterval(refreshTimer);
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
      if (parts[0] === 'restore') return viewRestore();
      if (!token) return viewWelcome(parts[0] === 'join' ? parts[1] : null);
      if (!me) { me = await api('/me'); setWho(); syncPush(); setTimeout(maybeInstallPopup, 1500); }
      await loadUpdate();
      if (parts[0] === 'join' && parts[1]) {
        const r = await api('/games/join', { method: 'POST', body: { code: parts[1] } });
        me = null;
        location.hash = `#/g/${r.code}`;
        return;
      }
      if (parts[0] === 'g' && parts[1]) return viewGame(parts[1].toUpperCase(), parts[2] || 'heute', parts[3]);
      if (parts[0] === 'profil') return viewProfile();
      if (parts[0] === 'meldungen') return viewReports();
      return viewLobby();
    } catch (e) {
      $app.innerHTML = `<div class="card"><b>Hoppla.</b><p class="muted">${esc(e.message)}</p><a class="btn ghost" href="#/">Zur Übersicht</a></div>`;
    }
  }

  // ---------- Willkommen ----------
  function viewWelcome(joinCode) {
    $app.innerHTML = `
      <div class="card hero">
        <h1>Das Wochen-Quiz für euch zwei</h1>
        <p class="sub">Jeden Tag neue Fragen. Um 20:00 Uhr wird ausgezahlt: Jede richtige Antwort landet als Punkte auf deinem Konto. Nach 7 Tagen gibt's den Wochensieger.</p>
        ${joinCode ? `<p>Du wurdest zum Spiel <b class="pill">${esc(joinCode)}</b> eingeladen.</p>` : ''}
        <label class="lbl">Wie heißt du?</label>
        <form id="f" class="row">
          <input class="grow" type="text" name="name" maxlength="24" placeholder="Dein Name" autocomplete="nickname" required>
          <button class="btn">Los geht's</button>
        </form>
        <p class="small muted" style="margin-top:16px">Schon ein Konto auf einem anderen Gerät? <a href="#/restore">Mit Wiederherstellungs-Code anmelden</a></p>
      </div>`;
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        const p = await api('/players', { method: 'POST', body: { name: ev.target.name.value } });
        token = p.token; localStorage.setItem('ak_token', token);
        me = null;
        route(); // Hash bleibt gleich (#/join/CODE) -> Router direkt aufrufen
      } catch (e) { toast(e.message, true); }
    };
  }

  function viewRestore() {
    $app.innerHTML = `
      <div class="card">
        <h1>Konto wiederherstellen</h1>
        <p class="sub">Den Code findest du auf deinem anderen Gerät unter „Profil“.</p>
        <form id="f" class="row">
          <input class="grow" type="text" name="t" placeholder="Wiederherstellungs-Code" required>
          <button class="btn">Anmelden</button>
        </form>
      </div>`;
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault();
      token = ev.target.t.value.trim(); me = null;
      try { me = await api('/me'); localStorage.setItem('ak_token', token); location.hash = '#/'; }
      catch (e) { token = ''; toast('Code ungültig.', true); }
    };
  }

  async function viewProfile() {
    me = await api('/me'); setWho();
    $app.innerHTML = `
      <div class="card">
        <h1>Profil</h1>
        <div class="row" style="gap:18px; margin:14px 0">
          <div id="avbig">${avatar(me, 96)}</div>
          <div class="grow">
            <div class="row"><label class="btn ghost">Bild hochladen<input type="file" id="file" accept="image/*" hidden></label>
            ${me.avatar ? '<button class="btn ghost" id="rm">Entfernen</button>' : ''}</div>
            <p class="small muted" style="margin:8px 0 0">Das Bild wird quadratisch zugeschnitten und verkleinert.</p>
          </div>
        </div>
        <label class="lbl">Name</label>
        <form id="nf" class="row">
          <input class="grow" type="text" name="name" maxlength="24" value="${esc(me.name)}" required>
          <button class="btn">Speichern</button>
        </form>
      </div>
      <div class="card">
        <h2 style="margin-top:0">📲 App</h2>
        <div id="installbox"></div>
      </div>
      <div class="card">
        <h2 style="margin-top:0">🎨 Darstellung</h2>
        <label class="lbl" style="margin-top:0">Design</label>
        <div class="seg" id="thseg">${[['auto', 'Automatisch'], ['dark', 'Dunkel'], ['light', 'Hell']].map(([k, v]) => `<button type="button" data-t="${k}" class="${(localStorage.getItem('ak_theme') || 'auto') === k ? 'on' : ''}">${v}</button>`).join('')}</div>
        <label class="lbl">Schriftgröße</label>
        <div class="seg" id="ftseg">${[['normal', 'Normal'], ['large', 'Groß'], ['xlarge', 'Sehr groß']].map(([k, v]) => `<button type="button" data-f="${k}" class="${(localStorage.getItem('ak_font') || 'normal') === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      </div>
      ${me.isAdmin || me.adminClaimable ? `<div class="card"><h2 style="margin-top:0">🛡️ Admin${me.isAdmin ? '' : '-Zugang'}</h2><div id="adminbox"></div></div>` : ''}
      ${me.canManage ? '<div class="card" id="updcard"><h2 style="margin-top:0">⬆️ Version & Updates</h2><div id="updbox" class="small muted">Prüfe …</div></div>' : ''}
      <div class="card" id="pushcard">
        <h2 style="margin-top:0">🔔 Benachrichtigungen</h2>
        <div id="pushbox" class="muted small">Prüfe …</div>
      </div>
      <div class="card">
        <label class="lbl" style="margin-top:0">Wiederherstellungs-Code (geheim halten!)</label>
        <div class="row"><input class="grow" type="text" readonly value="${esc(token)}"><button class="btn ghost" id="cp">Kopieren</button></div>
        <p class="small muted">Mit diesem Code meldest du dich auf einem anderen Gerät an.</p>
        <div class="row" style="margin-top:14px"><a class="btn ghost" href="#/">Zurück</a><button class="btn ghost" id="lo">Abmelden</button></div>
      </div>`;
    renderPushBox();
    renderUpdateBox();
    renderInstallBox();
    renderAdminBox();
    document.querySelectorAll('#thseg button').forEach((b) => (b.onclick = () => { localStorage.setItem('ak_theme', b.dataset.t); applyLook(); viewProfile(); }));
    document.querySelectorAll('#ftseg button').forEach((b) => (b.onclick = () => { localStorage.setItem('ak_font', b.dataset.f); applyLook(); viewProfile(); }));
    document.getElementById('cp').onclick = () => { navigator.clipboard?.writeText(token); toast('Kopiert'); };
    document.getElementById('lo').onclick = () => { if (confirm('Wirklich abmelden? Ohne Code kommst du nicht mehr an dein Konto.')) logout(); };
    document.getElementById('nf').onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('/me', { method: 'PUT', body: { name: ev.target.name.value } }); toast('Name gespeichert'); viewProfile(); }
      catch (e) { toast(e.message, true); }
    };
    const rm = document.getElementById('rm');
    if (rm) rm.onclick = async () => { await api('/me/avatar', { method: 'DELETE' }); toast('Bild entfernt'); viewProfile(); };
    document.getElementById('file').onchange = async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      try {
        const image = await squareImage(f, 256);
        await api('/me/avatar', { method: 'POST', body: { image } });
        toast('Profilbild gespeichert'); viewProfile();
      } catch (e) { toast(e.message || 'Bild konnte nicht gelesen werden.', true); }
    };
  }

  async function renderAdminBox() {
    const box = document.getElementById('adminbox');
    if (!box) return;
    if (!me.isAdmin) {
      box.innerHTML = `<p class="small muted" style="margin:0 0 10px">Admins sehen Updates und verwalten gemeldete Fragen. Mit dem <code>ADMIN_TOKEN</code> aus der <code>.env</code> kannst du dich selbst freischalten.</p>
        <form id="claimf" class="row"><input class="grow" type="password" name="t" placeholder="ADMIN_TOKEN" autocomplete="off" required><button class="btn ghost small">Freischalten</button></form>`;
      document.getElementById('claimf').onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api('/admin-claim', { method: 'POST', body: { token: ev.target.t.value } }); toast('Du bist jetzt Admin 🛡️'); me = null; upd = null; route(); }
        catch (e) { toast(e.message, true); }
      };
      return;
    }
    const list = await api('/admins');
    box.innerHTML = `<p class="small muted" style="margin:0 0 10px">Admins sehen Update-Hinweise, können Updates einspielen und gemeldete Fragen bearbeiten.</p>
      ${list.map((p) => `<div class="prog" style="padding:6px 0">${avatar(p, 26)}<span class="grow">${esc(p.name)}${p.id === me.id ? ' <span class="small muted">(du)</span>' : ''}</span>
        <label class="switch"><input type="checkbox" data-adm="${p.id}" ${p.admin ? 'checked' : ''}><span></span></label></div>`).join('')}`;
    box.querySelectorAll('[data-adm]').forEach((c) => (c.onchange = async () => {
      const id = +c.dataset.adm;
      if (!c.checked && id === me.id && !confirm('Dir selbst die Admin-Rechte entziehen?')) { c.checked = true; return; }
      try {
        await api(`/admins/${id}`, { method: 'POST', body: { admin: c.checked } });
        toast(c.checked ? 'Admin hinzugefügt' : 'Admin entfernt');
        if (id === me.id) { me = null; upd = null; route(); }
      } catch (e) { toast(e.message, true); c.checked = !c.checked; }
    }));
  }

  async function renderUpdateBox(force = false) {
    const box = document.getElementById('updbox');
    if (!box) return;
    const u = await loadUpdate(force);
    if (!u) { box.textContent = 'Update-Status nicht verfügbar.'; return; }
    const d = (x) => (x ? new Date(x).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '');
    box.innerHTML = `
      <div class="srow" style="grid-template-columns:1fr 2fr"><span class="slabel">Installiert</span><span><code>${shortSha(u.current.sha)}</code> ${d(u.current.date)}</span></div>
      <div class="srow" style="grid-template-columns:1fr 2fr"><span class="slabel">Neueste</span><span>${u.latest ? `<code>${shortSha(u.latest.sha)}</code> ${d(u.latest.date)}` : '<span class="muted">noch nicht geprüft</span>'}</span></div>
      ${u.error ? `<p class="small" style="color:var(--bad)">Prüfung fehlgeschlagen: ${esc(u.error)}</p>` : ''}
      ${u.current.sha === 'dev' ? '<p class="small">Diese Version wurde lokal gebaut – ein Vergleich ist nicht möglich.</p>' : ''}
      ${u.available ? `<p style="color:var(--text);margin:12px 0 6px"><b>Was ist neu:</b></p><ul class="changes">${(u.latest.changes.length ? u.latest.changes : [u.latest.message]).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
        : u.latest && u.current.sha !== 'dev' ? '<p style="color:var(--ok);margin:12px 0">✅ Du hast die neueste Version.</p>' : ''}
      ${!u.configured ? '<p class="small">Der Updater ist noch nicht eingerichtet: einmalig <code>./update.sh</code> auf dem Server ausführen (legt das Token an und startet den Updater-Container).</p>' : ''}
      <div class="row" style="margin-top:10px">
        ${u.available ? `<button class="btn small" data-upd-apply ${u.configured ? '' : 'disabled'}>Jetzt einspielen</button>` : ''}
        <button class="btn ghost small" id="updcheck">Nach Updates suchen</button>
      </div>`;
    bindUpdate();
    document.getElementById('updcheck').onclick = async () => {
      try { upd = await api('/update/check', { method: 'POST' }); updAt = Date.now(); toast(upd.available ? 'Update verfügbar!' : 'Keine neue Version.'); renderUpdateBox(); }
      catch (e) { toast(e.message, true); }
    };
  }

  async function renderPushBox() {
    const box = document.getElementById('pushbox');
    if (!box) return;
    const what = '<p class="small muted" style="margin:0 0 12px">Du bekommst eine Nachricht, wenn dein Partner gespielt hat, morgens gegen 6 Uhr bei einer neuen Tagesrunde, bei der Auszahlung um 20 Uhr und wenn eine Extrarunde ansteht.</p>';
    if (!window.isSecureContext) { box.innerHTML = what + 'Push-Nachrichten funktionieren nur über <b>HTTPS</b> – also über deine externe Adresse (Reverse Proxy), nicht über http://…:8020.'; return; }
    if (isIOS && !standalone) { box.innerHTML = what + 'Auf dem iPhone/iPad: in Safari auf <b>Teilen → Zum Home-Bildschirm</b> tippen und Abendkasse dann <b>vom Home-Bildschirm</b> öffnen. Danach kannst du hier Push aktivieren (ab iOS 16.4).'; return; }
    if (!pushSupported()) { box.innerHTML = what + 'Dieser Browser unterstützt keine Push-Nachrichten.'; return; }
    const sub = await currentSub();
    const on = !!sub && Notification.permission === 'granted';
    box.innerHTML = what + (on
      ? '<p style="margin:0 0 12px">✅ Auf diesem Gerät aktiv.</p><div class="row"><button class="btn small" id="ptest">Test senden</button><button class="btn ghost small" id="poff">Deaktivieren</button></div>'
      : `${Notification.permission === 'denied' ? '<p style="margin:0 0 12px">Benachrichtigungen sind im Browser blockiert. Erlaube sie in den Website-Einstellungen und versuch es dann erneut.</p>' : ''}<button class="btn" id="pon">Auf diesem Gerät aktivieren</button>`);
    const on_ = document.getElementById('pon'), off = document.getElementById('poff'), test = document.getElementById('ptest');
    if (on_) on_.onclick = async () => { try { await enablePush(); toast('Benachrichtigungen aktiviert 🔔'); renderPushBox(); } catch (e) { toast(e.message, true); } };
    if (off) off.onclick = async () => { await disablePush(); toast('Deaktiviert'); renderPushBox(); };
    if (test) test.onclick = async () => { try { const r = await api('/push/test', { method: 'POST' }); toast(r.sent ? 'Test gesendet' : 'Kein aktives Gerät gefunden', !r.sent); } catch (e) { toast(e.message, true); } };
  }

  // Bild im Browser mittig quadratisch zuschneiden und als JPEG verkleinern
  function squareImage(file, size) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.width, img.height);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden.')); };
      img.src = url;
    });
  }

  // ---------- Lobby ----------
  async function viewLobby() {
    me = await api('/me');
    const genres = await api('/genres');
    const sel = new Set(genres.map((g) => g.name));
    let mode = 'mix';
    let difficulty = 'mittel';
    const lv = genres.reduce((a, g) => { [1, 2, 3].forEach((l) => (a[l] += g.levels?.[l] || 0)); return a; }, { 1: 0, 2: 0, 3: 0 });

    $app.innerHTML = `
      <div class="spread"><h1>Hallo ${esc(me.name)}!</h1><a href="#/profil" class="row small">${avatar(me, 28)} Profil</a></div>
      ${updateBanner()}
      ${me.canManage ? `<a class="notice muted-n" href="#/meldungen" style="color:var(--text)"><span>⚑ Gemeldete Fragen</span><span class="pill">${me.openReports} offen</span></a>` : ''}
      <h2>Deine Spiele</h2>
      <div class="gamelist">
        ${me.games.length ? me.games.map((g) => `
          <a class="card" href="#/g/${g.code}">
            <div class="spread"><b>${esc(g.name)}</b><span class="pts">${g.balance} P</span></div>
            <div class="row small muted" style="margin-top:6px"><span class="pill">${g.code}</span> <span class="pill">${DIFF[g.difficulty]?.label || 'Mittel'}</span> Woche ${g.week_no} · ${g.players} Spieler</div>
          </a>`).join('') : '<p class="muted">Noch keine Spiele – leg eins an oder tritt mit einem Code bei.</p>'}
      </div>

      <h2>Mit Code beitreten</h2>
      <form id="join" class="card row">
        <input class="grow code" type="text" name="code" maxlength="6" placeholder="CODE" required>
        <button class="btn">Beitreten</button>
      </form>

      <h2>Neues Spiel</h2>
      <form id="new" class="card">
        <label class="lbl">Name</label>
        <input type="text" name="name" maxlength="40" placeholder="z. B. Quiz-Duell mit Max">
        <label class="lbl">Genres</label>
        <div class="chips" id="genres">
          ${genres.map((g) => `<span class="chip on" data-g="${esc(g.name)}">${esc(g.name)} <span class="muted small">${g.count}</span></span>`).join('')}
        </div>
        <label class="lbl">Fragen-Mix</label>
        <div class="seg" id="mode">
          <button type="button" data-m="mix" class="on">Bunt gemischt</button>
          <button type="button" data-m="daily">Ein Genre pro Tag</button>
        </div>
        <label class="lbl">Schwierigkeit <span class="muted">(${lv[1]} leicht · ${lv[2]} mittel · ${lv[3]} schwer)</span></label>
        ${diffSeg('diff', difficulty)}
        <label class="lbl">Fragen pro Tag</label>
        <select name="perDay">${[5, 10, 15, 20].map((n) => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <button class="btn block" style="margin-top:16px">Spiel erstellen</button>
      </form>`;

    document.querySelectorAll('#genres .chip').forEach((c) => (c.onclick = () => {
      const g = c.dataset.g;
      if (sel.has(g)) { if (sel.size === 1) return toast('Mindestens ein Genre.'); sel.delete(g); } else sel.add(g);
      c.classList.toggle('on', sel.has(g));
    }));
    document.querySelectorAll('#mode button').forEach((b) => (b.onclick = () => {
      mode = b.dataset.m;
      document.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    bindDiffSeg('diff', (d) => (difficulty = d));
    bindUpdate();
    document.getElementById('join').onsubmit = async (ev) => {
      ev.preventDefault();
      try { const r = await api('/games/join', { method: 'POST', body: { code: ev.target.code.value } }); location.hash = `#/g/${r.code}`; }
      catch (e) { toast(e.message, true); }
    };
    document.getElementById('new').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        const r = await api('/games', { method: 'POST', body: { name: ev.target.name.value, genres: [...sel], mode, difficulty, perDay: +ev.target.perDay.value } });
        sessionStorage.setItem('ak_new', r.code);
        location.hash = `#/g/${r.code}`;
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---------- Spiel ----------
  async function viewGame(code, tab, arg) {
    const g = await api(`/games/${code}`);
    const until = Date.now() + g.msUntilPayout;
    const leader = Math.max(...g.players.map((p) => p.week));

    const bar = Array.from({ length: g.week.length }, (_, i) =>
      `<span class="${i + 1 < g.week.day ? 'done' : i + 1 === g.week.day ? 'now' : ''}"></span>`).join('');

    $app.innerHTML = `
      <div class="card gamehead">
        <div class="spread">
          <div>
            <h1>${esc(g.name)}</h1>
            <div class="muted small">Woche ${g.week.no} · ${g.week.day > 0 ? `Tag ${g.week.day}/${g.week.length}` : 'startet morgen'} · ${fmtDate(g.week.start)} – ${fmtDate(g.week.end)}</div>
          </div>
          <div class="center">
            <div class="small muted">Auszahlung in</div>
            <div class="countdown" data-until="${until}">--:--:--</div>
          </div>
        </div>
        <div class="weekbar">${bar}</div>
        <div class="row small" style="margin-top:14px">
          <span class="codebox" title="Spiel-Code">${g.code}</span>
          <button class="btn small" data-invite>📨 Einladung senden</button>
          <span class="muted">${g.players.length}/${g.maxPlayers} Spieler</span>
        </div>
      </div>

      <div class="board">
        ${g.players.map((p) => `
          <div class="player ${p.me ? 'me' : ''}">
            <div class="nm">${avatar(p, 28)} ${esc(p.name)} ${p.me ? '<span class="muted small">(du)</span>' : ''} ${p.week > 0 && p.week === leader ? '<span class="crown">♛</span>' : ''}</div>
            <div class="bal pts">${p.balance} P</div>
            <div class="small muted">diese Woche: ${p.week} P</div>
          </div>`).join('')}
        ${g.players.length < g.maxPlayers ? `<div class="player"><div class="nm muted">Wartet auf Mitspieler …</div><div class="small muted" style="margin:4px 0 8px">Code <b>${g.code}</b></div><button class="btn small" data-invite>Jetzt einladen</button></div>` : ''}
      </div>

      ${updateBanner()}
      ${notices(g)}

      <nav class="tabs">
        <a href="#/g/${code}" class="${tab === 'heute' || tab === 'extra' ? 'on' : ''}">Heute</a>
        <a href="#/g/${code}/woche" class="${tab === 'woche' || tab === 'tag' ? 'on' : ''}">Woche</a>
        <a href="#/g/${code}/statistik" class="${tab === 'statistik' ? 'on' : ''}">Statistik</a>
        <a href="#/g/${code}/konto" class="${tab === 'konto' ? 'on' : ''}">Konto</a>
      </nav>
      <section id="tab"><div class="loading">Lädt …</div></section>`;

    document.querySelectorAll('[data-invite]').forEach((b) => (b.onclick = () => openInvite(g)));
    bindNotices(g);
    bindUpdate();
    // Direkt nach dem Erstellen: Einladen anbieten
    if (sessionStorage.getItem('ak_new') === g.code) { sessionStorage.removeItem('ak_new'); openInvite(g); }

    const $tab = document.getElementById('tab');
    if (tab === 'woche') return tabWeek($tab, g);
    if (tab === 'konto') return tabLedger($tab, g);
    if (tab === 'tag' && arg) return tabDay($tab, g, arg);
    if (tab === 'extra' && arg) return tabExtra($tab, g, arg);
    if (tab === 'statistik') return tabStats($tab, g);
    return tabToday($tab, g);
  }

  // ----- Tag wiederholen / streichen -----
  const hhOf = (g) => String(g.rules.payoutHour).padStart(2, '0') + ':00';
  const dueText = (g, due) => `bis ${due === g.today ? 'heute' : fmtDate(due)} ${hhOf(g)} Uhr`;

  function notices(g) {
    const out = [];
    for (const r of g.requests) {
      const what = r.type === 'void' ? 'streichen' : 'wiederholen';
      if (r.needMe) {
        out.push(`<div class="notice">
          <div><b>${esc(r.byName)}</b> möchte den Tag <b>${fmtDate(r.date)}</b> ${what}.
          <div class="small muted">${r.type === 'void' ? 'Die Punkte des Tages werden für alle zurückgebucht, der Tag zählt nicht.' : `Die Punkte des Tages werden zurückgebucht und ihr spielt eine Nachholrunde mit neuen Fragen.`}</div></div>
          <div class="row"><button class="btn small" data-req="${r.date}" data-ok="1">Zustimmen</button><button class="btn ghost small" data-req="${r.date}" data-ok="0">Ablehnen</button></div>
        </div>`);
      } else {
        out.push(`<div class="notice muted-n">
          <div>Anfrage: Tag <b>${fmtDate(r.date)}</b> ${what}. <span class="small muted">Wartet auf ${r.waitingFor.map(esc).join(', ')}.</span></div>
          ${r.mine ? `<button class="btn ghost small" data-req="${r.date}" data-ok="0">Zurückziehen</button>` : ''}
        </div>`);
      }
    }
    if (g.theme && g.theme.mode && !g.theme.theme && g.theme.canChoose) {
      out.push(`<div class="notice extra"><div>🎯 <b>Themenwoche:</b> ${g.theme.chooser ? 'Du hast gewonnen – wähle' : 'Wählt'} das Thema dieser Woche.
        <div class="small muted">Ohne Wahl entscheidet bei der ersten Runde der Zufall.</div></div>
        <a class="btn small" href="#/g/${g.code}/woche">Thema wählen</a></div>`);
    }
    const x = g.extra;
    if (x) {
      const nq = g.rules.extraQuestions;
      if (x.status === 'offer' && !x.accepted) {
        out.push(`<div class="notice extra">
          <div>🎲 <b>Lust auf eine Extrarunde?</b>
          <div class="small muted">Ihr wart beide vor ${String(g.rules.extraBefore).padStart(2, '0')}:00 Uhr fertig. ${nq} Zusatzfragen bis ${hhOf(g)} Uhr – beide müssen zustimmen.</div></div>
          <div class="row"><button class="btn small" data-extra="1">Ja, los!</button><button class="btn ghost small" data-extra="0">Nein danke</button></div>
        </div>`);
      } else if (x.status === 'offer') {
        out.push(`<div class="notice muted-n"><div>🎲 Du bist bei der Extrarunde dabei. <span class="small muted">Wartet auf ${x.waitingFor.map(esc).join(', ')}.</span></div></div>`);
      } else if (x.status === 'open' && !x.finished) {
        out.push(`<div class="notice extra"><div>🎲 <b>Extrarunde läuft</b> <span class="small muted">– ${nq} Fragen bis ${hhOf(g)} Uhr</span></div>
          <a class="btn small" href="#/g/${g.code}/extra/${x.date}">Jetzt spielen</a></div>`);
      } else if (x.status === 'declined') {
        out.push(`<div class="notice muted-n"><div class="small">Keine Extrarunde heute – ${esc(x.declinedBy)} hat abgelehnt.</div></div>`);
      }
    }
    if (!g.push && pushSupported() && !localStorage.getItem('ak_push_later')) {
      out.push(`<div class="notice muted-n" id="pushask">
        <div>🔔 <b>Benachrichtigungen aktivieren?</b><div class="small muted">Dann weißt du sofort, wenn dein Partner gespielt hat oder eine Extrarunde ansteht.</div></div>
        <div class="row"><button class="btn small" id="pushyes">Aktivieren</button><button class="btn ghost small" id="pushno">Später</button></div>
      </div>`);
    }
    for (const d of g.days.filter((x) => x.replayOpen)) {
      out.push(`<div class="notice replay">
        <div>🔁 <b>Nachholrunde</b> für ${fmtDate(d.date)} ist offen <span class="small muted">– ${dueText(g, d.due)}</span></div>
        <a class="btn small" href="#/g/${g.code}/tag/${d.date}">Jetzt spielen</a>
      </div>`);
    }
    return out.join('');
  }

  function bindNotices(g) {
    document.querySelectorAll('[data-extra]').forEach((b) => (b.onclick = async () => {
      try {
        const r = await api(`/games/${g.code}/extra`, { method: 'POST', body: { accept: b.dataset.extra === '1' } });
        toast(r.status === 'started' ? 'Extrarunde startet! 🎲' : r.status === 'declined' ? 'Okay, keine Extrarunde' : 'Zugestimmt – wartet auf deinen Partner');
        if (r.status === 'started') location.hash = `#/g/${g.code}/extra/${g.today}`; else route();
      } catch (e) { toast(e.message, true); route(); }
    }));
    const py = document.getElementById('pushyes'), pn = document.getElementById('pushno');
    if (py) py.onclick = async () => { try { await enablePush(); toast('Benachrichtigungen aktiviert 🔔'); route(); } catch (e) { toast(e.message, true); } };
    if (pn) pn.onclick = () => { localStorage.setItem('ak_push_later', '1'); document.getElementById('pushask')?.remove(); };
    document.querySelectorAll('[data-req]').forEach((b) => (b.onclick = async () => {
      const accept = b.dataset.ok === '1';
      try {
        const r = await api(`/games/${g.code}/days/${b.dataset.req}/answer`, { method: 'POST', body: { accept } });
        toast(r.status === 'replay' ? 'Nachholrunde ist offen!' : r.status === 'voided' ? 'Tag gestrichen' : r.status === 'rejected' ? 'Anfrage abgelehnt' : 'Zugestimmt');
        route();
      } catch (e) { toast(e.message, true); }
    }));
  }

  function openDayAction(g, date, d) {
    const others = g.players.filter((p) => !p.me).map((p) => p.name);
    const dueNote = g.afterPayout ? 'bis morgen ' + hhOf(g) + ' Uhr' : 'bis heute ' + hhOf(g) + ' Uhr';
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Tag ändern">
        <div class="spread"><h2 style="margin:0">${fmtDate(date)}</h2><button class="x" aria-label="Schließen">✕</button></div>
        <p class="muted small">Zum Beispiel wenn der Server ausgefallen ist oder jemand nicht mitspielen konnte.
        ${others.length ? `${others.map(esc).join(', ')} muss zustimmen.` : ''}</p>
        <button class="choice" data-type="replay">
          <b>🔁 Tag wiederholen</b>
          <span>${d ? 'Die Punkte des Tages werden zurückgebucht. ' : ''}Ihr bekommt neue Fragen als Nachholrunde – spielbar ${dueNote}, zusätzlich zur normalen Tagesrunde.</span>
        </button>
        ${d && !d.voided ? `<button class="choice" data-type="void">
          <b>🚫 Tag streichen</b>
          <span>Die Punkte des Tages werden für alle zurückgebucht, der Tag zählt in dieser Woche nicht.</span>
        </button>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = (ev) => { if (ev.target === wrap) close(); };
    wrap.querySelector('.x').onclick = close;
    wrap.querySelectorAll('.choice').forEach((b) => (b.onclick = async () => {
      try {
        const r = await api(`/games/${g.code}/days/${date}/request`, { method: 'POST', body: { type: b.dataset.type } });
        close();
        toast(r.status === 'pending' ? `Anfrage gesendet – ${others.join(', ') || 'Mitspieler'} muss zustimmen` : r.status === 'replay' ? 'Nachholrunde ist offen!' : 'Tag gestrichen');
        route();
      } catch (e) { toast(e.message, true); }
    }));
  }

  // ----- Einladung teilen -----
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* ohne HTTPS nicht verfügbar */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* egal */ }
    ta.remove(); return ok;
  }

  function openInvite(g) {
    const url = `${(g.publicUrl || location.origin).replace(/\/$/, '')}/#/join/${g.code}`;
    const text = `Lust auf ein Quiz-Duell? 🧠 Jeden Tag ${g.perDay} Fragen, um ${g.rules.payoutHour} Uhr wird abgerechnet. Spiel mit mir „${g.name}“ – Code ${g.code}:`;
    const full = `${text} ${url}`;
    const e = encodeURIComponent;
    const canShare = !!navigator.share;

    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Einladung senden">
        <div class="spread"><h2 style="margin:0">Einladung senden</h2><button class="x" aria-label="Schließen">✕</button></div>
        <p class="muted small">Dein Partner öffnet den Link, gibt seinen Namen ein und ist sofort im Spiel.</p>
        ${canShare ? '<button class="btn block" id="native">📤 Teilen …</button>' : ''}
        <div class="share">
          <a class="sh wa" href="https://wa.me/?text=${e(full)}" target="_blank" rel="noopener"><b>WhatsApp</b></a>
          <a class="sh tg" href="https://t.me/share/url?url=${e(url)}&text=${e(text)}" target="_blank" rel="noopener"><b>Telegram</b></a>
          <a class="sh sms" href="sms:?&body=${e(full)}"><b>SMS</b></a>
          <a class="sh mail" href="mailto:?subject=${e('Einladung zum Wochen-Quiz')}&body=${e(text + '\n\n' + url)}"><b>E-Mail</b></a>
        </div>
        <label class="lbl">Link</label>
        <div class="row"><input class="grow" type="text" readonly value="${esc(url)}"><button class="btn ghost" id="cpy">Kopieren</button></div>
        <p class="small muted" style="margin-bottom:0">Oder einfach den Code <b class="pill">${g.code}</b> durchsagen – unter „Mit Code beitreten“ eingeben.</p>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = (ev) => { if (ev.target === wrap) close(); };
    wrap.querySelector('.x').onclick = close;
    wrap.querySelector('#cpy').onclick = async () => toast((await copyText(url)) ? 'Link kopiert' : 'Kopieren nicht möglich – bitte Link markieren', false);
    const nb = wrap.querySelector('#native');
    if (nb) nb.onclick = async () => {
      try { await navigator.share({ title: 'Abendkasse – Einladung', text, url }); close(); } catch (err) { /* abgebrochen */ }
    };
  }

  // ----- Tab: Heute -----
  async function tabToday($tab, g) {
    const d = await api(`/games/${g.code}/today`);
    const until = Date.now() + d.msUntilPayout;
    const hh = String(d.payoutHour).padStart(2, '0') + ':00';

    if (d.state === 'upcoming') {
      $tab.innerHTML = `<div class="card center hero"><div class="big">🌙</div><h2>Die Woche startet morgen</h2><p class="muted">Ab Mitternacht gibt's die ersten Fragen. Auszahlung jeden Abend um ${hh} Uhr.</p></div>`;
      return;
    }
    if (d.state === 'waiting') {
      $tab.innerHTML = `<div class="card center hero"><h2>Noch etwas Geduld</h2><p class="muted">Die heutigen Fragen sind noch nicht freigeschaltet.</p></div>`;
      return;
    }
    if (d.state === 'closed') {
      const last = g.days.find((x) => x.paid);
      $tab.innerHTML = `<div class="card center hero"><div class="big">🌙</div><h2>Für heute ist Kassenschluss</h2>
        <p class="muted">Heute wurde keine Runde gespielt. Morgen ab Mitternacht geht's weiter.</p>
        ${last ? `<a class="btn ghost" href="#/g/${g.code}/tag/${last.date}">Letzte Auflösung ansehen</a>` : ''}</div>`;
      return;
    }
    if (d.state === 'paid') return renderReveal($tab, g, d, true);
    return renderRound($tab, g, d, null);
  }

  // Offene Runde spielen. date = null für heute, sonst Datum der Nachholrunde/Extrarunde.
  const TYPE_LABEL = { mc: 'Multiple Choice', tf: 'Wahr oder falsch?', order: 'Reihenfolge', image: 'Bildfrage' };
  function renderRound($tab, g, d, date, kind = 'day') {
    const isExtra = kind === 'extra';
    const total = d.questions.length;
    const reload = () => (isExtra ? tabExtra($tab, g, date) : date ? tabDay($tab, g, date) : tabToday($tab, g));
    const until = Date.now() + d.msUntilPayout;
    const hh = String(d.payoutHour).padStart(2, '0') + ':00';
    const target = { date, kind };
    const head = isExtra
      ? `<div class="notice extra"><div>🎲 <b>Extrarunde</b> <span class="small muted">– ${total} Zusatzfragen, Auflösung um ${hh} Uhr</span></div><a class="btn ghost small" href="#/g/${g.code}">Zur Tagesrunde</a></div>`
      : date ? `<div class="notice replay"><div>🔁 <b>Nachholrunde für ${fmtDate(date)}</b> <span class="small muted">– ${dueText(g, d.due)}, danach Auflösung</span></div><a class="btn ghost small" href="#/g/${g.code}">Zur heutigen Runde</a></div>` : '';
    const next = d.questions.findIndex((q) => !q.answered);
    const dots = `<div class="dots">${d.questions.map((x, i) => `<i class="${x.answered ? 'a' : i === next ? 'c' : ''}"></i>`).join('')}${d.duel ? `<i class="duel-dot ${d.duel.mine !== null ? 'a' : next === -1 ? 'c' : ''}" title="Duell-Frage"></i>` : ''}</div>`;
    const progressHtml = `
      <div class="card"><h2 style="margin-top:0">Fortschritt ${isExtra ? 'Extrarunde' : date ? 'Nachholrunde' : 'heute'}</h2><div class="progress">
        ${d.progress.map((p) => `<div class="prog">${avatar(p, 26)}<span style="min-width:80px">${esc(p.name)}${p.me ? ' (du)' : ''}</span>
          <span class="bar"><b style="width:${(p.answered / p.total) * 100}%"></b></span><span class="small muted">${p.done ? '✅' : `${p.answered}/${p.total}`}</span></div>`).join('')}
      </div></div>`;

    // ---- 1) Nächste Frage: erst Einsatz wählen, dann aufdecken ----
    if (next !== -1) {
      const q = d.questions[next];
      const qhead = `<div class="qhead"><span>Frage ${next + 1} von ${total}</span><span>${esc(q.genre)} ${levelBadge(q.level)}</span></div>`;
      if (!q.opened) {
        const avail = d.stake.available;
        let stake = 0;
        $tab.innerHTML = `${head}
          <div class="card">
            ${dots}${qhead}
            <div class="typehint">${TYPE_LABEL[q.type] || 'Frage'}</div>
            <h2 style="margin:6px 0 4px">Dein Einsatz</h2>
            <p class="small muted" style="margin:0 0 12px">Richtig: Einsatz gewinnen · Falsch: Einsatz verlieren · Verfügbar: <b>${avail} P</b></p>
            <div class="stakes">${d.stake.steps.map((v) => `<button class="stk ${v === 0 ? 'on' : ''}" data-v="${v}" ${v > avail ? 'disabled' : ''}>${v === 0 ? 'Ohne' : v + ' P'}</button>`).join('')}</div>
            <button class="btn block" id="reveal" style="margin-top:14px">Frage aufdecken ⏱</button>
            <p class="small muted" style="margin:10px 0 0">Ab dem Aufdecken läuft die Zeit – richtig in unter ${d.tempo.seconds} Sekunden gibt +${d.tempo.bonus} P.</p>
          </div>
          ${progressHtml}`;
        $tab.querySelectorAll('.stk').forEach((b) => (b.onclick = () => {
          stake = +b.dataset.v;
          $tab.querySelectorAll('.stk').forEach((x) => x.classList.toggle('on', x === b));
        }));
        document.getElementById('reveal').onclick = async (ev) => {
          ev.target.disabled = true;
          try { await api(`/games/${g.code}/open`, { method: 'POST', body: { ...target, idx: next, stake } }); reload(); }
          catch (e) { toast(e.message, true); ev.target.disabled = false; }
        };
        return;
      }

      const start = Date.now() - (q.elapsed || 0);
      const stakePill = q.stake ? `<span class="pill stake">Einsatz ${q.stake} P</span>` : '';
      const canJoker = q.type !== 'order' && q.type !== 'tf' && q.options && q.options.length >= 4;
      const jokerHtml = !canJoker ? '' : q.removed.length ? '<span class="joker used">50:50 aktiv</span>'
        : d.jokers.left > 0 ? `<button class="joker" id="joker" title="Entfernt zwei falsche Antworten">50:50 <small>${d.jokers.left}×</small></button>`
        : '<span class="joker used">Joker verbraucht</span>';
      let answerHtml;
      if (q.type === 'order') {
        answerHtml = `<p class="small muted" style="margin:0 0 10px">Tippe die Einträge in der richtigen Reihenfolge an.</p>
          <div class="opts" id="orderopts">${q.items.map((it, i) => `<button class="opt ord" data-i="${i}"><span class="k">·</span><span>${esc(it)}</span></button>`).join('')}</div>
          <div class="row" style="margin-top:12px"><button class="btn ghost small" id="ordreset">Zurücksetzen</button><button class="btn small" id="ordsend" disabled>Antwort abgeben</button></div>`;
      } else {
        answerHtml = `<div class="opts ${q.type === 'tf' ? 'tf' : ''}">${q.options.map((o, i) => q.removed.includes(i)
          ? `<button class="opt gone" disabled><span class="k">${KEYS[i]}</span><span>${esc(o)}</span></button>`
          : `<button class="opt" data-i="${i}">${q.type === 'tf' ? '' : `<span class="k">${KEYS[i]}</span>`}<span>${esc(o)}</span></button>`).join('')}</div>`;
      }
      $tab.innerHTML = `${head}
        <div class="card">
          ${dots}${qhead}
          <div class="spread" style="margin-bottom:6px"><span class="timer" data-start="${start}" data-tempo="${d.tempo.seconds}">0,0 s</span>${stakePill}</div>
          ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="Bild zur Frage">` : ''}
          <div class="qtext">${esc(q.q)}</div>
          ${answerHtml}
          <div class="spread" style="margin-top:14px">
            <p class="small muted" style="margin:0">Jede Antwort ist endgültig. Aufgelöst wird um ${hh} Uhr.</p>
            ${jokerHtml}
          </div>
        </div>
        ${progressHtml}`;

      const send = async (body) => {
        try {
          const r = await api(`/games/${g.code}/answer`, { method: 'POST', body: { ...target, idx: next, ...body } });
          if (r.fast) toast(`⚡ Unter ${d.tempo.seconds} Sekunden!`);
          setTimeout(next === total - 1 && !d.duel ? route : reload, 350);
        } catch (e) { toast(e.message, true); setTimeout(route, 1200); }
      };
      const jb = document.getElementById('joker');
      if (jb) jb.onclick = async () => {
        if (!confirm('50:50-Joker für diese Frage einsetzen? Du hast nur einen pro Runde.')) return;
        try { await api(`/games/${g.code}/joker`, { method: 'POST', body: { ...target, idx: next } }); reload(); }
        catch (e) { toast(e.message, true); }
      };
      if (q.type === 'order') {
        let picked = [];
        const btns = [...$tab.querySelectorAll('.ord')];
        const paint = () => {
          btns.forEach((b) => { const pos = picked.indexOf(+b.dataset.i); b.classList.toggle('picked', pos >= 0); b.querySelector('.k').textContent = pos >= 0 ? pos + 1 : '·'; });
          document.getElementById('ordsend').disabled = picked.length !== btns.length;
        };
        btns.forEach((b) => (b.onclick = () => { const i = +b.dataset.i; if (!picked.includes(i)) picked.push(i); else picked = picked.filter((x) => x !== i); paint(); }));
        document.getElementById('ordreset').onclick = () => { picked = []; paint(); };
        document.getElementById('ordsend').onclick = (ev) => { ev.target.disabled = true; send({ order: picked }); };
      } else {
        $tab.querySelectorAll('.opt:not(.gone)').forEach((b) => (b.onclick = () => {
          $tab.querySelectorAll('.opt').forEach((x) => (x.disabled = true));
          b.classList.add('picked');
          send({ choice: +b.dataset.i });
        }));
      }
      return;
    }

    // ---- 2) Duell-Frage des Tages ----
    if (d.duel && d.duel.mine === null) {
      $tab.innerHTML = `${head}
        <div class="card duel">
          ${dots}
          <div class="qhead"><span>⚔️ Duell-Frage des Tages</span><span>+${d.duel.points} P für den Näheren</span></div>
          <div class="qtext">${esc(d.duel.q)}</div>
          <form id="duelf" class="row">
            <input class="grow" type="text" inputmode="decimal" name="v" placeholder="Deine Schätzung" autocomplete="off" required>
            ${d.duel.unit ? `<span class="unit">${esc(d.duel.unit)}</span>` : ''}
            <button class="btn">Schätzen</button>
          </form>
          <p class="small muted" style="margin:10px 0 0">Eine Schätzung, kein Zeitlimit. Wer näher an der richtigen Zahl liegt, gewinnt.</p>
        </div>
        ${progressHtml}`;
      document.getElementById('duelf').onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api(`/games/${g.code}/duel`, { method: 'POST', body: { value: ev.target.v.value, date } }); route(); }
        catch (e) { toast(e.message, true); }
      };
      return;
    }

    // ---- 3) Alles erledigt ----
    const tip = (q) => (q.type === 'order' ? (q.mine || []).map((i) => esc(q.items[i])).join(' → ') : esc(q.options[q.mine]));
    $tab.innerHTML = `${head}
      <div class="card center hero">
        <div class="big">🔒</div>
        <h2>Alle Antworten sind abgegeben</h2>
        <p class="muted">Die Kasse öffnet ${!isExtra && date && d.due !== g.today ? 'am ' + fmtDate(d.due) + ' ' : ''}um ${hh} Uhr – dann siehst du, wie viele richtig waren.</p>
        ${isExtra || !date || d.due === g.today ? `<div class="countdown" data-until="${until}">--:--:--</div>` : ''}
      </div>
      ${progressHtml}
      <div class="card"><h2 style="margin-top:0">Deine Tipps</h2>
        ${d.questions.map((q, i) => `<div class="tiprow"><div class="small muted">${i + 1}. ${esc(q.genre)} ${q.stake ? `<span class="pill stake">${q.stake} P</span>` : ''} ${q.fast ? '⚡' : ''}</div><div>${esc(q.q)}</div><div class="pts">→ ${tip(q)}</div></div>`).join('')}
        ${d.duel ? `<div class="tiprow"><div class="small muted">⚔️ Duell-Frage</div><div>${esc(d.duel.q)}</div><div class="pts">→ ${fmtNum(d.duel.mine)} ${esc(d.duel.unit || '')}</div></div>` : ''}
      </div>`;
    refreshTimer = setInterval(async () => {
      try { const x = await api(isExtra ? `/games/${g.code}/extra/${date}` : date ? `/games/${g.code}/days/${date}` : `/games/${g.code}/today`); if (x.state !== 'open' || JSON.stringify(x.progress) !== JSON.stringify(d.progress)) route(); } catch (e) { /* still */ }
    }, 30000);
  }

  // ----- Auflösung -----
  function renderReveal($tab, g, d, isToday) {
    if (d.voided) {
      $tab.innerHTML = `<div class="card center hero"><div class="big">🚫</div><h2>${fmtDate(d.date)} wurde gestrichen</h2>
        <p class="muted">Ihr habt euch geeinigt, diesen Tag nicht zu werten. Die Punkte wurden zurückgebucht.</p></div>`;
      return;
    }
    const others = d.results.filter((r) => !r.me);
    const mine = d.results.find((r) => r.me);
    const best = Math.max(...d.results.map((r) => r.points));
    const kind = d.kind === 'extra' ? 'extra' : 'day';
    const chips = (x) => !x ? '' : [
      x.base ? `<span class="chip-s">${x.correct}× richtig +${x.base}</span>` : '',
      x.perfect ? `<span class="chip-s">Perfekt +${x.perfect}</span>` : '',
      x.tempo ? `<span class="chip-s">⚡ ${x.tempoCount}× +${x.tempo}</span>` : '',
      x.stakeNet ? `<span class="chip-s ${x.stakeNet < 0 ? 'neg' : ''}">Einsätze ${sign(x.stakeNet)}</span>` : '',
      x.duel ? `<span class="chip-s">⚔️ +${x.duel}</span>` : '',
    ].join('');
    const marks = (i) => d.results.map((r) => [
      r.stakes[i] ? `<span class="mk ${r.me ? 'me' : 'fr'}">${r.me ? 'du' : esc(r.name)}: ${ansOk(d.questions[i], r.answers[i]) ? '+' : '−'}${r.stakes[i]} P</span>` : '',
      r.fast.includes(i) ? `<span class="mk ${r.me ? 'me' : 'fr'}">⚡ ${r.me ? 'du' : esc(r.name)}</span>` : '',
      r.jokers.includes(i) ? `<span class="mk ${r.me ? 'me' : 'fr'}">50:50 ${r.me ? 'du' : esc(r.name)}</span>` : '',
    ].join('')).join('');

    const duelHtml = !d.duel ? '' : `
      <div class="card duel">
        <div class="qhead"><span>⚔️ Duell-Frage des Tages</span><button class="rep" data-idx="duel">⚑ Melden</button></div>
        <div class="qtext">${esc(d.duel.q)}</div>
        <div class="duelans">Richtig: <b>${fmtNum(d.duel.answer)} ${esc(d.duel.unit || '')}</b></div>
        ${d.duel.guesses.map((x) => `<div class="prog">${avatar(x, 24)}<span style="min-width:80px">${esc(x.name)}${x.me ? ' (du)' : ''}</span>
          <span class="grow">${x.value === null ? '<span class="muted">nicht geschätzt</span>' : `${fmtNum(x.value)} <span class="small muted">(${devText(x.value, d.duel.answer)})</span>`}</span>
          ${x.won ? `<span class="pts">♛ +${Math.round(d.duel.guesses.filter((y) => y.won).length > 1 ? g.rules.duelPoints / d.duel.guesses.filter((y) => y.won).length : g.rules.duelPoints)}</span>` : ''}</div>`).join('')}
        ${d.duel.explain ? `<div class="explain">💡 ${esc(d.duel.explain)}</div>` : ''}
      </div>`;

    $tab.innerHTML = `
      <div class="card center hero">
        <div class="small muted">${d.kind === 'extra' ? '🎲 Extrarunde vom ' + fmtDate(d.date) : isToday ? 'Heutige Auszahlung' : (d.replay ? 'Nachholrunde für ' : 'Auszahlung vom ') + fmtDate(d.date)}</div>
        <div class="row" style="justify-content:center; gap:24px; margin-top:10px; align-items:flex-start">
          ${d.results.map((r) => `
            <div style="max-width:220px">
              <div>${avatar(r, 56)}</div>
              <div class="small" style="color:${r.me ? 'var(--me)' : 'var(--friend)'}">${esc(r.name)} ${r.points === best && best > 0 ? '♛' : ''}</div>
              <div class="big">${r.correct}/${r.total}</div>
              <div class="pts">${sign(r.points)} P</div>
              <div class="chips-s">${chips(r.detail)}</div>
            </div>`).join('')}
        </div>
        ${isToday && g.extra && g.extra.status === 'paid' ? `<a class="btn ghost small" style="margin-top:12px" href="#/g/${g.code}/extra/${d.date}">🎲 Extrarunde ansehen</a>` : ''}
        ${isToday ? '<p class="muted small" style="margin-top:12px">Morgen gibt es neue Fragen.</p>' : ''}
      </div>
      ${duelHtml}
      ${d.questions.map((q, i) => {
        const my = mine ? mine.answers[i] : undefined;
        let body;
        if (q.type === 'order') {
          const seq = (arr) => (arr || []).map((k) => esc(q.items[k])).join(' → ');
          body = `<div class="orderans"><div class="small muted">Richtig:</div><ol>${q.answer.map((k) => `<li>${esc(q.items[k])}</li>`).join('')}</ol></div>
            ${d.results.map((r) => `<div class="small" style="margin-top:6px"><b style="color:${r.me ? 'var(--me)' : 'var(--friend)'}">${r.me ? 'Du' : esc(r.name)}:</b> ${r.answers[i] ? `${seq(r.answers[i])} ${orderOk(q, r.answers[i]) ? '✅' : '❌'}` : '<span class="muted">nicht beantwortet</span>'}</div>`).join('')}`;
        } else {
          body = `<div class="opts ${q.type === 'tf' ? 'tf' : ''}">
            ${q.options.map((o, oi) => {
              const cls = oi === q.answer ? 'right' : oi === my ? 'wrong' : '';
              const mk = [my === oi ? '<span class="mk me">du</span>' : '', ...others.filter((r) => r.answers[i] === oi).map((r) => `<span class="mk fr">${esc(r.name)}</span>`)].join('');
              return `<button class="opt ${cls}" disabled>${q.type === 'tf' ? '' : `<span class="k">${KEYS[oi]}</span>`}<span>${esc(o)}</span><span class="marks">${mk}</span></button>`;
            }).join('')}
          </div>`;
        }
        return `
        <div class="card">
          <div class="qhead"><span>Frage ${i + 1} · ${esc(q.genre)} ${levelBadge(q.level)}</span><button class="rep" data-idx="${i}">⚑ Melden</button></div>
          <div class="marks-row">${marks(i)}</div>
          ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="">` : ''}
          <div class="qtext">${esc(q.q)}</div>
          ${body}
          ${my === undefined || my === null ? '<p class="small muted" style="margin:10px 0 0">Nicht beantwortet</p>' : ''}
          ${q.explain ? `<div class="explain">💡 ${esc(q.explain)}</div>` : ''}
        </div>`;
      }).join('')}`;
    $tab.querySelectorAll('.rep').forEach((b) => (b.onclick = () => openReport(g, d.date, kind, b.dataset.idx)));
  }

  const ansOk = (q, a) => (q.type === 'order' ? orderOk(q, a) : a !== undefined && a !== null && a === q.answer);
  const orderOk = (q, a) => Array.isArray(a) && Array.isArray(q.answer) && a.length === q.answer.length && a.every((v, i) => v === q.answer[i]);
  const fmtNum = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: 3 }));
  const devText = (v, a) => {
    const diff = v - a;
    if (diff === 0) return 'exakt!';
    const pct = a ? Math.abs(diff / a) * 100 : null;
    return `${diff > 0 ? '+' : '−'}${fmtNum(Math.abs(diff))}${pct !== null ? `, ${pct < 10 ? pct.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : Math.round(pct)} %` : ''}`;
  };

  // Frage melden
  const REPORT_REASONS = { wrong: 'Antwort ist falsch', hard: 'Zu schwer', easy: 'Zu leicht', unclear: 'Unklar formuliert', other: 'Sonstiges' };
  function openReport(g, date, kind, idx) {
    let reason = null;
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Frage melden">
        <div class="spread"><h2 style="margin:0">⚑ Frage melden</h2><button class="x" aria-label="Schließen">✕</button></div>
        <p class="muted small">Die Meldung landet in der Liste des Spielleiters. Er kann die Frage korrigieren, die Stufe ändern oder sie aussortieren.</p>
        <div class="chips">${Object.entries(REPORT_REASONS).map(([k, v]) => `<span class="chip" data-r="${k}">${v}</span>`).join('')}</div>
        <label class="lbl">Kommentar (optional)</label>
        <input type="text" id="rcomment" maxlength="300" placeholder="z. B. richtige Antwort wäre …">
        <button class="btn block" id="rsend" style="margin-top:14px" disabled>Meldung senden</button>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = (ev) => { if (ev.target === wrap) close(); };
    wrap.querySelector('.x').onclick = close;
    wrap.querySelectorAll('[data-r]').forEach((c) => (c.onclick = () => {
      reason = c.dataset.r;
      wrap.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === c));
      wrap.querySelector('#rsend').disabled = false;
    }));
    wrap.querySelector('#rsend').onclick = async () => {
      try {
        await api(`/games/${g.code}/report`, { method: 'POST', body: { date, kind, idx: idx === 'duel' ? 'duel' : +idx, reason, comment: wrap.querySelector('#rcomment').value } });
        close(); toast('Danke! Die Frage wurde gemeldet.');
      } catch (e) { toast(e.message, true); }
    };
  }

  async function tabExtra($tab, g, date) {
    try {
      const d = await api(`/games/${g.code}/extra/${date}`);
      if (d.state === 'open') return renderRound($tab, g, d, date, 'extra');
      renderReveal($tab, g, d, false);
    } catch (e) { $tab.innerHTML = `<div class="card muted">${esc(e.message)}</div>`; }
  }

  async function tabDay($tab, g, date) {
    try {
      const d = await api(`/games/${g.code}/days/${date}`);
      if (d.state === 'open') return renderRound($tab, g, d, date);
      renderReveal($tab, g, d, false);
    }
    catch (e) { $tab.innerHTML = `<div class="card muted">${esc(e.message)}</div>`; }
  }

  // ----- Tab: Woche -----
  function tabWeek($tab, g) {
    const byId = Object.fromEntries(g.players.map((p) => [p.id, p]));
    const days = [];
    for (let i = 0; i < g.week.length; i++) {
      const t = new Date(g.week.start + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + i);
      const date = t.toISOString().slice(0, 10);
      days.push({ date, n: i + 1, d: g.days.find((x) => x.date === date && x.kind !== 'extra'), x: g.days.find((x) => x.date === date && x.kind === 'extra') });
    }
    $tab.innerHTML = `
      <div class="card daylist">
        <h2 style="margin-top:0">Woche ${g.week.no}</h2>
        ${days.map(({ date, n, d, x }) => {
          const res = d && d.voided ? '<span class="muted small">gestrichen</span>' : d && d.paid ? d.results.map((r) => `<span class="small">${esc(byId[r.id]?.name || '?')} <b>${r.correct}/${r.total}</b></span>`).join(' · ') : '';
          const status = !d ? (n < g.week.day ? '<span class="muted small">nicht gespielt</span>' : n === g.week.day ? '<span class="pill">heute</span>' : '<span class="muted small">—</span>')
            : d.paid ? res : d.replayOpen ? '<span class="pill">🔁 Nachholrunde</span>' : '<span class="pill">läuft</span>';
          const tag = d && d.replay ? ' <span class="pill">nachgeholt</span>' : '';
          const inner = `<span>Tag ${n} · ${fmtDate(date)}${d && d.genre ? ` <span class="pill">${esc(d.genre)}</span>` : ''}${d && d.paid ? tag : ''}</span><span>${status}</span>`;
          const past = date < g.today || (date === g.today && d && d.paid);
          const pending = g.requests.some((r) => r.date === date);
          const canAct = past && (!d || d.paid) && !pending;
          const act = canAct ? `<button class="redo" data-act="${date}" title="Tag wiederholen oder streichen">↻</button>`
            : pending ? '<span class="pill">Anfrage offen</span>' : '';
          const link = d && (d.paid || d.replayOpen);
          const extraRow = x ? `<a class="drow extra-row" href="#/g/${g.code}/extra/${date}"><span class="d small"><span>🎲 Extrarunde</span><span>${x.paid
            ? x.results.map((r) => `${esc(byId[r.id]?.name || '?')} <b>${r.correct}/${r.total}</b>`).join(' · ') : '<span class="pill">läuft</span>'}</span></span></a>` : '';
          return `<div class="drow">${link ? `<a class="d" href="#/g/${g.code}/tag/${date}">${inner}</a>` : `<div class="d">${inner}</div>`}${act}</div>${extraRow}`;
        }).join('')}
      </div>

      <div class="card">
        <div class="spread"><h2 style="margin:0">🎯 Themenwoche</h2>
          <label class="switch"><input type="checkbox" id="thmode" ${g.theme.mode ? 'checked' : ''}><span></span></label></div>
        <p class="small muted" style="margin:6px 0 10px">Eine Woche lang nur ein Genre. Der Wochensieger wählt das Thema der nächsten Woche, sonst entscheidet der Zufall.</p>
        ${!g.theme.mode ? '' : g.theme.theme
          ? `<p style="margin:0">Thema dieser Woche: <b>${esc(g.theme.theme)}</b> ${g.theme.locked ? '<span class="small muted">(steht fest)</span>' : ''}</p>` : ''}
        ${g.theme.mode && g.theme.canChoose ? `<div class="chips" style="margin-top:10px">${g.genres.map((x) => `<span class="chip ${x === g.theme.theme ? 'on' : ''}" data-theme="${esc(x)}">${esc(x)}</span>`).join('')}</div>`
          : g.theme.mode && !g.theme.theme && g.theme.chooser ? `<p class="small muted" style="margin:0">${esc(g.theme.chooser)} wählt das Thema.</p>` : ''}
      </div>

      <div class="card">
        <h2 style="margin-top:0">Schwierigkeit</h2>
        ${diffSeg('gdiff', g.difficulty)}
        <p class="small muted" style="margin:8px 0 0">Gilt ab der nächsten neuen Runde – bereits gestellte Fragen bleiben.</p>
      </div>

      <div class="card small muted">
        <b style="color:var(--text)">Regeln:</b> ${g.rules.perCorrect} P pro richtige Antwort · +${g.rules.perfectBonus} P für einen perfekten Tag ·
        +${g.rules.weekBonus} P für den Wochensieg · ein 50:50-Joker pro Tag · Auszahlung täglich ${g.rules.payoutHour}:00 Uhr.
        Mit ↻ lässt sich ein vergangener Tag dieser Woche wiederholen oder streichen, wenn alle zustimmen.
        Seid ihr beide vor ${String(g.rules.extraBefore).padStart(2, '0')}:00 Uhr fertig, gibt es auf Wunsch eine Extrarunde mit ${g.rules.extraQuestions} Fragen.
        Vor jeder Frage kannst du bis zu ${g.rules.maxStake} P setzen · richtig in unter ${g.rules.tempoSeconds} s: +${g.rules.tempoBonus} P ·
        Duell-Frage: +${g.rules.duelPoints} P für die beste Schätzung · Erinnerung um ${g.rules.reminderHour} Uhr.
        Genres: ${g.genres.map(esc).join(', ')} (${g.mode === 'daily' ? 'ein Genre pro Tag' : 'gemischt'}, ${g.perDay} Fragen/Tag).
      </div>

      <h2>Vergangene Wochen</h2>
      ${g.weeks.length ? `<div class="card daylist">${g.weeks.map((w) => `
        <div class="d"><span>Woche ${w.week} <span class="muted small">${fmtDate(w.start)} – ${fmtDate(w.end)}</span></span>
        <span>${w.winners.length ? '♛ ' + w.winners.map((id) => esc(byId[id]?.name || '?')).join(' & ') : '<span class="muted">kein Sieger</span>'}
        <span class="muted small">(${Object.entries(w.scores).map(([id, s]) => `${esc(byId[id]?.name || '?')} ${s}`).join(' : ')})</span></span></div>`).join('')}</div>`
        : '<p class="muted">Noch keine abgeschlossene Woche.</p>'}`;

    const thm = document.getElementById('thmode');
    if (thm) thm.onchange = async () => {
      try { await api(`/games/${g.code}/settings`, { method: 'PUT', body: { themeMode: thm.checked } }); toast(thm.checked ? 'Themenwoche an' : 'Themenwoche aus'); route(); }
      catch (e) { toast(e.message, true); thm.checked = !thm.checked; }
    };
    $tab.querySelectorAll('[data-theme]').forEach((c) => (c.onclick = async () => {
      if (!confirm(`„${c.dataset.theme}“ als Thema dieser Woche festlegen?`)) return;
      try { await api(`/games/${g.code}/settings`, { method: 'PUT', body: { theme: c.dataset.theme } }); toast(`Thema: ${c.dataset.theme}`); route(); }
      catch (e) { toast(e.message, true); }
    }));
    bindDiffSeg('gdiff', async (d) => {
      try { await api(`/games/${g.code}/settings`, { method: 'PUT', body: { difficulty: d } }); g.difficulty = d; toast(`Schwierigkeit: ${DIFF[d].label} – ab der nächsten Runde`); }
      catch (e) { toast(e.message, true); }
    });
    $tab.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () =>
      openDayAction(g, b.dataset.act, g.days.find((x) => x.date === b.dataset.act && x.kind !== 'extra'))));
  }

  // ----- Tab: Statistik -----
  async function tabStats($tab, g) {
    const st = await api(`/games/${g.code}/stats`);
    const me_ = st.players.find((p) => p.me) || st.players[0];
    const others = st.players.filter((p) => p !== me_);
    const pct = (x) => (x && x.rate !== null && x.rate !== undefined ? `${x.rate} %` : '–');
    const bar = (x, cls) => `<span class="sbar ${cls}"><b style="width:${x && x.rate ? x.rate : 0}%"></b></span>`;
    const row = (label, get) => `<div class="srow"><span class="slabel">${label}</span>${st.players.map((p) => `<span class="sval ${p.me ? 'me' : 'fr'}">${get(p)}</span>`).join('')}</div>`;
    const LV = { 1: 'Leicht', 2: 'Mittel', 3: 'Schwer' };
    const TY = { mc: 'Multiple Choice', tf: 'Wahr/Falsch', order: 'Reihenfolge', image: 'Bildfragen' };

    // Wochenverlauf als kleine Balkengrafik
    const hist = st.history.slice(-10);
    const maxPts = Math.max(10, ...hist.flatMap((w) => st.players.map((p) => w.scores[p.id] || 0)));
    const chart = `<svg viewBox="0 0 ${hist.length * 46 + 10} 150" class="chart" role="img" aria-label="Punkte pro Woche">
      ${hist.map((w, wi) => st.players.map((p, pi) => {
        const v = Math.max(0, w.scores[p.id] || 0); const h = Math.round((v / maxPts) * 110);
        return `<rect x="${wi * 46 + 10 + pi * 16}" y="${120 - h}" width="14" height="${h}" rx="3" class="${p.me ? 'c-me' : 'c-fr'}" opacity="${w.done ? 1 : 0.55}"><title>${esc(p.name)}: ${w.scores[p.id] || 0} P</title></rect>`;
      }).join('') + `<text x="${wi * 46 + 10 + st.players.length * 8}" y="140" text-anchor="middle" class="c-lbl">W${w.week}</text>`).join('')}
    </svg>`;

    $tab.innerHTML = `
      ${st.insights.length ? `<div class="card"><h2 style="margin-top:0">Auf einen Blick</h2>${st.insights.map((i) => `<div class="insight ${i.good ? 'good' : ''}">${i.good ? '💪' : '📚'} ${esc(i.text)}</div>`).join('')}</div>` : ''}

      <div class="card">
        <div class="srow head"><span class="slabel"></span>${st.players.map((p) => `<span class="sval ${p.me ? 'me' : 'fr'}">${avatar(p, 28)}<br>${esc(p.name)}</span>`).join('')}</div>
        ${row('Trefferquote', (p) => `<b class="big2">${pct(p.total)}</b><div class="small muted">${p.total.c}/${p.total.n}</div>`)}
        ${row('Wochensiege', (p) => `<b>${p.weekWins}</b>`)}
        ${row('Tagessiege', (p) => `<b>${p.dayWins}</b>${p.draws ? ` <span class="small muted">(${p.draws} remis)</span>` : ''}`)}
        ${row('Serie aktuell / beste', (p) => `🔥 <b>${p.streak.current}</b> / ${p.streak.longest}`)}
        ${row('Gespielte Tage', (p) => `${p.daysPlayed}`)}
        ${row('Perfekte Runden', (p) => `${p.perfectDays}`)}
        ${row('Duelle gewonnen', (p) => `${p.duelsWon}/${p.duels}`)}
        ${row('Tempo-Boni', (p) => `⚡ ${p.tempo}`)}
        ${row('Einsätze', (p) => (p.stakeWon || p.stakeLost ? `<span class="pos">+${p.stakeWon}</span> / <span class="neg">−${p.stakeLost}</span>` : '–'))}
        ${row('Punkte gesamt', (p) => `<b class="pts">${p.points}</b>`)}
      </div>

      <div class="card"><h2 style="margin-top:0">Punkte pro Woche</h2>${chart}
        <div class="legend">${st.players.map((p) => `<span><i class="${p.me ? 'c-me' : 'c-fr'}"></i>${esc(p.name)}</span>`).join('')}</div></div>

      <div class="card"><h2 style="margin-top:0">Trefferquote nach Genre</h2>
        ${st.genres.map((gn) => `<div class="gstat"><div class="small">${esc(gn)}</div>${st.players.map((p) => `<div class="gline">${bar(p.genres[gn], p.me ? 'me' : 'fr')}<span class="small ${p.me ? '' : 'muted'}">${pct(p.genres[gn])}</span></div>`).join('')}</div>`).join('')}
      </div>

      <div class="card"><h2 style="margin-top:0">Nach Schwierigkeit & Fragetyp</h2>
        ${[1, 2, 3].map((l) => row(`${LV[l]} ${levelBadge(l)}`, (p) => pct(p.levels[l]))).join('')}
        ${Object.keys(TY).map((t) => row(TY[t], (p) => pct(p.types[t]))).join('')}
      </div>

      <div class="card"><h2 style="margin-top:0">Abzeichen</h2>
        <div class="badges">${me_.badges.map((b) => `<div class="badge ${b.earned ? 'on' : ''}" title="${esc(b.desc)}">
          <div class="bicon">${b.icon}</div><div class="btitle">${esc(b.title)}</div>
          <div class="small muted">${b.earned ? 'erreicht ' + new Date(b.earned.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE') : `${b.progress}/${b.goal}`}</div>
          ${b.earned ? '' : `<span class="sbar"><b style="width:${(b.progress / b.goal) * 100}%"></b></span>`}</div>`).join('')}</div>
        ${others.map((o) => `<p class="small muted" style="margin:12px 0 0">${esc(o.name)} hat ${o.badges.filter((b) => b.earned).length} von ${o.badges.length} Abzeichen: ${o.badges.filter((b) => b.earned).map((b) => b.icon).join(' ') || '–'}</p>`).join('')}
      </div>`;
  }

  // ----- Meldungen (Spielleiter) -----
  async function viewReports(status = 'open') {
    const r = await api(`/reports?status=${status}`);
    $app.innerHTML = `
      <div class="spread"><h1>⚑ Gemeldete Fragen</h1><a href="#/" class="small">Zurück</a></div>
      <div class="seg" style="margin:10px 0 16px"><button data-s="open" class="${status === 'open' ? 'on' : ''}">Offen</button><button data-s="done" class="${status === 'done' ? 'on' : ''}">Erledigt</button></div>
      ${r.items.length ? '' : `<p class="muted">${status === 'open' ? 'Keine offenen Meldungen. 🎉' : 'Noch nichts erledigt.'}</p>`}
      ${r.items.map((it, n) => {
        const q = it.question;
        const answer = q.type === 'estimate' ? `${q.answer} ${q.unit || ''}` : q.type === 'order' ? (q.answer || []).map((k) => q.items[k]).join(' → ') : (q.options || [])[q.answer];
        return `<div class="card">
          <div class="qhead"><span>${esc(q.genre || '')} ${q.type === 'estimate' ? '<span class="pill">Duell-Schätzfrage</span>' : levelBadge(it.level)} ${it.disabled ? '<span class="pill">deaktiviert</span>' : ''}</span><span class="small muted">${esc(it.qid)}</span></div>
          <div class="qtext">${esc(q.q)}</div>
          <div class="small">Richtige Antwort laut Katalog: <b>${esc(answer)}</b></div>
          <div class="small muted" style="margin-top:4px">Bisher ${it.stats.correct}/${it.stats.answered} richtig beantwortet${it.stats.answered ? ` (${Math.round((it.stats.correct / it.stats.answered) * 100)} %)` : ''}</div>
          <div style="margin:10px 0">${it.reports.map((x) => `<div class="small">• <b>${esc(x.reasonText)}</b> – ${esc(x.by || '?')}${x.comment ? `: „${esc(x.comment)}“` : ''}</div>`).join('')}</div>
          ${status === 'open' && it.inCatalog ? `<div class="row">
            ${q.type === 'estimate' ? '' : `<span class="small muted">Stufe:</span>
            ${[1, 2, 3].map((l) => `<button class="btn ghost small ${it.level === l ? 'onlv' : ''}" data-n="${n}" data-lv="${l}">${levelBadge(l)}</button>`).join('')}`}
            <button class="btn ghost small" data-n="${n}" data-dis="1">Aussortieren</button>
            <button class="btn small" data-n="${n}" data-ok="1">Erledigt</button>
          </div>` : status === 'open' ? `<button class="btn small" data-n="${n}" data-ok="1">Erledigt</button>` : ''}
        </div>`;
      }).join('')}
      <p class="small muted">Tipp: Falsche Antworten korrigierst du dauerhaft in der JSON-Datei im Ordner <code>questions/</code> bzw. <code>data/questions/</code>. „Aussortieren“ nimmt die Frage sofort aus dem Spiel.</p>`;
    $app.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => viewReports(b.dataset.s)));
    $app.querySelectorAll('[data-n]').forEach((b) => (b.onclick = async () => {
      const it = r.items[+b.dataset.n];
      const body = b.dataset.lv ? { level: +b.dataset.lv } : b.dataset.dis ? { disabled: true } : { dismiss: true };
      try { await api(`/reports/${encodeURIComponent(it.qid)}`, { method: 'POST', body }); toast(b.dataset.lv ? 'Stufe geändert' : b.dataset.dis ? 'Frage aussortiert' : 'Erledigt'); viewReports(status); }
      catch (e) { toast(e.message, true); }
    }));
  }

  // ----- Tab: Konto -----
  async function tabLedger($tab, g) {
    const rows = await api(`/games/${g.code}/ledger`);
    const meP = g.players.find((p) => p.me);
    $tab.innerHTML = `
      <div class="card center"><div class="small muted">Kontostand</div><div class="big pts">${meP.balance} P</div></div>
      <div class="card ledger">
        ${rows.length ? rows.map((r) => `
          <div class="l"><div><div>${esc(r.reason)}</div><div class="small muted">${r.ref && /^\d{4}/.test(r.ref) ? fmtDate(r.ref) : esc(r.ref || '')}</div></div><div class="pts">${sign(r.amount)}</div></div>`).join('')
          : '<p class="muted">Noch keine Buchungen – die erste Auszahlung kommt heute um 20:00 Uhr.</p>'}
      </div>`;
  }

  route();
})();
