import { MEMBERS, LEVELS, GEAR_CATS, DEFAULT_PLACE, seedState, newId, applyOps, ytMusic } from './shared.mjs';

/* ================= Utilitaires ================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const memberName = (id) => (MEMBERS.find((m) => m.id === id) || {}).name || (id === 'groupe' ? 'Le groupe' : id || '?');
const levelLabel = (v) => (LEVELS[v] || LEVELS[0]).label;
const catLabel = (id) => (GEAR_CATS.find((c) => c.id === id) || GEAR_CATS[GEAR_CATS.length - 1]).label;
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const pad = (n) => String(n).padStart(2, '0');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', 'fr', { sensitivity: 'base' });
const LV_COLORS = ['transparent', 'var(--lv1)', 'var(--lv2)', 'var(--lv3)', 'var(--lv4)'];
const memberColor = (id) => (MEMBERS.find((m) => m.id === id) || {}).color || 'var(--faint)';
const fmtDur = (sec) => (sec ? `${Math.floor(sec / 60)}:${pad(Math.round(sec % 60))}` : '');
function hashStr(t) { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
const COVER_TONES = ['#c7cebb', '#d3cab0', '#bcc6c0', '#cdc2ad', '#b8c1a8', '#c9c3b9'];
// Pochette du morceau, ou une vignette avec ses initiales si on n'en a pas.
function coverTile(s, size = '') {
  const words = String(s.title || '?').replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const tone = COVER_TONES[hashStr(s.title) % COVER_TONES.length];
  const img = !PREVIEW && safeUrl(s.cover) ? `<img class="cov-img" src="${esc(s.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
  return `<span class="cov ${size}" style="--tone:${tone}" aria-hidden="true"><span class="cov-init">${esc(initials)}</span>${img}</span>`;
}

const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  listen: '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><path d="M5 8h14M5 12h14M5 16h14"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
};
const PREVIEW = !!window.HYSTERIA_PREVIEW;
const TABS = ['repertoire', 'setlist', 'planning', 'matos'];

/* ----- Dates ----- */
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
function parseISO(s) { const [y, m, d] = (s || '').split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function daysUntil(iso) { return Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000); }
const monthOf = (iso) => iso.slice(0, 7);
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  return m === '00' ? `${Number(h)} h` : `${Number(h)} h ${m}`;
}
const fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShortMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const fmtWeekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
function relDays(n) {
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return 'Demain';
  if (n > 1) return `Dans ${n} jours`;
  if (n === -1) return 'Hier';
  return `Il y a ${-n} jours`;
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'hier';
  return fmtShort.format(new Date(ts));
}

/* ================= État ================= */
const app = {
  base: LS.get('hy.base', null),
  rev: LS.get('hy.rev', null),
  pending: LS.get('hy.pending', []),
  view: null,
  me: LS.get('hy.me', null),
  code: LS.get('hy.code', ''),
  tab: LS.get('hy.tab', 'repertoire'),
  repSort: 'az',
  query: '',
  gigId: LS.get('hy.gig', null),
  calMonth: monthOf(todayISO()),
  matosView: LS.get('hy.matosView', 'inventaire'),
  gearOwner: 'all',
  showPast: false,
  sheet: null,
  drafts: {},
  mode: 'boot', // boot | online | offline | local | locked
  sending: false,
  lastSync: 0,
  dragging: false,
  needRender: false,
  suggest: { q: '', items: [] },
  calSel: null,
  calMode: 'fill',
};
if (!TABS.includes(app.tab)) app.tab = 'repertoire';
if (!MEMBERS.some((m) => m.id === app.me)) app.me = null;
if (app.base) app.view = applyOps(clone(app.base), clone(app.pending));

function persist() {
  if (app.mode === 'local') { LS.set(PREVIEW ? 'hy.preview' : 'hy.local', app.base); return; }
  LS.set('hy.base', app.base);
  LS.set('hy.rev', app.rev);
  LS.set('hy.pending', app.pending);
}

/* ================= Synchro ================= */
const API = '/api/state';
function headers() {
  const h = { 'content-type': 'application/json' };
  if (app.code) h['x-band-code'] = app.code;
  return h;
}
function setMode(m) {
  if (app.mode === m) return;
  app.mode = m;
  renderHeader();
  if (app.sheet && app.sheet.type === 'profile') renderSheet();
}

async function pull() {
  if (app.mode === 'local' || app.mode === 'locked' || app.sending || app.pending.length) return;
  try {
    const q = app.base && app.rev ? '?rev=' + encodeURIComponent(app.rev) : '';
    const r = await fetch(API + q, { headers: headers(), cache: 'no-store' });
    if (r.status === 401) return lock(!!app.code);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return goLocal();
    const res = await r.json();
    if (!r.ok) throw new Error(res.error || r.status);
    app.lastSync = Date.now();
    setMode('online');
    if (!res.same) receive(res);
    fillCovers();
  } catch {
    setMode('offline');
    if (!app.view) renderAll();
  }
}

async function push() {
  if (app.mode === 'local' || app.mode === 'locked' || app.sending || !app.pending.length) return;
  app.sending = true;
  renderHeader();
  const batch = app.pending.slice();
  try {
    const r = await fetch(API, { method: 'POST', headers: headers(), body: JSON.stringify({ ops: batch }) });
    if (r.status === 401) { app.sending = false; return lock(true); }
    const res = await r.json();
    if (!r.ok) throw new Error(res.error || r.status);
    app.pending.splice(0, batch.length);
    app.sending = false;
    app.lastSync = Date.now();
    app.mode = 'online';
    receive(res);
    if (app.pending.length) push();
  } catch {
    app.sending = false;
    setMode('offline');
    renderHeader();
    setTimeout(push, 5000);
  }
}

function receive(res) {
  app.base = res.data;
  app.rev = res.rev;
  app.view = applyOps(clone(app.base), clone(app.pending));
  persist();
  renderAll();
}

function commit(ops) {
  if (!ops.length || !app.view) return;
  if (app.mode === 'local') {
    applyOps(app.base, clone(ops));
    app.view = clone(app.base);
    persist();
    renderAll();
    return;
  }
  app.pending.push(...ops);
  applyOps(app.view, clone(ops));
  persist();
  renderAll();
  push();
}

function goLocal() {
  app.mode = 'local';
  app.pending = [];
  app.base = LS.get(PREVIEW ? 'hy.preview' : 'hy.local', null) || seedState();
  app.view = clone(app.base);
  persist();
  renderAll();
}

function lock(wrong) {
  app.mode = 'locked';
  renderOverlay(wrong);
}

/* ================= Accès aux données ================= */
const D = (k) => (app.view && app.view[k]) || {};
const songsList = () => Object.values(D('songs')).sort(byTitle);
function gigsList() {
  return Object.values(D('gigs')).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.name || '').localeCompare(b.name || ''));
}
function currentGig() {
  const gigs = D('gigs');
  if (app.gigId && gigs[app.gigId]) return gigs[app.gigId];
  const list = gigsList();
  const t = todayISO();
  const g = list.find((x) => !x.date || x.date >= t) || list[0] || null;
  app.gigId = g ? g.id : null;
  return g;
}
const availOn = (iso) => MEMBERS.filter((m) => (D('avail')[iso] || {})[m.id]).map((m) => m.id);
const availNote = (iso, mid) => { const v = (D('avail')[iso] || {})[mid]; return v && typeof v === 'object' ? v.n || '' : ''; };
function dispoChips(iso) {
  const av = availOn(iso);
  return MEMBERS.map((m) => {
    const on = av.includes(m.id);
    const note = on ? availNote(iso, m.id) : '';
    return `<span class="dp${on ? ' oui' : ''}" style="--mc:${m.color}"><i></i>${esc(m.name)}${note ? `<em>${esc(note)}</em>` : ''}</span>`;
  }).join('');
}
function avgLevel(s) {
  const lv = s.levels || {};
  return MEMBERS.reduce((t, m) => t + (lv[m.id] || 0), 0) / MEMBERS.length;
}
function nextEvent() {
  const t = todayISO();
  return Object.values(D('events')).filter((e) => e.date >= t)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0] || null;
}
const evTitle = (ev) => ev.title || (ev.type === 'concert' ? 'Concert' : 'Répète');

/* ================= Métronome ================= */
const metro = {
  ctx: null, playing: false, bpm: 0, songId: null, next: 0, beat: 0, timer: null, beats: [],
  start(songId, bpm) {
    if (!bpm) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume();
    } catch { toast("Le son n'est pas dispo sur cet appareil"); return; }
    clearInterval(this.timer);
    this.playing = true;
    this.bpm = bpm;
    this.songId = songId;
    this.beat = 0;
    this.beats = [];
    this.next = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
    renderPlaybar(); renderView(); renderSheet();
    requestAnimationFrame(beatLoop);
  },
  tick() {
    const ctx = this.ctx;
    const spb = 60 / this.bpm;
    while (this.next < ctx.currentTime + 0.12) {
      this.click(this.next, this.beat % 4 === 0);
      const lat = ctx.outputLatency || ctx.baseLatency || 0;
      this.beats.push({ t: performance.now() / 1000 + (this.next - ctx.currentTime) + lat, n: this.beat % 4 });
      this.next += spb;
      this.beat++;
    }
    const cut = performance.now() / 1000 - 2;
    while (this.beats.length > 2 && this.beats[0].t < cut) this.beats.shift();
  },
  click(t, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1760 : 1180;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.32 : 0.18, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.06);
  },
  stop() {
    clearInterval(this.timer);
    this.playing = false;
    this.songId = null;
    this.beats = [];
    renderPlaybar(); renderView(); renderSheet();
  },
  toggle(songId, bpm) {
    if (this.playing && this.songId === songId) this.stop();
    else this.start(songId, bpm);
  },
};

// Allume le temps en cours (1 2 3 4) dans la barre de click.
function beatLoop() {
  if (!metro.playing) return;
  requestAnimationFrame(beatLoop);
  const now = performance.now() / 1000;
  let cur = null;
  for (const b of metro.beats) { if (b.t <= now) cur = b; else break; }
  document.querySelectorAll('#playbar .beats i').forEach((d, i) => d.classList.toggle('on', !!cur && cur.n === i && now - cur.t < 0.16));
}

