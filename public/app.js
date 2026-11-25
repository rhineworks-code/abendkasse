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
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
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

  // ---------- Router ----------
  window.addEventListener('hashchange', route);

  async function route() {
    clearInterval(refreshTimer);
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
      if (parts[0] === 'restore') return viewRestore();
      if (!token) return viewWelcome(parts[0] === 'join' ? parts[1] : null);
      if (!me) { me = await api('/me'); setWho(); syncPush(); }
      if (parts[0] === 'join' && parts[1]) {
        const r = await api('/games/join', { method: 'POST', body: { code: parts[1] } });
        me = null;
        location.hash = `#/g/${r.code}`;
        return;
      }
      if (parts[0] === 'g' && parts[1]) return viewGame(parts[1].toUpperCase(), parts[2] || 'heute', parts[3]);
      if (parts[0] === 'profil') return viewProfile();
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

      ${notices(g)}

      <nav class="tabs">
        <a href="#/g/${code}" class="${tab === 'heute' || tab === 'extra' ? 'on' : ''}">Heute</a>
        <a href="#/g/${code}/woche" class="${tab === 'woche' || tab === 'tag' ? 'on' : ''}">Woche</a>
        <a href="#/g/${code}/konto" class="${tab === 'konto' ? 'on' : ''}">Konto</a>
      </nav>
      <section id="tab"><div class="loading">Lädt …</div></section>`;

    document.querySelectorAll('[data-invite]').forEach((b) => (b.onclick = () => openInvite(g)));
    bindNotices(g);
    // Direkt nach dem Erstellen: Einladen anbieten
    if (sessionStorage.getItem('ak_new') === g.code) { sessionStorage.removeItem('ak_new'); openInvite(g); }

    const $tab = document.getElementById('tab');
    if (tab === 'woche') return tabWeek($tab, g);
    if (tab === 'konto') return tabLedger($tab, g);
    if (tab === 'tag' && arg) return tabDay($tab, g, arg);
    if (tab === 'extra' && arg) return tabExtra($tab, g, arg);
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

  // Offene Runde spielen. date = null für heute, sonst Datum der Nachholrunde.
  function renderRound($tab, g, d, date, kind = 'day') {
    const isExtra = kind === 'extra';
    const total = d.questions.length;
    const reload = () => (isExtra ? tabExtra($tab, g, date) : date ? tabDay($tab, g, date) : tabToday($tab, g));
    const until = Date.now() + d.msUntilPayout;
    const hh = String(d.payoutHour).padStart(2, '0') + ':00';
    const head = isExtra
      ? `<div class="notice extra"><div>🎲 <b>Extrarunde</b> <span class="small muted">– ${total} Zusatzfragen, Auflösung um ${hh} Uhr</span></div><a class="btn ghost small" href="#/g/${g.code}">Zur Tagesrunde</a></div>`
      : date ? `<div class="notice replay"><div>🔁 <b>Nachholrunde für ${fmtDate(date)}</b> <span class="small muted">– ${dueText(g, d.due)}, danach Auflösung</span></div><a class="btn ghost small" href="#/g/${g.code}">Zur heutigen Runde</a></div>` : '';
    const next = d.questions.findIndex((q) => q.mine === null);
    const progressHtml = `
      <div class="card"><h2 style="margin-top:0">Fortschritt ${isExtra ? 'Extrarunde' : date ? 'Nachholrunde' : 'heute'}</h2><div class="progress">
        ${d.progress.map((p) => `<div class="prog">${avatar(p, 26)}<span style="min-width:80px">${esc(p.name)}${p.me ? ' (du)' : ''}</span>
          <span class="bar"><b style="width:${(p.answered / p.total) * 100}%"></b></span><span class="small muted">${p.answered}/${p.total}</span></div>`).join('')}
      </div></div>`;

    if (next === -1) {
      $tab.innerHTML = `${head}
        <div class="card center hero">
          <div class="big">🔒</div>
          <h2>Alle ${total} Antworten sind abgegeben</h2>
          <p class="muted">Die Kasse öffnet ${!isExtra && date && d.due !== g.today ? 'am ' + fmtDate(d.due) + ' ' : ''}um ${hh} Uhr – dann siehst du, wie viele richtig waren.</p>
          ${isExtra || !date || d.due === g.today ? `<div class="countdown" data-until="${until}">--:--:--</div>` : ''}
        </div>
        ${progressHtml}
        <div class="card"><h2 style="margin-top:0">Deine Tipps</h2>
          ${d.questions.map((q, i) => `<div style="margin-bottom:10px"><div class="small muted">${i + 1}. ${esc(q.genre)}</div><div>${esc(q.q)}</div><div class="pts">→ ${esc(q.options[q.mine])}</div></div>`).join('')}
        </div>`;
      refreshTimer = setInterval(async () => {
        try { const x = await api(isExtra ? `/games/${g.code}/extra/${date}` : date ? `/games/${g.code}/days/${date}` : `/games/${g.code}/today`); if (x.state !== 'open' || JSON.stringify(x.progress) !== JSON.stringify(d.progress)) route(); } catch (e) { /* still */ }
      }, 30000);
      return;
    }

    const q = d.questions[next];
    $tab.innerHTML = `${head}
      <div class="card">
        <div class="dots">${d.questions.map((x, i) => `<i class="${x.mine !== null ? 'a' : i === next ? 'c' : ''}"></i>`).join('')}</div>
        <div class="qhead"><span>Frage ${next + 1} von ${total}</span><span>${esc(q.genre)} ${levelBadge(q.level)}</span></div>
        <div class="qtext">${esc(q.q)}</div>
        <div class="opts">
          ${q.options.map((o, i) => q.removed.includes(i)
            ? `<button class="opt gone" disabled><span class="k">${KEYS[i]}</span><span>${esc(o)}</span></button>`
            : `<button class="opt" data-i="${i}"><span class="k">${KEYS[i]}</span><span>${esc(o)}</span></button>`).join('')}
        </div>
        <div class="spread" style="margin-top:14px">
          <p class="small muted" style="margin:0">Jede Antwort ist endgültig. Aufgelöst wird um ${hh} Uhr.</p>
          ${q.removed.length ? '<span class="joker used">50:50 aktiv</span>'
            : d.jokers.left > 0 ? `<button class="joker" id="joker" title="Entfernt zwei falsche Antworten">50:50 <small>${d.jokers.left}×</small></button>`
            : '<span class="joker used">Joker verbraucht</span>'}
        </div>
      </div>
      ${progressHtml}`;

    const jb = document.getElementById('joker');
    if (jb) jb.onclick = async () => {
      if (!confirm('50:50-Joker für diese Frage einsetzen? Du hast nur einen pro Runde.')) return;
      try { await api(`/games/${g.code}/joker`, { method: 'POST', body: { idx: next, date, kind } }); reload(); }
      catch (e) { toast(e.message, true); }
    };

    $tab.querySelectorAll('.opt:not(.gone)').forEach((b) => (b.onclick = async () => {
      $tab.querySelectorAll('.opt').forEach((x) => (x.disabled = true));
      b.classList.add('picked');
      try {
        await api(`/games/${g.code}/answer`, { method: 'POST', body: { idx: next, choice: +b.dataset.i, date, kind } });
        // Letzte Frage: ganze Ansicht neu laden (Extrarunden-Angebot, Fortschritt des Partners)
        setTimeout(next === total - 1 ? route : reload, 350);
      } catch (e) { toast(e.message, true); setTimeout(route, 1200); }
    }));
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

    $tab.innerHTML = `
      <div class="card center hero">
        <div class="small muted">${d.kind === 'extra' ? '🎲 Extrarunde vom ' + fmtDate(d.date) : isToday ? 'Heutige Auszahlung' : (d.replay ? 'Nachholrunde für ' : 'Auszahlung vom ') + fmtDate(d.date)}</div>
        <div class="row" style="justify-content:center; gap:24px; margin-top:10px">
          ${d.results.map((r) => `
            <div>
              <div>${avatar(r, 56)}</div>
              <div class="small" style="color:${r.me ? 'var(--me)' : 'var(--friend)'}">${esc(r.name)} ${r.points === best && best > 0 ? '♛' : ''}</div>
              <div class="big">${r.correct}/${r.total}</div>
              <div class="pts">${sign(r.points)} P</div>
            </div>`).join('')}
        </div>
        ${isToday && g.extra && g.extra.status === 'paid' ? `<a class="btn ghost small" style="margin-top:12px" href="#/g/${g.code}/extra/${d.date}">🎲 Extrarunde ansehen</a>` : ''}
        ${isToday ? '<p class="muted small" style="margin-top:12px">Morgen gibt es neue Fragen.</p>' : ''}
      </div>
      ${d.questions.map((q, i) => {
        const my = mine ? mine.answers[i] : undefined;
        return `
        <div class="card">
          <div class="qhead"><span>Frage ${i + 1} ${d.results.filter((r) => r.jokers.includes(i)).map((r) => `<span class="mk ${r.me ? 'me' : 'fr'}">50:50 ${r.me ? 'du' : esc(r.name)}</span>`).join(' ')}</span><span>${esc(q.genre)} ${levelBadge(q.level)}</span></div>
          <div class="qtext">${esc(q.q)}</div>
          <div class="opts">
            ${q.options.map((o, oi) => {
              const cls = oi === q.answer ? 'right' : oi === my ? 'wrong' : '';
              const marks = [
                my === oi ? `<span class="mk me">du</span>` : '',
                ...others.filter((r) => r.answers[i] === oi).map((r) => `<span class="mk fr">${esc(r.name)}</span>`),
              ].join('');
              return `<button class="opt ${cls}" disabled><span class="k">${KEYS[oi]}</span><span>${esc(o)}</span><span class="marks">${marks}</span></button>`;
            }).join('')}
          </div>
          ${my === undefined ? '<p class="small muted" style="margin:10px 0 0">Nicht beantwortet</p>' : ''}
        </div>`;
      }).join('')}`;
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
        <h2 style="margin-top:0">Schwierigkeit</h2>
        ${diffSeg('gdiff', g.difficulty)}
        <p class="small muted" style="margin:8px 0 0">Gilt ab der nächsten neuen Runde – bereits gestellte Fragen bleiben.</p>
      </div>

      <div class="card small muted">
        <b style="color:var(--text)">Regeln:</b> ${g.rules.perCorrect} P pro richtige Antwort · +${g.rules.perfectBonus} P für einen perfekten Tag ·
        +${g.rules.weekBonus} P für den Wochensieg · ein 50:50-Joker pro Tag · Auszahlung täglich ${g.rules.payoutHour}:00 Uhr.
        Mit ↻ lässt sich ein vergangener Tag dieser Woche wiederholen oder streichen, wenn alle zustimmen.
        Seid ihr beide vor ${String(g.rules.extraBefore).padStart(2, '0')}:00 Uhr fertig, gibt es auf Wunsch eine Extrarunde mit ${g.rules.extraQuestions} Fragen.
        Genres: ${g.genres.map(esc).join(', ')} (${g.mode === 'daily' ? 'ein Genre pro Tag' : 'gemischt'}, ${g.perDay} Fragen/Tag).
      </div>

      <h2>Vergangene Wochen</h2>
      ${g.weeks.length ? `<div class="card daylist">${g.weeks.map((w) => `
        <div class="d"><span>Woche ${w.week} <span class="muted small">${fmtDate(w.start)} – ${fmtDate(w.end)}</span></span>
        <span>${w.winners.length ? '♛ ' + w.winners.map((id) => esc(byId[id]?.name || '?')).join(' & ') : '<span class="muted">kein Sieger</span>'}
        <span class="muted small">(${Object.entries(w.scores).map(([id, s]) => `${esc(byId[id]?.name || '?')} ${s}`).join(' : ')})</span></span></div>`).join('')}</div>`
        : '<p class="muted">Noch keine abgeschlossene Woche.</p>'}`;

    bindDiffSeg('gdiff', async (d) => {
      try { await api(`/games/${g.code}/settings`, { method: 'PUT', body: { difficulty: d } }); g.difficulty = d; toast(`Schwierigkeit: ${DIFF[d].label} – ab der nächsten Runde`); }
      catch (e) { toast(e.message, true); }
    });
    $tab.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () =>
      openDayAction(g, b.dataset.act, g.days.find((x) => x.date === b.dataset.act && x.kind !== 'extra'))));
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