/* ================= Rendu ================= */
function patch(el, html) {
  const a = document.activeElement;
  let key = null, s = null, e = null;
  if (a && el.contains(a) && a.dataset && a.dataset.draft) {
    key = a.dataset.draft;
    try { s = a.selectionStart; e = a.selectionEnd; } catch {}
  }
  const scroll = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = scroll;
  if (key) {
    const n = el.querySelector(`[data-draft="${CSS.escape(key)}"]`);
    if (n) {
      n.focus({ preventScroll: true });
      try { if (s != null) n.setSelectionRange(s, e); } catch {}
    }
  }
}
const draft = (k, d = '') => (app.drafts[k] !== undefined ? app.drafts[k] : d);

function renderAll() {
  renderHeader();
  renderTabs();
  renderView();
  renderSheet();
  renderOverlay();
}

function renderHeader() {
  const me = $('#meBtn');
  const dotCls = app.mode === 'local' ? 'local' : app.mode === 'offline' ? 'offline' : (app.sending || app.pending.length) ? 'sending' : '';
  me.innerHTML = `<span class="dot ${dotCls}"></span>${esc(app.me ? memberName(app.me) : 'Profil')}`;
  me.title = statusText();
  renderNextLine();
  renderPlaybar();
}

function statusText() {
  if (app.mode === 'local') return PREVIEW ? 'Aperçu : les modifs restent sur cet appareil' : 'Mode local : rien n’est partagé (le site n’est pas encore sur Netlify)';
  if (app.mode === 'offline') return app.pending.length ? `Hors ligne, ${plural(app.pending.length, 'modif', 'modifs')} en attente` : 'Hors ligne';
  if (app.sending || app.pending.length) return 'Envoi en cours…';
  if (app.lastSync) return 'Synchronisé avec le groupe';
  return 'Connexion…';
}

function renderNextLine() {
  const el = $('#nextLine');
  if (!app.view) { el.innerHTML = ''; return; }
  const ev = nextEvent();
  if (ev) {
    const n = daysUntil(ev.date);
    const d = parseISO(ev.date);
    const day = n <= 6 ? fmtWeekday.format(d) : fmtDay.format(d);
    el.innerHTML = `<button data-act="open-event" data-id="${esc(ev.id)}">
      <span>${ev.type === 'concert' ? 'Prochain concert' : 'Prochaine répète'}</span>
      <strong>${esc(day)}${ev.time ? ' à ' + fmtTime(ev.time) : ''}</strong>
      <span class="when">${esc(relDays(n).toLowerCase())}</span></button>`;
  } else {
    el.innerHTML = `<button data-act="tab" data-tab="planning"><span>Aucune date calée.</span> <strong>Remplir mes dispos</strong></button>`;
  }
}

function renderPlaybar() {
  const el = $('#playbar');
  $('#toast').classList.toggle('lift', metro.playing);
  if (!metro.playing) { el.hidden = true; el.innerHTML = ''; return; }
  const s = D('songs')[metro.songId];
  el.hidden = false;
  el.innerHTML = `
    <div class="playbar-inner">
      <span class="pb-bpm">${metro.bpm}</span>
      <div class="pb-text">
        <span class="pb-title">${esc(s ? s.title : 'Click')}</span>
        <div class="beats" aria-hidden="true"><i class="accent"></i><i></i><i></i><i></i></div>
      </div>
      <button class="pb-stop" data-act="metro-stop">Arrêter</button>
    </div>`;
}

function renderTabs() {
  document.querySelectorAll('#tabs button').forEach((b) => {
    if (b.dataset.tab === app.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function renderView() {
  if (app.dragging) { app.needRender = true; return; }
  const el = $('#view');
  if (!app.view) {
    patch(el, app.mode === 'offline'
      ? `<p class="lede">Impossible de joindre le serveur. Vérifie ta connexion, ça réessaie tout seul.</p>`
      : `<p class="lede">Chargement…</p>`);
    return;
  }
  const html = { repertoire: viewRepertoire, setlist: viewSetlist, planning: viewPlanning, matos: viewMatos }[app.tab] || viewRepertoire;
  patch(el, html());
}

function emptyCard(title, text, action, label) {
  return `<div class="empty-card"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action ? `<button class="btn primary" data-act="${action}">${ICON.plus}${esc(label)}</button>` : ''}</div>`;
}

/* ----- Répertoire ----- */
function pipsFor(s) {
  const lv = s.levels || {};
  return MEMBERS.map((m) => `<span class="pip lv${lv[m.id] || 0}${m.id === app.me ? ' mine' : ''}" title="${esc(m.name)} : ${esc(levelLabel(lv[m.id] || 0))}">${esc(m.name[0])}</span>`).join('');
}

function viewRepertoire() {
  const all = songsList();
  let list = all.slice();
  const q = app.query.trim().toLowerCase();
  if (q) list = list.filter((s) => (s.title + ' ' + s.artist).toLowerCase().includes(q));
  if (app.repSort === 'work') {
    list.sort((a, b) => ((a.levels || {})[app.me] || 0) - ((b.levels || {})[app.me] || 0) || avgLevel(a) - avgLevel(b) || byTitle(a, b));
  }
  const n = all.length;
  const pct = n ? Math.round((all.reduce((t, s) => t + avgLevel(s), 0) / (n * 4)) * 100) : 0;
  const ready = all.filter((s) => MEMBERS.every((m) => ((s.levels || {})[m.id] || 0) >= 3)).length;
  const counts = [0, 0, 0, 0, 0];
  all.forEach((s) => MEMBERS.forEach((m) => counts[(s.levels || {})[m.id] || 0]++));
  const cells = Math.max(1, n * MEMBERS.length);
  const meter = [4, 3, 2, 1].map((v) => `<span style="width:${(counts[v] / cells) * 100}%;background:${LV_COLORS[v]}"></span>`).join('');

  const rows = list.map((s) => `
    <li class="song${metro.playing && metro.songId === s.id ? ' playing' : ''}" data-act="open-song" data-id="${esc(s.id)}" tabindex="0" role="button">
      ${coverTile(s)}
      <div class="main"><span class="title">${esc(s.title)}</span><span class="artist">${esc(s.artist)}</span></div>
      <div class="tempo"><span class="bpm${s.bpm ? '' : ' empty'}">${s.bpm || '—'}</span><span class="key">${esc(s.key || '')}</span></div>
      <div class="pips">${pipsFor(s)}</div>
    </li>`).join('');

  return `
    <div class="section-head">
      <h2>Répertoire</h2>
      <button class="btn primary small" data-act="add-song">${ICON.plus}Ajouter un morceau</button>
    </div>
    <div class="summary">
      <div class="pct">${pct}<small>%</small></div>
      <div class="sum-line"><strong>${ready}</strong> sur ${plural(n, 'morceau', 'morceaux')} prêts pour tout le monde</div>
      <div class="sum-line">Niveau moyen du groupe sur tout le répertoire</div>
      <div class="meter" aria-hidden="true">${meter}</div>
    </div>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Trier">
        <button data-act="rep-sort" data-v="az" aria-pressed="${app.repSort === 'az'}">De A à Z</button>
        <button data-act="rep-sort" data-v="work" aria-pressed="${app.repSort === 'work'}">À bosser</button>
      </div>
      <input class="search" type="search" placeholder="Chercher un morceau" data-draft="q" data-bind="query" value="${esc(app.query)}" aria-label="Chercher un morceau">
    </div>
    <ul class="songs">${rows || '<p class="empty-note">Aucun morceau ne correspond.</p>'}</ul>
    <div class="legend">${LEVELS.map((l) => `<span><i class="lvl-sw-${l.v}"></i>${esc(l.label)}</span>`).join('')}</div>`;
}

/* ----- Setlist ----- */
function gigChips() {
  const gigs = gigsList();
  const cur = currentGig();
  if (gigs.length < 2) return '';
  return `<div class="gig-chips" role="group" aria-label="Choisir le concert">${gigs.map((g) => `
    <button class="gig-chip" data-act="pick-gig" data-id="${esc(g.id)}" aria-pressed="${cur && cur.id === g.id}">
      <span class="gc-name">${esc(g.name)}</span><span class="gc-date">${g.date ? esc(fmtShort.format(parseISO(g.date))) : 'Date à définir'}</span>
    </button>`).join('')}</div>`;
}

function gigHead(g, count, countLabel) {
  return `
    <div class="gig-head">
      <div class="gig-titles">
        <div class="gig-name">${esc(g.name)}</div>
        <div class="gig-sub">${g.date ? esc(fmtDay.format(parseISO(g.date))) : 'Date à définir'}, ${esc(countLabel(count))}</div>
      </div>
      <button class="link-btn" data-act="edit-gig">Modifier</button>
    </div>`;
}

function viewSetlist() {
  const head = `
    <div class="section-head">
      <h2>Setlist</h2>
      <button class="btn small" data-act="new-gig">${ICON.plus}Nouvelle setlist</button>
    </div>`;
  const g = currentGig();
  if (!g) {
    return head + emptyCard('Pas encore de setlist', 'Crée la setlist d’un concert, ajoute des morceaux du répertoire, puis range-les dans l’ordre en les faisant glisser.', 'new-gig', 'Créer une setlist');
  }
  const songs = D('songs');
  const ids = (g.songs || []).filter((id) => songs[id]);
  const tr = g.transitions || {};
  const rows = ids.map((id, i) => {
    const s = songs[id];
    const nextId = ids[i + 1];
    let gap = '';
    if (nextId) {
      const t = tr[id + '__' + nextId];
      gap = `<li class="sl-gap">${t
        ? `<button class="tr-card" data-act="edit-transition" data-from="${esc(id)}" data-to="${esc(nextId)}"><span class="tr-label">Transition</span><span class="tr-title">${esc(t.title || 'Transition')}</span>${t.text ? `<span class="tr-text">${esc(t.text)}</span>` : ''}</button>`
        : `<button class="tr-add" data-act="edit-transition" data-from="${esc(id)}" data-to="${esc(nextId)}" aria-label="Ajouter une transition entre ${esc(s.title)} et ${esc(songs[nextId].title)}">${ICON.plus}Transition</button>`}</li>`;
    }
    return `
      <li class="sl-row${metro.playing && metro.songId === id ? ' playing' : ''}" data-id="${esc(id)}">
        <button class="grip" data-drag-handle aria-label="Déplacer ${esc(s.title)}">${ICON.grip}</button>
        <span class="sl-num">${i + 1}</span>
        ${coverTile(s, 'sm')}
        <button class="sl-main" data-act="open-song" data-id="${esc(id)}"><span class="title">${esc(s.title)}</span><span class="artist">${esc(s.artist)}</span></button>
        <span class="sl-meta"><span class="bpm">${s.bpm || ''}</span><span class="key">${esc(s.key || '')}</span></span>
        <button class="x" data-act="gig-remove-song" data-id="${esc(id)}" aria-label="Retirer ${esc(s.title)} de la setlist">${ICON.close}</button>
      </li>${gap}`;
  }).join('');
  const total = ids.reduce((t, id) => t + (songs[id].duration || 0), 0);
  const known = ids.filter((id) => songs[id].duration).length;
  const countLabel = (n) => plural(n, 'morceau', 'morceaux') + (known ? `, environ ${Math.round(total / 60)} min${known < n ? ' (sans les durées manquantes)' : ''}` : '');
  return head + gigChips() + gigHead(g, ids.length, countLabel) + `
    ${ids.length ? `<ol class="setlist" id="setlist">${rows}</ol><p class="hint">Maintiens la poignée à gauche et fais glisser pour changer l’ordre. Touche « Transition » entre deux morceaux pour noter comment vous enchaînez.</p>` : '<p class="empty-note">Aucun morceau dans cette setlist pour l’instant.</p>'}
    <div class="add-row"><button class="btn primary block" data-act="pick-songs">${ICON.plus}Ajouter des morceaux</button></div>`;
}

/* ----- Planning ----- */
function bestDates() {
  const t = todayISO();
  const taken = new Set(Object.values(D('events')).map((e) => e.date));
  const out = [];
  for (let i = 0; i < 60; i++) {
    const iso = addDays(t, i);
    if (taken.has(iso)) continue;
    const av = availOn(iso);
    if (av.length >= 2) out.push({ iso, av });
  }
  out.sort((a, b) => b.av.length - a.av.length || a.iso.localeCompare(b.iso));
  return out.slice(0, 4);
}

function dateBlock(iso) {
  const d = parseISO(iso);
  return `<div class="ev-date"><span class="d">${d.getDate()}</span><span class="m">${esc(fmtShortMonth.format(d))}</span></div>`;
}

function dayPanel(iso, evByDate) {
  const av = availOn(iso);
  const evs = evByDate[iso] || [];
  const mine = !!app.me && av.includes(app.me);
  const past = iso < todayISO();
  return `
    <div class="day-panel">
      <div class="dp-head">
        <h4>${esc(fmtDay.format(parseISO(iso)))}</h4>
        <span class="dp-count">${av.length} sur ${MEMBERS.length}</span>
      </div>
      ${evs.map((e) => `<button class="dp-event" data-act="open-event" data-id="${esc(e.id)}">${esc(evTitle(e))}${e.time ? ' à ' + fmtTime(e.time) : ''}${e.place ? ', ' + esc(e.place) : ''}</button>`).join('')}
      <ul class="dp-list">${MEMBERS.map((m) => {
        const on = av.includes(m.id);
        const note = on ? availNote(iso, m.id) : '';
        return `<li class="${on ? 'on' : ''}"><i style="background:${m.color}"></i><strong>${esc(m.name)}${m.id === app.me ? ' (toi)' : ''}</strong><span>${on ? (note ? esc(note) : 'dispo') : 'pas dispo'}</span></li>`;
      }).join('')}</ul>
      ${mine && !past ? `
        <div class="dp-note">
          <label for="availNote">Tes horaires ce jour-là (facultatif)</label>
          <div class="dp-note-row">
            <input id="availNote" class="input" data-draft="avail.${iso}" data-enter="save-avail-note" value="${esc(draft('avail.' + iso, availNote(iso, app.me)))}" placeholder="ex. à partir de 19 h" maxlength="120">
            <button class="btn small" data-act="save-avail-note">OK</button>
          </div>
        </div>` : ''}
      ${!mine && !past && app.me ? `<button class="chip" data-act="toggle-day" data-date="${iso}">Je suis dispo ce jour-là</button>` : ''}
    </div>`;
}

function viewPlanning() {
  const [y, m] = app.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const nDays = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const today = todayISO();
  const evByDate = {};
  Object.values(D('events')).forEach((e) => { (evByDate[e.date] = evByDate[e.date] || []).push(e); });
  if (!app.calSel || monthOf(app.calSel) !== app.calMonth) {
    app.calSel = monthOf(today) === app.calMonth ? today : `${app.calMonth}-01`;
  }

  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<span class="day blank" aria-hidden="true"></span>';
  for (let d = 1; d <= nDays; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const av = availOn(iso);
    const mine = !!app.me && av.includes(app.me);
    const full = av.length === MEMBERS.length;
    const past = iso < today;
    const evs = evByDate[iso] || [];
    const names = av.map(memberName).join(', ');
    const label = `${fmtDay.format(parseISO(iso))} : ${av.length ? names : 'personne'} dispo${evs.length ? ', ' + evs.map(evTitle).join(', ') : ''}`;
    const fill = app.calMode === 'fill';
    cells += `
      <button class="day${mine ? ' mine' : ''}${full ? ' full' : ''}${past ? ' past' : ''}${iso === today ? ' today' : ''}${iso === app.calSel ? ' sel' : ''}" data-act="${fill ? 'toggle-day' : 'select-day'}" data-date="${iso}" ${fill ? `aria-pressed="${mine}"` : ''} aria-label="${esc(label)}" title="${esc(av.length ? names : 'Personne pour l’instant')}" ${fill && (past || !app.me) ? 'disabled' : ''}>
        <span class="n">${d}</span>${evs.length ? `<span class="ev-dot${evs.some((e) => e.type === 'concert') ? ' concert' : ''}"></span>` : ''}
        <span class="who">${MEMBERS.map((mm) => `<i${av.includes(mm.id) ? ` class="on" style="--mc:${mm.color}"` : ''}></i>`).join('')}</span>
      </button>`;
  }
  const monthLabel = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const canPrev = app.calMonth > monthOf(today);

  const best = bestDates();
  const bestHtml = best.length ? `<ul class="events">${best.map(({ iso, av }) => {
    const missing = MEMBERS.filter((mm) => !av.includes(mm.id)).map((mm) => mm.name);
    const full = !missing.length;
    const notes = av.map((id) => [id, availNote(iso, id)]).filter(([, n]) => n);
    return `
      <li class="ev best">
        ${dateBlock(iso)}
        <div><div class="ev-title">${esc(fmtDay.format(parseISO(iso)))}</div>
          <div class="ev-sub">${full ? 'Tout le monde est dispo' : `${av.length} sur ${MEMBERS.length}, sans ${esc(missing.join(' ni '))}`}</div>
          ${notes.length ? `<div class="ev-notes">${notes.map(([id, n]) => `<span><i style="background:${memberColor(id)}"></i>${esc(memberName(id))} : ${esc(n)}</span>`).join('')}</div>` : ''}</div>
        <button class="btn small${full ? ' primary' : ''}" data-act="plan-date" data-date="${iso}">Caler</button>
      </li>`;
  }).join('')}</ul>` : '<p class="empty-note">Coche tes jours de dispo dans l’agenda. Dès que deux personnes ou plus sont dispo le même jour, la date apparaît ici.</p>';

  const all = Object.values(D('events')).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const up = all.filter((e) => e.date >= today);
  const past = all.filter((e) => e.date < today).reverse();
  const row = (e, isPast) => `
    <li class="ev${isPast ? ' past' : ''}" data-act="open-event" data-id="${esc(e.id)}" tabindex="0" role="button">
      ${dateBlock(e.date)}
      <div><div class="ev-title">${esc(evTitle(e))}${e.type === 'concert' ? '<span class="badge">Concert</span>' : ''}</div>
        <div class="ev-sub">${esc(fmtWeekday.format(parseISO(e.date)))}${e.time ? ' à ' + fmtTime(e.time) : ''}${e.place ? ', ' + esc(e.place) : ''}</div></div>
      <div class="ev-count">${availOn(e.date).length}/${MEMBERS.length}<small>dispos</small></div>
    </li>`;

  return `
    <div class="section-head">
      <h2>Planning</h2>
      <button class="btn primary small" data-act="add-event">${ICON.plus}Ajouter une date</button>
    </div>
    <div class="seg cal-mode" role="group" aria-label="Mode de l’agenda">
      <button data-act="cal-mode" data-v="fill" aria-pressed="${app.calMode === 'fill'}">Remplir mes dispos</button>
      <button data-act="cal-mode" data-v="view" aria-pressed="${app.calMode === 'view'}">Voir le détail</button>
    </div>
    <p class="lede">${app.calMode === 'fill'
      ? (app.me ? 'Touche les jours où tu es dispo. Chaque couleur, c’est quelqu’un ; les jours où tout le monde peut passent en vert.' : 'Choisis ton profil pour remplir tes dispos.')
      : 'Touche un jour pour voir qui est dispo et à quelle heure, sans rien changer.'}</p>
    <div class="cal">
      <div class="cal-head">
        <button class="cal-nav" data-act="cal-nav" data-v="-1" aria-label="Mois précédent" ${canPrev ? '' : 'disabled'}>${ICON.prev}</button>
        <h3 class="cal-title">${esc(monthLabel)}</h3>
        <button class="cal-nav" data-act="cal-nav" data-v="1" aria-label="Mois suivant">${ICON.next}</button>
      </div>
      <div class="cal-legend">${MEMBERS.map((mm) => `<span><i style="background:${mm.color}"></i>${esc(mm.name)}</span>`).join('')}</div>
      <div class="cal-grid">
        ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span class="dow">${x}</span>`).join('')}
        ${cells}
      </div>
      ${dayPanel(app.calSel, evByDate)}
    </div>
    <h3 class="block-title">Meilleures dates</h3>
    ${bestHtml}
    <h3 class="block-title">Dates calées</h3>
    ${up.length ? `<ul class="events">${up.map((e) => row(e)).join('')}</ul>` : '<p class="empty-note">Aucune date calée pour l’instant.</p>'}
    ${past.length ? `
      <button class="link-btn past-toggle" data-act="toggle-past" aria-expanded="${app.showPast}">${app.showPast ? 'Masquer' : 'Voir'} les dates passées (${past.length})</button>
      ${app.showPast ? `<ul class="events">${past.map((e) => row(e, true)).join('')}</ul>` : ''}` : ''}`;
}

/* ----- Matos ----- */
function gearGrouped(items) {
  return GEAR_CATS.map((c) => ({ c, items: items.filter((x) => (GEAR_CATS.some((k) => k.id === x.cat) ? x.cat : 'autre') === c.id).sort((a, b) => a.name.localeCompare(b.name, 'fr')) }))
    .filter((g) => g.items.length);
}
const qtyTag = (x) => ((x.qty || 1) > 1 ? ` <span class="qty">×${x.qty}</span>` : '');

function viewMatos() {
  const seg = `
    <div class="seg matos-seg" role="group" aria-label="Vue">
      <button data-act="matos-view" data-v="inventaire" aria-pressed="${app.matosView === 'inventaire'}">Inventaire</button>
      <button data-act="matos-view" data-v="concert" aria-pressed="${app.matosView === 'concert'}">Pour un concert</button>
    </div>`;
  const gear = Object.values(D('gear'));

  if (app.matosView === 'inventaire') {
    const head = `
      <div class="section-head">
        <h2>Matos</h2>
        <button class="btn primary small" data-act="new-gear">${ICON.plus}Ajouter du matos</button>
      </div>${seg}`;
    if (!gear.length) {
      return head + emptyCard('L’inventaire est vide', 'Ajoute tout le matos du groupe, pièce par pièce : guitares, amplis, pédales, micros, câbles, piles… avec à qui c’est.', 'new-gear', 'Ajouter du matos');
    }
    const owners = [['all', 'Tout le monde', gear.length], ...MEMBERS.map((m) => [m.id, m.name, gear.filter((x) => x.owner === m.id).length]), ['groupe', 'Le groupe', gear.filter((x) => x.owner === 'groupe').length]].filter(([id, , n]) => id === 'all' || n);
    const items = app.gearOwner === 'all' ? gear : gear.filter((x) => x.owner === app.gearOwner);
    return head + `
      <div class="chips owner-chips" role="group" aria-label="À qui">
        ${owners.map(([id, label, n]) => `<button class="chip" data-act="gear-owner" data-v="${id}" aria-pressed="${app.gearOwner === id}">${esc(label)} <span class="chip-n">${n}</span></button>`).join('')}
      </div>
      ${gearGrouped(items).map(({ c, items: list }) => `
        <section class="gear-group">
          <h3>${esc(c.label)}<span class="count">${list.length}</span></h3>
          <ul class="gear-list">${list.map((x) => `
            <li class="gear-row" data-act="edit-gear" data-id="${esc(x.id)}" tabindex="0" role="button">
              <div class="gr-main"><span class="gr-name">${esc(x.name)}${qtyTag(x)}</span>${x.details ? `<span class="gr-details">${esc(x.details)}</span>` : ''}</div>
              <span class="owner">${esc(memberName(x.owner))}</span>
            </li>`).join('')}
          </ul>
        </section>`).join('') || '<p class="empty-note">Rien pour cette personne.</p>'}`;
  }

  const head = `<div class="section-head"><h2>Matos</h2></div>${seg}`;
  const g = currentGig();
  if (!g) return head + emptyCard('Pas encore de concert', 'Crée un concert (c’est la même chose qu’une setlist) pour préparer le matos à emmener.', 'new-gig', 'Créer un concert');
  const sel = g.gear || {};
  const gearMap = D('gear');
  const chosen = Object.keys(sel).filter((id) => gearMap[id]).map((id) => gearMap[id]);
  const done = chosen.filter((x) => sel[x.id]).length;
  return head + gigChips() + gigHead(g, chosen.length, (n) => plural(n, 'élément', 'éléments')) + `
    ${chosen.length ? `
      <div class="progress"><span><strong>${done}</strong> sur ${chosen.length} prêts</span><div class="meter"><span style="width:${(done / chosen.length) * 100}%;background:var(--moss)"></span></div></div>
      ${gearGrouped(chosen).map(({ c, items }) => `
        <section class="gear-group">
          <h3>${esc(c.label)}</h3>
          <ul class="todos">${items.map((x) => `
            <li class="todo${sel[x.id] ? ' done' : ''}">
              <button class="check" data-act="gig-check" data-id="${esc(x.id)}" aria-pressed="${!!sel[x.id]}" aria-label="${sel[x.id] ? 'Décocher' : 'Cocher'} ${esc(x.name)}">${ICON.check}</button>
              <div><span class="todo-text">${esc(x.name)}${qtyTag(x)}</span><span class="todo-who">${esc(memberName(x.owner))}${x.details ? ', ' + esc(x.details) : ''}</span></div>
            </li>`).join('')}
          </ul>
        </section>`).join('')}
      ${done ? '<button class="link-btn past-toggle" data-act="gig-uncheck-all">Tout décocher</button>' : ''}` : `<p class="empty-note">${gear.length ? 'Rien de sélectionné. Choisis dans l’inventaire ce qu’il faut emmener.' : 'Remplis d’abord l’inventaire, puis choisis ici ce qu’il faut emmener.'}</p>`}
    <div class="add-row"><button class="btn primary block" data-act="${gear.length ? 'pick-gear' : 'go-inventory'}">${gear.length ? 'Choisir le matos' : 'Aller à l’inventaire'}</button></div>`;
}

/* ================= Panneaux ================= */
function openSheet(s) {
  app.sheet = s;
  renderSheet();
}
function closeSheet() {
  app.sheet = null;
  renderSheet();
}

function renderSheet() {
  const wrap = $('#sheetWrap');
  const el = $('#sheet');
  const s = app.sheet;
  const hide = () => { app.sheet = null; wrap.hidden = true; document.body.style.overflow = ''; };
  if (!s || !app.view) { hide(); return; }
  const fn = {
    song: s.edit ? sheetSongEdit : sheetSong,
    event: s.edit ? sheetEventEdit : sheetEvent,
    gig: sheetGig,
    'pick-songs': sheetPickSongs,
    gear: sheetGear,
    'pick-gear': sheetPickGear,
    transition: sheetTransition,
    profile: sheetProfile,
  }[s.type];
  const html = fn ? fn(s) : null;
  if (html === null) { hide(); return; }
  const wasHidden = wrap.hidden;
  wrap.hidden = false;
  document.body.style.overflow = 'hidden';
  patch(el, html);
  if (wasHidden) el.scrollTop = 0;
}

const closeBtn = () => `<button class="close" data-act="close-sheet" aria-label="Fermer">${ICON.close}</button>`;
function sheetHead(title, sub, eyebrow) {
  return `<div class="sh-head"><div class="sh-titles">${eyebrow ? `<div class="sh-num">${eyebrow}</div>` : ''}<h2 class="sh-title">${title}</h2>${sub ? `<div class="sh-sub">${sub}</div>` : ''}</div>${closeBtn()}</div>`;
}
function formActions(isNew, saveAct, cancelAct, deleteAct, saveLabel) {
  return `<div class="form-actions">
    <button class="btn primary" data-act="${saveAct}">${saveLabel || (isNew ? 'Ajouter' : 'Enregistrer')}</button>
    <button class="btn ghost" data-act="${isNew ? 'close-sheet' : cancelAct}">Annuler</button>
    <span class="spacer"></span>
    ${isNew || !deleteAct ? '' : `<button class="btn danger" data-act="${deleteAct}">Supprimer</button>`}
  </div>`;
}

/* ----- Morceau ----- */
function sheetSong(s) {
  const song = D('songs')[s.id];
  if (!song) return null;
  const lv = song.levels || {};
  const mine = lv[app.me] || 0;
  const playing = metro.playing && metro.songId === song.id;
  const notes = Object.values(D('notes')).filter((n) => n.songId === song.id).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const link = safeUrl(song.link) || 'https://music.youtube.com/search?q=' + encodeURIComponent(song.artist + ' ' + song.title);
  const members = D('members');
  const inGigs = gigsList().filter((g) => (g.songs || []).includes(song.id));
  return `
    <div class="sh-head song-head">
      ${coverTile(song, 'lg')}
      <div class="sh-titles">
        ${inGigs.length ? `<div class="sh-num">Dans ${inGigs.length > 1 ? 'les setlists' : 'la setlist'} ${esc(inGigs.map((g) => g.name).join(', '))}</div>` : ''}
        <h2 class="sh-title">${esc(song.title)}</h2>
        <div class="sh-sub">${esc(song.artist)}${song.duration ? `, ${fmtDur(song.duration)}` : ''}</div>
      </div>
      ${closeBtn()}
    </div>
    <div class="row-actions">
      <a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener">${ICON.listen}Écouter</a>
      <button class="btn" data-act="song-edit">Modifier</button>
    </div>

    <div class="tempo-box">
      <div class="tempo-row">
        <div class="tempo-read"><span class="big${song.bpm ? '' : ' empty'}">${song.bpm || '—'}</span><span class="unit">BPM</span></div>
        <div class="keybox"><span class="keyv">${esc(song.key || '—')}</span><span class="keyl">tonalité</span></div>
      </div>
      ${song.bpm
        ? `<button class="btn ${playing ? 'playing' : 'primary'} block" data-act="metro-toggle">${playing ? ICON.stop + 'Arrêter le click' : ICON.play + 'Lancer le click'}</button>`
        : '<p class="empty-note" style="margin:0">Pas de tempo pour ce morceau. Ajoute-le dans « Modifier » pour avoir le click.</p>'}
    </div>

    <h3 class="block-title">Ton niveau${app.me ? '' : ' (choisis ton profil)'}</h3>
    <div class="levels" role="group" aria-label="Ton niveau">
      ${LEVELS.map((l) => `<button data-act="set-level" data-v="${l.v}" aria-pressed="${mine === l.v}" ${app.me ? '' : 'disabled'}><i class="lvl-sw-${l.v}"></i>${esc(l.label)}</button>`).join('')}
    </div>

    <h3 class="block-title">Le groupe</h3>
    <div class="band-levels">
      ${MEMBERS.map((m) => {
        const v = lv[m.id] || 0;
        const role = (members[m.id] || {}).role;
        return `<div class="bl">
          <span class="bl-name">${esc(m.name)}${role ? `<small>${esc(role)}</small>` : ''}</span>
          <span class="bl-label">${esc(levelLabel(v))}</span>
          <div class="bl-bar"><span style="width:${v * 25}%;background:${LV_COLORS[v]}"></span></div>
        </div>`;
      }).join('')}
    </div>

    <h3 class="block-title">Notes<span class="count">${notes.length || ''}</span></h3>
    ${notes.length ? `<ul class="notes">${notes.map((n) => `
      <li class="note">
        <div class="note-meta"><span class="who">${esc(memberName(n.by))}</span><span>${esc(ago(n.ts))}</span>
          <button class="del" data-act="note-del" data-id="${esc(n.id)}">Supprimer</button></div>
        <p class="note-text">${esc(n.text)}</p>
      </li>`).join('')}</ul>` : ''}
    <div class="composer">
      <textarea class="input" id="noteText" data-draft="note.${esc(song.id)}" placeholder="Ex. On rallonge le solo, Quentin lance le refrain final" aria-label="Nouvelle note">${esc(draft('note.' + song.id))}</textarea>
      <div><button class="btn" data-act="note-add">Ajouter la note</button></div>
    </div>`;
}

function sheetSongEdit(s) {
  const isNew = !s.id;
  if (!isNew && !D('songs')[s.id]) return null;
  const picked = { title: draft('song.title'), cover: draft('song.cover') };
  let search = '';
  if (isNew) {
    const sg = app.suggest;
    const q = draft('song.search');
    let list = '';
    if (app.mode === 'local') {
      list = '<p class="empty-note">Les suggestions et les pochettes arrivent quand l’appli est en ligne sur Netlify. Ici, remplis les champs à la main.</p>';
    } else if (q.trim().length >= 2) {
      if (sg.q !== q.trim()) list = '<p class="empty-note">Recherche…</p>';
      else if (sg.error) list = '<p class="empty-note">La recherche ne répond pas. Remplis les champs à la main.</p>';
      else if (!sg.items.length) list = '<p class="empty-note">Rien trouvé. Remplis les champs à la main.</p>';
      else {
        const have = new Set(Object.values(D('songs')).map((x) => (x.title + '|' + x.artist).toLowerCase()));
        list = `<ul class="suggest">${sg.items.map((it, i) => `
          <li><button class="sg-row" data-act="pick-suggest" data-i="${i}">
            ${coverTile(it, 'sm')}
            <span class="pick-main"><span class="title">${esc(it.title)}</span><span class="artist">${esc(it.artist)}${it.album ? ', ' + esc(it.album) : ''}</span></span>
            <span class="pick-meta">${have.has((it.title + '|' + it.artist).toLowerCase()) ? 'Déjà là' : esc(fmtDur(it.duration))}</span>
          </button></li>`).join('')}</ul>`;
      }
    }
    search = `
      <div class="field">
        <label for="f-search">Cherche le morceau</label>
        <input id="f-search" class="input" type="search" data-draft="song.search" value="${esc(q)}" placeholder="Titre ou artiste, ex. Seven Nation Army" autocomplete="off">
      </div>
      ${list}
      ${picked.title ? `<div class="picked">${coverTile(picked, 'sm')}<span>Tu peux corriger les infos ci-dessous avant d’ajouter.</span></div>` : ''}`;
  }
  return `
    ${sheetHead(isNew ? 'Nouveau morceau' : 'Modifier le morceau')}
    <div class="form">
      ${search}
      <div class="field"><label for="f-title">Titre</label><input id="f-title" class="input" data-draft="song.title" value="${esc(draft('song.title'))}" autocomplete="off"></div>
      <div class="field"><label for="f-artist">Artiste</label><input id="f-artist" class="input" data-draft="song.artist" value="${esc(draft('song.artist'))}" autocomplete="off"></div>
      <div class="grid-2">
        <div class="field"><label for="f-bpm">Tempo (BPM)</label><input id="f-bpm" class="input" inputmode="numeric" data-draft="song.bpm" value="${esc(draft('song.bpm'))}" placeholder="ex. 120"></div>
        <div class="field"><label for="f-key">Tonalité</label><input id="f-key" class="input" data-draft="song.key" value="${esc(draft('song.key'))}" placeholder="ex. F♯m"></div>
      </div>
      <div class="field"><label for="f-link">Lien d’écoute</label><input id="f-link" class="input" type="url" data-draft="song.link" value="${esc(draft('song.link'))}" placeholder="Rempli tout seul si tu le laisses vide"></div>
      ${formActions(isNew, 'song-save', 'song-cancel', 'song-delete')}
    </div>`;
}

// Recherche de morceaux (suggestions à la saisie), avec un petit délai.
let suggestTimer = 0;
function querySuggest(q) {
  clearTimeout(suggestTimer);
  q = q.trim();
  if (app.mode === 'local' || q.length < 2) { app.suggest = { q: '', items: [] }; return; }
  suggestTimer = setTimeout(async () => {
    try {
      const r = await fetch('/api/search?limit=6&q=' + encodeURIComponent(q), { headers: headers() });
      const j = await r.json();
      if (draft('song.search').trim() !== q) return;
      app.suggest = { q, items: Array.isArray(j.results) ? j.results : [] };
    } catch {
      app.suggest = { q, items: [], error: true };
    }
    if (app.sheet && app.sheet.type === 'song' && app.sheet.edit) renderSheet();
  }, 280);
}

// Va chercher les pochettes (et durées) des morceaux qui n'en ont pas, un par un.
let coverJob = false;
async function fillCovers() {
  if (coverJob || app.mode !== 'online' || !app.view) return;
  coverJob = true;
  try {
    for (let n = 0; n < 40; n++) {
      if (app.mode !== 'online') break;
      const s = Object.values(D('songs')).find((x) => !x.cover && !x.coverTried);
      if (!s) break;
      let best = null;
      try {
        const r = await fetch('/api/search?limit=5&q=' + encodeURIComponent(s.artist + ' ' + s.title), { headers: headers() });
        const j = await r.json();
        const items = Array.isArray(j.results) ? j.results : [];
        const art = (s.artist || '').toLowerCase();
        best = items.find((it) => art && (it.artist || '').toLowerCase().includes(art.split(' ')[0])) || items[0] || null;
      } catch { break; }
      const ops = [{ op: 'set', path: ['songs', s.id, 'coverTried'], value: Date.now() }];
      if (best && safeUrl(best.cover)) ops.push({ op: 'set', path: ['songs', s.id, 'cover'], value: best.cover });
      if (best && best.duration && !s.duration) ops.push({ op: 'set', path: ['songs', s.id, 'duration'], value: best.duration });
      commit(ops);
      await new Promise((res) => setTimeout(res, 350));
    }
  } finally {
    coverJob = false;
  }
}

/* ----- Dates ----- */
function sheetEvent(s) {
  const ev = D('events')[s.id];
  if (!ev) return null;
  const av = availOn(ev.date);
  return `
    ${sheetHead(esc(evTitle(ev)), `${esc(fmtDay.format(parseISO(ev.date)))}${ev.time ? ' à ' + fmtTime(ev.time) : ''}${ev.place ? ', ' + esc(ev.place) : ''}`, esc(relDays(daysUntil(ev.date))))}
    <h3 class="block-title" style="margin-top:4px">Dispos ce jour-là</h3>
    <div class="dispo-row">${dispoChips(ev.date)}</div>
    ${app.me && !av.includes(app.me) && ev.date >= todayISO() ? `<div class="my-dispo"><button class="chip" data-act="toggle-day" data-date="${esc(ev.date)}">Je suis dispo ce jour-là</button></div>` : ''}
    ${ev.notes ? `<h3 class="block-title">Infos</h3><p class="note-text" style="margin:0">${esc(ev.notes)}</p>` : ''}
    <div class="form-actions" style="margin-top:22px"><button class="btn" data-act="event-edit">Modifier</button></div>`;
}

function sheetEventEdit(s) {
  const isNew = !s.id;
  if (!isNew && !D('events')[s.id]) return null;
  const type = draft('ev.type', 'repet');
  const date = draft('ev.date', todayISO());
  const av = availOn(date);
  return `
    ${sheetHead(isNew ? 'Nouvelle date' : 'Modifier la date')}
    <div class="form">
      <div class="seg" role="group" aria-label="Type" style="justify-self:start">
        <button data-act="ev-type" data-v="repet" aria-pressed="${type === 'repet'}">Répète</button>
        <button data-act="ev-type" data-v="concert" aria-pressed="${type === 'concert'}">Concert</button>
      </div>
      <div class="grid-2">
        <div class="field"><label for="e-date">Date</label><input id="e-date" class="input" type="date" data-draft="ev.date" data-rerender value="${esc(date)}"></div>
        <div class="field"><label for="e-time">Heure</label><input id="e-time" class="input" type="time" data-draft="ev.time" value="${esc(draft('ev.time', '20:00'))}"></div>
      </div>
      <div class="dispo-row" style="margin-top:-4px">${dispoChips(date)}</div>
      <div class="field"><label for="e-place">Lieu</label><input id="e-place" class="input" data-draft="ev.place" value="${esc(draft('ev.place', DEFAULT_PLACE))}"></div>
      <div class="field"><label for="e-title">Nom (facultatif)</label><input id="e-title" class="input" data-draft="ev.title" value="${esc(draft('ev.title'))}" placeholder="${type === 'concert' ? 'ex. Fête de la musique' : 'ex. Répète générale'}"></div>
      <div class="field"><label for="e-notes">Infos</label><textarea id="e-notes" class="input" data-draft="ev.notes" placeholder="ex. Ramener les in-ears chargés, balance à 19 h">${esc(draft('ev.notes'))}</textarea></div>
      ${formActions(isNew, 'event-save', 'event-cancel', 'event-delete')}
    </div>`;
}

/* ----- Concert / setlist ----- */
function sheetGig(s) {
  const isNew = !s.id;
  if (!isNew && !D('gigs')[s.id]) return null;
  return `
    ${sheetHead(isNew ? 'Nouvelle setlist' : 'Modifier le concert', isNew ? 'Une setlist par concert, avec son matos à emmener.' : '')}
    <div class="form">
      <div class="field"><label for="g-name">Nom du concert</label><input id="g-name" class="input" data-draft="gig.name" data-enter="gig-save" value="${esc(draft('gig.name'))}" placeholder="ex. Fête de la musique"></div>
      <div class="field"><label for="g-date">Date (facultatif)</label><input id="g-date" class="input" type="date" data-draft="gig.date" value="${esc(draft('gig.date'))}"></div>
      ${formActions(isNew, 'gig-save', 'close-sheet', 'gig-delete', isNew ? 'Créer' : '')}
    </div>`;
}

function sheetPickSongs() {
  const g = D('gigs')[app.gigId];
  if (!g) return null;
  const inGig = new Set(g.songs || []);
  const q = draft('pick.q').trim().toLowerCase();
  const list = songsList().filter((s) => !q || (s.title + ' ' + s.artist).toLowerCase().includes(q));
  return `
    ${sheetHead('Ajouter des morceaux', `${esc(g.name)}, ${plural(inGig.size, 'morceau', 'morceaux')}`)}
    <input class="search block-search" type="search" placeholder="Chercher dans le répertoire" data-draft="pick.q" data-rerender value="${esc(draft('pick.q'))}" aria-label="Chercher dans le répertoire">
    <ul class="pick-list">${list.map((s) => `
      <li><button class="pick-row with-cov" data-act="toggle-gig-song" data-id="${esc(s.id)}" aria-pressed="${inGig.has(s.id)}">
        <span class="check-box">${ICON.check}</span>
        ${coverTile(s, 'sm')}
        <span class="pick-main"><span class="title">${esc(s.title)}</span><span class="artist">${esc(s.artist)}</span></span>
        <span class="pick-meta">${s.bpm || ''}</span>
      </button></li>`).join('') || '<p class="empty-note">Aucun morceau ne correspond.</p>'}
    </ul>
    <div class="sheet-foot"><button class="btn primary block" data-act="close-sheet">Terminé</button></div>`;
}

function sheetTransition(s) {
  const songs = D('songs');
  const a = songs[s.from], b = songs[s.to];
  if (!a || !b || !currentGig()) return null;
  return `
    ${sheetHead('Transition', `${esc(a.title)} puis ${esc(b.title)}`)}
    <div class="tr-pair">${coverTile(a, 'sm')}<span class="tr-arrow">${ICON.next}</span>${coverTile(b, 'sm')}</div>
    <div class="form">
      <div class="field"><label for="t-title">En bref</label><input id="t-title" class="input" data-draft="tr.title" value="${esc(draft('tr.title'))}" placeholder="ex. Enchaînement direct, larsen tenu" maxlength="80"></div>
      <div class="field"><label for="t-text">Comment on la fait</label><textarea id="t-text" class="input" data-draft="tr.text" placeholder="ex. Mathieu garde le charley sur 4 temps, Pierre lance le riff sur le dernier temps">${esc(draft('tr.text'))}</textarea></div>
      ${formActions(!s.exists, 'transition-save', 'close-sheet', 'transition-delete', 'Enregistrer')}
    </div>`;
}

/* ----- Matos ----- */
function ownerOptions(selected) {
  return [...MEMBERS.map((m) => [m.id, m.name]), ['groupe', 'Le groupe']]
    .map(([v, l]) => `<option value="${v}" ${selected === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

function sheetGear(s) {
  const isNew = !s.id;
  if (!isNew && !D('gear')[s.id]) return null;
  return `
    ${sheetHead(isNew ? 'Ajouter du matos' : 'Modifier')}
    <div class="form">
      <div class="field"><label for="m-name">Quoi</label><input id="m-name" class="input" data-draft="gear.name" value="${esc(draft('gear.name'))}" placeholder="ex. Fender Stratocaster, Boss DS-1, câble jack 6 m"></div>
      <div class="grid-2">
        <div class="field"><label for="m-cat">Catégorie</label><select id="m-cat" class="input" data-draft="gear.cat">${GEAR_CATS.map((c) => `<option value="${c.id}" ${draft('gear.cat', 'guitares') === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="m-owner">À qui</label><select id="m-owner" class="input" data-draft="gear.owner">${ownerOptions(draft('gear.owner', app.me || 'achille'))}</select></div>
      </div>
      <div class="field" style="max-width:140px"><label for="m-qty">Quantité</label><input id="m-qty" class="input" type="number" inputmode="numeric" min="1" data-draft="gear.qty" value="${esc(draft('gear.qty', '1'))}"></div>
      <div class="field"><label for="m-details">Détails</label><textarea id="m-details" class="input" data-draft="gear.details" placeholder="Modèle, état, ce qui va avec (housse, alim, adaptateur…)">${esc(draft('gear.details'))}</textarea></div>
      ${formActions(isNew, 'gear-save', 'close-sheet', 'gear-delete')}
    </div>`;
}

function sheetPickGear() {
  const g = D('gigs')[app.gigId];
  if (!g) return null;
  const sel = g.gear || {};
  const n = Object.keys(sel).filter((id) => D('gear')[id]).length;
  return `
    ${sheetHead('Choisir le matos', `${esc(g.name)}, ${plural(n, 'élément choisi', 'éléments choisis')}`)}
    ${gearGrouped(Object.values(D('gear'))).map(({ c, items }) => `
      <h3 class="block-title">${esc(c.label)}</h3>
      <ul class="pick-list">${items.map((x) => `
        <li><button class="pick-row" data-act="toggle-gig-gear" data-id="${esc(x.id)}" aria-pressed="${x.id in sel}">
          <span class="check-box">${ICON.check}</span>
          <span class="pick-main"><span class="title">${esc(x.name)}${qtyTag(x)}</span><span class="artist">${esc(memberName(x.owner))}</span></span>
        </button></li>`).join('')}
      </ul>`).join('')}
    <div class="sheet-foot"><button class="btn primary block" data-act="close-sheet">Terminé</button></div>`;
}

/* ----- Profil ----- */
function sheetProfile() {
  const members = D('members');
  return `
    ${sheetHead(app.me ? esc(memberName(app.me)) : 'Profil', esc(statusText()))}
    ${app.me ? `
      <div class="field">
        <label for="p-role">Ton instrument</label>
        <input id="p-role" class="input" data-draft="me.role" data-enter="save-role" value="${esc(draft('me.role', (members[app.me] || {}).role || ''))}" placeholder="ex. Guitare, chœurs">
      </div>
      <div class="form-actions"><button class="btn primary" data-act="save-role">Enregistrer</button></div>` : ''}
    <h3 class="block-title">Changer de profil</h3>
    <div class="chips">${MEMBERS.map((m) => `<button class="chip" data-act="pick-me" data-id="${m.id}" aria-pressed="${app.me === m.id}">${esc(m.name)}</button>`).join('')}</div>
    ${app.mode === 'local' ? `
      <h3 class="block-title">${PREVIEW ? 'Aperçu' : 'Mode local'}</h3>
      <p class="empty-note" style="margin:0 0 12px">Tout ce que tu changes ici reste sur cet appareil. Tu peux repartir du répertoire de départ quand tu veux.</p>
      <button class="btn danger" data-act="reset-local">Repartir de zéro</button>` : ''}`;
}

/* ----- Écrans d'accueil ----- */
function renderOverlay(wrong) {
  const el = $('#overlay');
  if (app.mode === 'locked') {
    el.hidden = false;
    el.innerHTML = `
      <div class="overlay-inner">
        <h1 class="wordmark">Hysteria</h1>
        <p class="who-q">Code du groupe</p>
        <div class="who-list">
          <input class="input" id="codeInput" type="password" autocomplete="current-password" placeholder="Le code partagé entre vous quatre" data-enter="code-submit">
          <button class="btn primary" data-act="code-submit">Entrer</button>
          ${wrong ? '<p class="err">Ce code ne marche pas.</p>' : ''}
        </div>
      </div>`;
    setTimeout(() => { const i = $('#codeInput'); if (i) i.focus(); }, 50);
    return;
  }
  if (!app.me) {
    el.hidden = false;
    el.innerHTML = `
      <div class="overlay-inner">
        <h1 class="wordmark">Hysteria</h1>
        <p class="who-q">Qui es-tu ?</p>
        <div class="who-list">${MEMBERS.map((m) => `<button data-act="pick-me" data-id="${m.id}">${esc(m.name)}</button>`).join('')}</div>
      </div>`;
    return;
  }
  el.hidden = true;
  el.innerHTML = '';
}

/* ================= Petits outils ================= */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// Confirmation dans la page (les fenêtres confirm() du navigateur ne marchent pas partout).
function askConfirm(text, ok = 'Supprimer') {
  return new Promise((resolve) => {
    const el = $('#confirm');
    el.innerHTML = `<div class="cf-box" role="alertdialog" aria-modal="true" aria-labelledby="cfText">
      <p id="cfText">${esc(text)}</p>
      <div class="cf-actions"><button class="btn ghost" id="cfNo">Annuler</button><button class="btn danger-solid" id="cfYes">${esc(ok)}</button></div>
    </div>`;
    el.hidden = false;
    const done = (v) => { el.hidden = true; el.innerHTML = ''; el.onclick = null; askConfirm.cancel = null; resolve(v); };
    $('#cfNo').onclick = () => done(false);
    $('#cfYes').onclick = () => done(true);
    el.onclick = (e) => { if (e.target === el) done(false); };
    askConfirm.cancel = () => done(false);
    $('#cfYes').focus();
  });
}

function clearDrafts(prefix) {
  Object.keys(app.drafts).forEach((k) => { if (k.startsWith(prefix)) delete app.drafts[k]; });
}
function setGig(id) {
  app.gigId = id;
  LS.set('hy.gig', id);
}

/* ================= Actions ================= */
const actions = {
  'tab'(el) {
    app.tab = el.dataset.tab;
    LS.set('hy.tab', app.tab);
    renderTabs(); renderView();
    window.scrollTo({ top: 0 });
  },
  'rep-sort'(el) { app.repSort = el.dataset.v; renderView(); },

  /* Morceaux */
  'open-song'(el) { openSheet({ type: 'song', id: el.dataset.id }); },
  'add-song'() {
    clearDrafts('song.');
    app.suggest = { q: '', items: [] };
    openSheet({ type: 'song', id: null, edit: true });
    setTimeout(() => { const i = $('#f-search') || $('#f-title'); if (i) i.focus(); }, 60);
  },
  'pick-suggest'(el) {
    const it = app.suggest.items[Number(el.dataset.i)];
    if (!it) return;
    Object.assign(app.drafts, {
      'song.title': it.title, 'song.artist': it.artist, 'song.cover': it.cover || '',
      'song.duration': it.duration ? String(it.duration) : '', 'song.search': '',
    });
    app.suggest = { q: '', items: [] };
    renderSheet();
  },
  'close-sheet'() { closeSheet(); },
  'song-edit'() {
    const s = D('songs')[app.sheet.id];
    clearDrafts('song.');
    Object.assign(app.drafts, { 'song.title': s.title, 'song.artist': s.artist, 'song.bpm': s.bpm ? String(s.bpm) : '', 'song.key': s.key || '', 'song.link': s.link || '', 'song.cover': s.cover || '', 'song.duration': s.duration ? String(s.duration) : '' });
    app.sheet.edit = true;
    renderSheet();
  },
  'song-cancel'() { app.sheet.edit = false; renderSheet(); },
  'song-save'() {
    const title = draft('song.title').trim();
    if (!title) { toast('Il faut au moins un titre'); return; }
    const bpmN = parseInt(draft('song.bpm'), 10);
    const artist = draft('song.artist').trim();
    const fields = {
      title,
      artist,
      key: draft('song.key').trim(),
      bpm: bpmN >= 30 && bpmN <= 300 ? bpmN : null,
      link: draft('song.link').trim() || ytMusic(artist + ' ' + title),
      cover: safeUrl(draft('song.cover')),
      duration: parseInt(draft('song.duration'), 10) || null,
    };
    if (app.sheet.id) {
      const id = app.sheet.id;
      commit(Object.entries(fields).map(([k, v]) => ({ op: 'set', path: ['songs', id, k], value: v })));
      if (metro.playing && metro.songId === id && fields.bpm) { metro.bpm = fields.bpm; renderPlaybar(); }
      app.sheet.edit = false;
      renderSheet();
    } else {
      const id = newId('s');
      commit([{ op: 'set', path: ['songs', id], value: { id, ...fields, levels: {} } }]);
      openSheet({ type: 'song', id });
      toast('Morceau ajouté au répertoire');
    }
    clearDrafts('song.');
  },
  async 'song-delete'() {
    const s = D('songs')[app.sheet.id];
    if (!s || !(await askConfirm(`Supprimer « ${s.title} » du répertoire pour tout le monde ?`))) return;
    if (metro.songId === s.id) metro.stop();
    const ops = [{ op: 'del', path: ['songs', s.id] }];
    Object.values(D('notes')).forEach((n) => { if (n.songId === s.id) ops.push({ op: 'del', path: ['notes', n.id] }); });
    Object.values(D('gigs')).forEach((g) => {
      if ((g.songs || []).includes(s.id)) ops.push({ op: 'set', path: ['gigs', g.id, 'songs'], value: g.songs.filter((x) => x !== s.id) });
    });
    closeSheet();
    commit(ops);
    toast('Morceau supprimé');
  },
  'set-level'(el) {
    if (!app.me) return;
    commit([{ op: 'set', path: ['songs', app.sheet.id, 'levels', app.me], value: Number(el.dataset.v) }]);
  },
  'metro-toggle'() {
    const s = D('songs')[app.sheet.id];
    if (s && s.bpm) metro.toggle(s.id, s.bpm);
  },
  'metro-stop'() { metro.stop(); },
  'note-add'() {
    if (!app.me) return;
    const songId = app.sheet.id;
    const text = draft('note.' + songId).trim();
    if (!text) { toast('Écris la note avant de l’ajouter'); return; }
    const id = newId('n');
    delete app.drafts['note.' + songId];
    commit([{ op: 'set', path: ['notes', id], value: { id, songId, text, by: app.me, ts: Date.now() } }]);
  },
  async 'note-del'(el) {
    const n = D('notes')[el.dataset.id];
    if (!n) return;
    if (n.by !== app.me && !(await askConfirm(`Supprimer la note de ${memberName(n.by)} ?`))) return;
    commit([{ op: 'del', path: ['notes', n.id] }]);
  },

  /* Setlists / concerts */
  'new-gig'() {
    clearDrafts('gig.');
    openSheet({ type: 'gig', id: null });
    setTimeout(() => { const i = $('#g-name'); if (i) i.focus(); }, 60);
  },
  'edit-gig'() {
    const g = currentGig();
    if (!g) return;
    clearDrafts('gig.');
    Object.assign(app.drafts, { 'gig.name': g.name, 'gig.date': g.date || '' });
    openSheet({ type: 'gig', id: g.id });
  },
  'gig-save'() {
    const name = draft('gig.name').trim();
    if (!name) { toast('Donne un nom au concert'); return; }
    const date = draft('gig.date');
    const id = app.sheet.id;
    if (id) {
      commit([{ op: 'set', path: ['gigs', id, 'name'], value: name }, { op: 'set', path: ['gigs', id, 'date'], value: date || '' }]);
    } else {
      const nid = newId('g');
      setGig(nid);
      commit([{ op: 'set', path: ['gigs', nid], value: { id: nid, name, date: date || '', songs: [], gear: {}, by: app.me, ts: Date.now() } }]);
      toast('Setlist créée');
    }
    clearDrafts('gig.');
    closeSheet();
  },
  async 'gig-delete'() {
    const g = D('gigs')[app.sheet.id];
    if (!g || !(await askConfirm(`Supprimer le concert « ${g.name} », sa setlist et sa liste de matos ?`))) return;
    closeSheet();
    setGig(null);
    commit([{ op: 'del', path: ['gigs', g.id] }]);
  },
  'pick-gig'(el) { setGig(el.dataset.id); renderView(); },
  'pick-songs'() { delete app.drafts['pick.q']; openSheet({ type: 'pick-songs' }); },
  'toggle-gig-song'(el) {
    const g = D('gigs')[app.gigId];
    if (!g) return;
    const list = (g.songs || []).slice();
    const i = list.indexOf(el.dataset.id);
    if (i >= 0) list.splice(i, 1); else list.push(el.dataset.id);
    commit([{ op: 'set', path: ['gigs', g.id, 'songs'], value: list }]);
  },
  'edit-transition'(el) {
    const g = currentGig();
    if (!g) return;
    const key = el.dataset.from + '__' + el.dataset.to;
    const t = (g.transitions || {})[key] || {};
    clearDrafts('tr.');
    Object.assign(app.drafts, { 'tr.title': t.title || '', 'tr.text': t.text || '' });
    openSheet({ type: 'transition', from: el.dataset.from, to: el.dataset.to, exists: !!(g.transitions || {})[key] });
    setTimeout(() => { const i = $('#t-title'); if (i && !t.title) i.focus(); }, 60);
  },
  'transition-save'() {
    const g = currentGig();
    if (!g) return;
    const title = draft('tr.title').trim();
    const text = draft('tr.text').trim();
    const key = app.sheet.from + '__' + app.sheet.to;
    if (!title && !text) { toast('Écris au moins quelques mots'); return; }
    commit([{ op: 'set', path: ['gigs', g.id, 'transitions', key], value: { title, text, by: app.me, ts: Date.now() } }]);
    clearDrafts('tr.');
    closeSheet();
  },
  async 'transition-delete'() {
    const g = currentGig();
    if (!g || !(await askConfirm('Supprimer cette transition ?'))) return;
    commit([{ op: 'del', path: ['gigs', g.id, 'transitions', app.sheet.from + '__' + app.sheet.to] }]);
    closeSheet();
  },
  'gig-remove-song'(el) {
    const g = currentGig();
    if (!g) return;
    commit([{ op: 'set', path: ['gigs', g.id, 'songs'], value: (g.songs || []).filter((x) => x !== el.dataset.id) }]);
  },

  /* Planning */
  'cal-nav'(el) {
    const [y, m] = app.calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.v), 1);
    app.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    renderView();
  },
  'toggle-day'(el) {
    if (!app.me) return;
    const iso = el.dataset.date;
    if (iso < todayISO()) return;
    app.calSel = iso;
    const on = availOn(iso).includes(app.me);
    commit([on ? { op: 'del', path: ['avail', iso, app.me] } : { op: 'set', path: ['avail', iso, app.me], value: true }]);
  },
  'select-day'(el) { app.calSel = el.dataset.date; renderView(); },
  'cal-mode'(el) { app.calMode = el.dataset.v; renderView(); },
  'save-avail-note'() {
    const iso = app.calSel;
    if (!app.me || !iso) return;
    const n = draft('avail.' + iso).trim().slice(0, 120);
    delete app.drafts['avail.' + iso];
    commit([{ op: 'set', path: ['avail', iso, app.me], value: n ? { n } : true }]);
    toast(n ? 'Horaires enregistrés' : 'Horaires effacés');
  },
  'plan-date'(el) {
    clearDrafts('ev.');
    app.drafts['ev.date'] = el.dataset.date;
    openSheet({ type: 'event', id: null, edit: true });
  },
  'add-event'() {
    clearDrafts('ev.');
    openSheet({ type: 'event', id: null, edit: true });
  },
  'open-event'(el) { openSheet({ type: 'event', id: el.dataset.id }); },
  'event-edit'() {
    const e = D('events')[app.sheet.id];
    clearDrafts('ev.');
    Object.assign(app.drafts, { 'ev.type': e.type || 'repet', 'ev.title': e.title || '', 'ev.date': e.date, 'ev.time': e.time || '', 'ev.place': e.place || '', 'ev.notes': e.notes || '' });
    app.sheet.edit = true;
    renderSheet();
  },
  'event-cancel'() { app.sheet.edit = false; renderSheet(); },
  'ev-type'(el) { app.drafts['ev.type'] = el.dataset.v; renderSheet(); },
  'event-save'() {
    const date = draft('ev.date', todayISO());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Choisis une date'); return; }
    const fields = {
      type: draft('ev.type', 'repet'),
      title: draft('ev.title').trim(),
      date,
      time: draft('ev.time', '20:00'),
      place: draft('ev.place', DEFAULT_PLACE).trim(),
      notes: draft('ev.notes').trim(),
    };
    if (app.sheet.id) {
      const id = app.sheet.id;
      commit(Object.entries(fields).map(([k, v]) => ({ op: 'set', path: ['events', id, k], value: v })));
      app.sheet.edit = false;
      renderSheet();
    } else {
      const id = newId('e');
      commit([{ op: 'set', path: ['events', id], value: { id, ...fields, by: app.me, ts: Date.now() } }]);
      closeSheet();
      toast(fields.type === 'concert' ? 'Concert calé' : 'Répète calée');
    }
    clearDrafts('ev.');
  },
  async 'event-delete'() {
    const e = D('events')[app.sheet.id];
    if (!e || !(await askConfirm('Supprimer cette date pour tout le monde ?'))) return;
    closeSheet();
    commit([{ op: 'del', path: ['events', e.id] }]);
  },
  'toggle-past'() { app.showPast = !app.showPast; renderView(); },

  /* Matos */
  'matos-view'(el) { app.matosView = el.dataset.v; LS.set('hy.matosView', app.matosView); renderView(); },
  'go-inventory'() { app.matosView = 'inventaire'; LS.set('hy.matosView', 'inventaire'); renderView(); },
  'gear-owner'(el) { app.gearOwner = el.dataset.v; renderView(); },
  'new-gear'() {
    const keep = { cat: app.drafts['gear.cat'], owner: app.drafts['gear.owner'] };
    clearDrafts('gear.');
    if (keep.cat) app.drafts['gear.cat'] = keep.cat;
    if (keep.owner) app.drafts['gear.owner'] = keep.owner;
    openSheet({ type: 'gear', id: null });
    setTimeout(() => { const i = $('#m-name'); if (i) i.focus(); }, 60);
  },
  'edit-gear'(el) {
    const x = D('gear')[el.dataset.id];
    if (!x) return;
    clearDrafts('gear.');
    Object.assign(app.drafts, { 'gear.name': x.name, 'gear.cat': x.cat || 'autre', 'gear.owner': x.owner || 'groupe', 'gear.qty': String(x.qty || 1), 'gear.details': x.details || '' });
    openSheet({ type: 'gear', id: x.id });
  },
  'gear-save'() {
    const name = draft('gear.name').trim();
    if (!name) { toast('Écris ce que c’est'); return; }
    const qty = Math.max(1, parseInt(draft('gear.qty', '1'), 10) || 1);
    const fields = { name, cat: draft('gear.cat', 'guitares'), owner: draft('gear.owner', app.me || 'achille'), qty, details: draft('gear.details').trim() };
    if (app.sheet.id) {
      const id = app.sheet.id;
      commit(Object.entries(fields).map(([k, v]) => ({ op: 'set', path: ['gear', id, k], value: v })));
      closeSheet();
    } else {
      const id = newId('m');
      commit([{ op: 'set', path: ['gear', id], value: { id, ...fields, ts: Date.now() } }]);
      // On garde la catégorie et le propriétaire pour enchaîner les ajouts.
      app.drafts = { ...app.drafts, 'gear.name': '', 'gear.qty': '1', 'gear.details': '' };
      renderSheet();
      setTimeout(() => { const i = $('#m-name'); if (i) i.focus(); }, 30);
      toast(`${name} ajouté`);
      return;
    }
    clearDrafts('gear.');
  },
  async 'gear-delete'() {
    const x = D('gear')[app.sheet.id];
    if (!x || !(await askConfirm(`Supprimer « ${x.name} » de l’inventaire ?`))) return;
    const ops = [{ op: 'del', path: ['gear', x.id] }];
    Object.values(D('gigs')).forEach((g) => { if (g.gear && x.id in g.gear) ops.push({ op: 'del', path: ['gigs', g.id, 'gear', x.id] }); });
    closeSheet();
    commit(ops);
  },
  'pick-gear'() { openSheet({ type: 'pick-gear' }); },
  'toggle-gig-gear'(el) {
    const g = D('gigs')[app.gigId];
    if (!g) return;
    const id = el.dataset.id;
    commit([id in (g.gear || {}) ? { op: 'del', path: ['gigs', g.id, 'gear', id] } : { op: 'set', path: ['gigs', g.id, 'gear', id], value: false }]);
  },
  'gig-check'(el) {
    const g = currentGig();
    if (!g) return;
    const id = el.dataset.id;
    commit([{ op: 'set', path: ['gigs', g.id, 'gear', id], value: !(g.gear || {})[id] }]);
  },
  'gig-uncheck-all'() {
    const g = currentGig();
    if (!g) return;
    commit(Object.keys(g.gear || {}).filter((id) => g.gear[id]).map((id) => ({ op: 'set', path: ['gigs', g.id, 'gear', id], value: false })));
  },

  /* Profil */
  'open-profile'() { delete app.drafts['me.role']; openSheet({ type: 'profile' }); },
  'pick-me'(el) {
    app.me = el.dataset.id;
    LS.set('hy.me', app.me);
    delete app.drafts['me.role'];
    renderAll();
  },
  'save-role'() {
    if (!app.me) return;
    commit([{ op: 'set', path: ['members', app.me], value: { ...(D('members')[app.me] || {}), role: draft('me.role').trim() } }]);
    toast('Enregistré');
  },
  async 'reset-local'() {
    if (!(await askConfirm('Effacer tes essais et revenir au répertoire de départ ?', 'Repartir de zéro'))) return;
    app.base = seedState();
    app.view = clone(app.base);
    app.drafts = {};
    setGig(null);
    persist();
    closeSheet();
    renderAll();
    toast('C’est reparti de zéro');
  },
  'code-submit'() {
    const i = $('#codeInput');
    const v = i ? i.value.trim() : '';
    if (!v) return;
    app.code = v;
    LS.set('hy.code', v);
    app.mode = 'boot';
    renderOverlay();
    pull().then(() => { if (app.mode !== 'locked') { renderAll(); push(); } });
  },
};

/* ================= Glisser-déposer de la setlist ================= */
const drag = { active: false };

function dragStart(e) {
  const handle = e.target.closest('[data-drag-handle]');
  if (!handle || drag.active) return;
  const row = handle.closest('.sl-row');
  const list = row && row.parentElement;
  if (!list) return;
  e.preventDefault();
  const rows = [...list.querySelectorAll(':scope > .sl-row')];
  // Les transitions se replient pendant le glisser : on mesure après, et on garde la ligne sous le doigt.
  const before = row.getBoundingClientRect().top;
  list.classList.add('is-dragging');
  const rects = rows.map((r) => r.getBoundingClientRect());
  const from = rows.indexOf(row);
  Object.assign(drag, {
    active: true, row, list, rows, from, to: from, rects,
    startY: e.clientY - (before - rects[from].top), y: e.clientY, scroll0: window.scrollY, pointerId: e.pointerId,
  });
  drag.h = rects[from].height;
  app.dragging = true;
  row.classList.add('dragging');
  try { handle.setPointerCapture(e.pointerId); } catch {}
  if (navigator.vibrate) { try { navigator.vibrate(10); } catch {} }
  requestAnimationFrame(dragFrame);
}

function dragFrame() {
  if (!drag.active) return;
  const vh = window.innerHeight;
  const bottomEdge = vh - 140;
  if (drag.y < 90) window.scrollBy(0, -Math.ceil((90 - drag.y) / 5));
  else if (drag.y > bottomEdge) window.scrollBy(0, Math.ceil((drag.y - bottomEdge) / 5));
  const dy = drag.y - drag.startY + (window.scrollY - drag.scroll0);
  drag.row.style.transform = `translateY(${dy}px)`;
  const center = drag.rects[drag.from].top + drag.h / 2 + dy;
  let to = 0;
  drag.rects.forEach((r, i) => { if (i !== drag.from && center > r.top + r.height / 2) to++; });
  drag.to = to;
  drag.rows.forEach((r, i) => {
    if (i === drag.from) return;
    let s = 0;
    if (drag.from < to && i > drag.from && i <= to) s = -drag.h;
    else if (to < drag.from && i >= to && i < drag.from) s = drag.h;
    r.style.transform = s ? `translateY(${s}px)` : '';
  });
  requestAnimationFrame(dragFrame);
}

function dragEnd() {
  if (!drag.active) return;
  drag.active = false;
  const ids = drag.rows.map((r) => r.dataset.id);
  const [moved] = ids.splice(drag.from, 1);
  ids.splice(drag.to, 0, moved);
  drag.rows.forEach((r) => { r.style.transform = ''; });
  drag.row.classList.remove('dragging');
  drag.list.classList.remove('is-dragging');
  app.dragging = false;
  drag.justEnded = Date.now();
  const g = currentGig();
  if (g && drag.from !== drag.to) {
    // On garde les morceaux masqués (supprimés du répertoire entre-temps) en fin de liste.
    const rest = (g.songs || []).filter((id) => !ids.includes(id));
    commit([{ op: 'set', path: ['gigs', g.id, 'songs'], value: [...ids, ...rest] }]);
  } else if (app.needRender) {
    renderView();
  }
  app.needRender = false;
}

document.addEventListener('pointerdown', dragStart);
document.addEventListener('pointermove', (e) => { if (drag.active) { drag.y = e.clientY; e.preventDefault(); } }, { passive: false });
document.addEventListener('pointerup', dragEnd);
document.addEventListener('pointercancel', dragEnd);

/* ================= Écouteurs ================= */
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-drag-handle]')) return;
  if (drag.justEnded && Date.now() - drag.justEnded < 350) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn || el.tagName === 'A') return;
  e.preventDefault();
  fn(el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#confirm').hidden && askConfirm.cancel) { askConfirm.cancel(); return; }
    if (app.sheet) { closeSheet(); return; }
  }
  const t = e.target;
  if (e.key === 'Enter' && t.dataset && t.dataset.enter && !e.shiftKey) {
    e.preventDefault();
    const fn = actions[t.dataset.enter];
    if (fn) fn(t, e);
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && t.matches && t.matches('[role="button"][data-act]')) {
    e.preventDefault();
    const fn = actions[t.dataset.act];
    if (fn) fn(t, e);
  }
});

function onField(e) {
  const t = e.target;
  if (!t.dataset) return;
  if (t.dataset.draft) app.drafts[t.dataset.draft] = t.value;
  if (t.dataset.draft === 'song.search' && e.type === 'input') { querySuggest(t.value); renderSheet(); return; }
  if (t.dataset.bind === 'query') { app.query = t.value; renderView(); }
  if (t.dataset.rerender !== undefined) renderSheet();
}
document.addEventListener('input', onField);
// Une pochette qui ne charge pas laisse place aux initiales.
document.addEventListener('error', (e) => { if (e.target && e.target.classList && e.target.classList.contains('cov-img')) e.target.remove(); }, true);
document.addEventListener('change', onField);

/* ================= Démarrage ================= */
if (PREVIEW) $('#previewBanner').hidden = false;
renderAll();
if (PREVIEW || location.protocol === 'file:') goLocal();
else {
  pull().then(() => { if (app.pending.length) push(); });
  setInterval(() => { if (document.visibilityState === 'visible') { pull(); renderNextLine(); } }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  window.addEventListener('online', () => { push(); pull(); });
}
