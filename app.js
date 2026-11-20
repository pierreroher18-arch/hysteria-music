import { MEMBERS, LEVELS, GEAR_CATS, DEFAULT_PLACE, TUNINGS, ROOTS, seedState, newId, applyOps, ytMusic } from './shared.mjs';

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
// « 3:47 », « 3'47 », « 3.47 » ou « 227 » (secondes) → secondes.
function parseDur(t) {
  const v = String(t || '').trim();
  const m = v.match(/^(\d{1,2})\s*[:'’.,hm]\s*(\d{1,2})\s*s?$/);
  if (m) return Number(m[1]) * 60 + Math.min(59, Number(m[2]));
  if (/^\d+$/.test(v)) { const n = Number(v); return n < 20 ? n * 60 : n; }
  return 0;
}
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

// Couleur de fond de la fiche : celle tirée de la pochette, sinon la teinte de la vignette.
const isTone = (t) => /^#[0-9a-f]{6}$/i.test(t || '');
const toneOf = (s) => (isTone(s.tone) ? s.tone : COVER_TONES[hashStr(s.title) % COVER_TONES.length]);
function inkFor(hex) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.3 ? '#1d2119' : '#f4f5ee';
}
// Accordage et capo : on n'affiche que ce qui change du standard.
const tuningOf = (s) => (s && s.tuning && s.tuning !== 'Standard' ? s.tuning : '');
const tuneBits = (s) => [tuningOf(s), s.capo > 0 ? `capo ${s.capo}` : ''].filter(Boolean);
// Liens vers les accords, tablatures et paroles, pour chaque morceau (y compris ceux ajoutés plus tard).
const songsterrUrl = (s) => `https://www.songsterr.com/a/wa/bestMatchForQueryString?s=${encodeURIComponent(s.title || '')}&a=${encodeURIComponent(s.artist || '')}`;

// Paroles cherchées à la demande (LRCLIB, via /api/lyrics). Gardées en mémoire le temps de la session.
const lyricsKey = (s) => `${s.title}|${s.artist}`;
function loadLyrics(s, retry) {
  if (!s || app.mode === 'local') return;
  const k = lyricsKey(s);
  if (app.lyrics[k] && !retry) return;
  app.lyrics[k] = { state: 'loading' };
  const q = new URLSearchParams({ title: s.title || '', artist: s.artist || '' });
  if (s.duration) q.set('duration', String(s.duration));
  fetch('/api/lyrics?' + q.toString(), { headers: headers() })
    .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
    .then(({ ok, j }) => {
      if (j && j.found) app.lyrics[k] = { state: 'ok', text: j.lyrics || '', synced: j.synced || '', instrumental: !!j.instrumental };
      else app.lyrics[k] = { state: ok ? 'none' : 'error' };
    })
    .catch(() => { app.lyrics[k] = { state: 'error' }; })
    .finally(() => { renderSheet(); renderStage(); });
}
// Accords + paroles (version « Chords » la mieux notée d'Ultimate Guitar, via /api/chords).
function loadSheet(s, retry) {
  if (!s || app.mode === 'local') return;
  const k = lyricsKey(s);
  if (app.sheets[k] && !retry) return;
  app.sheets[k] = { state: 'loading' };
  fetch('/api/chords?' + new URLSearchParams({ title: s.title || '', artist: s.artist || '' }).toString(), { headers: headers() })
    .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
    .then(({ ok, j }) => { app.sheets[k] = j && j.found && j.content ? { state: 'ok', ...j } : { state: ok ? 'none' : 'error' }; })
    .catch(() => { app.sheets[k] = { state: 'error' }; })
    .finally(() => { renderSheet(); renderStage(); });
}
const NOTE_V = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function shiftNote(root, acc, n, flat) {
  const v = NOTE_V[root] + (acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0) + n;
  return (flat ? FLATS : SHARPS)[((v % 12) + 12) % 12];
}
function transposeChord(ch, n) {
  if (!n) return ch;
  const flat = /^[A-G](b|♭)/.test(ch);
  return ch.replace(/^([A-G])([#b♯♭]?)/, (_, r, a) => shiftNote(r, a, n, flat))
    .replace(/\/([A-G])([#b♯♭]?)/, (_, r, a) => '/' + shiftNote(r, a, n, flat));
}
const SECTION_FR = [['pre-chorus', 'Pré-refrain'], ['pre chorus', 'Pré-refrain'], ['post-chorus', 'Post-refrain'], ['chorus', 'Refrain'], ['verse', 'Couplet'], ['bridge', 'Pont'], ['intro', 'Intro'], ['outro', 'Outro'], ['solo', 'Solo'], ['interlude', 'Interlude'], ['instrumental', 'Instrumental'], ['riff', 'Riff'], ['hook', 'Refrain'], ['ending', 'Fin'], ['coda', 'Coda'], ['break', 'Break']];
function frSection(label) {
  const low = label.toLowerCase();
  const hit = SECTION_FR.find(([en]) => low.startsWith(en));
  return hit ? hit[1] + label.slice(hit[0].length) : label;
}
const shiftLabel = (s) => { const n = Number(s.shift) || 0; return n ? (n > 0 ? '+' : '−') + Math.abs(n) : 'Originale'; };

/* ----- Nos accords, posés à la main au-dessus des mots ----- */
// Format texte : « [Am]Today is [G]gonna be » ; une ligne « # Refrain » est un titre de partie.
// Les accords sont enregistrés dans la tonalité d'origine et affichés selon la tona jouée.
function cpParse(text) {
  return String(text || '').replace(/\r/g, '').split('\n').map((raw) => {
    const sec = raw.match(/^\s*#\s*(.+)$/);
    if (sec) return { sec: sec[1].trim() };
    const chunks = [];
    let pending = '';
    raw.split(/(\[[^\]\n]{1,16}\])/).forEach((part) => {
      const m = part.match(/^\[([^\]]+)\]$/);
      if (m) { if (pending) chunks.push({ ch: pending, tx: '' }); pending = m[1].trim(); return; }
      (part.match(/\S+\s*|\s+/g) || []).forEach((w) => {
        if (/^\s+$/.test(w) && chunks.length && !pending) { chunks[chunks.length - 1].tx += w; return; }
        chunks.push({ ch: pending, tx: w });
        pending = '';
      });
    });
    if (pending) chunks.push({ ch: pending, tx: '' });
    return { chunks };
  });
}
const cpSerialize = (lines) => lines.map((l) => (l.sec != null ? '# ' + l.sec : l.chunks.map((c) => (c.ch ? `[${c.ch}]` : '') + c.tx).join('').replace(/\s+$/, ''))).join('\n');
const cpShift = (lines, n) => lines.map((l) => (l.sec != null ? l : { chunks: l.chunks.map((c) => ({ ...c, ch: c.ch ? transposeChord(c.ch, n) : '' })) }));
const lineText = (l) => (l && l.chunks ? l.chunks.map((c) => c.tx).join('').trim() : '');
const normTxt = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
// Ligne de tablature (« e|---3---| ») : affichée telle quelle, en chasse fixe.
const isTabLine = (t) => /^[A-Ga-g]?[#b]?\s?\|.*-{3,}/.test(t) || (/-{4,}/.test(t) && /^[-\d|hpbrx\/\\~()\s.^*]+$/.test(t));
// Une ligne : chaque mot avec son accord au-dessus.
function cpLine(l, li, shift, o = {}) {
  if (!l.chunks.length) return '<div class="cp-gap"></div>';
  const has = l.chunks.some((c) => c.ch);
  if (!has && isTabLine(lineText(l))) return `<pre class="cp-tab" data-li="${li}">${esc(l.chunks.map((c) => c.tx).join(''))}</pre>`;
  const onlyCh = l.chunks.every((c) => !c.tx.trim());
  const cells = l.chunks.map((c, ci) => {
    const name = c.ch ? transposeChord(c.ch, shift) : '';
    const ch = name && o.pop ? `<button class="ch" data-act="chord-pop" data-v="${esc(name)}">${esc(name)}</button>` : `<b class="ch">${name ? esc(name) : ' '}</b>`;
    const inner = `${ch}<span class="tx">${esc(c.tx) || ' '}</span>`;
    if (!o.edit) return `<span class="cw">${inner}</span>`;
    return `<button class="cw${o.sel === li + ':' + ci ? ' sel' : ''}" data-act="cp-pick" data-l="${li}" data-c="${ci}">${inner}</button>`;
  }).join('');
  const mark = o.marking ? ` data-act="mark-add" data-li="${li}" title="Ajouter un repère"` : '';
  return `<div class="cp-line${has ? '' : ' plain'}${onlyCh ? ' only' : ''}${o.marking ? ' markable' : ''}" data-li="${li}"${mark}>${cells}</div>`;
}
function cpHtml(lines, shift, opts = {}) {
  return `<div class="cp${opts.stage ? ' on-stage' : ''}${opts.edit ? ' edit' : ''}">${lines.map((l, li) => (l.sec != null ? `<div class="cp-sec"><span class="sec-chip">${esc(frSection(l.sec))}</span></div>` : cpLine(l, li, shift, opts))).join('')}</div>`;
}
// Grille Ultimate Guitar (accords sur une ligne, paroles en dessous) vers notre format.
const isChLine = (l) => /\[ch\]/.test(l) && !l.replace(/\[ch\][^\[]*\[\/ch\]/g, '').replace(/[\s|\-x×\d()\/.:]/g, '').length;
function ugToCP(content) {
  const src = content.replace(/\[\/?tab\]/g, '').split('\n');
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const L = src[i];
    const sec = L.trim().match(/^\[([^\[\]]+)\]$/);
    if (sec) { out.push('# ' + frSection(sec[1])); continue; }
    if (isChLine(L)) {
      const chords = [];
      let plain = '';
      L.split(/(\[ch\][^\[]*\[\/ch\])/).forEach((p) => {
        const m = p.match(/^\[ch\](.*)\[\/ch\]$/);
        if (m) { chords.push({ pos: plain.length, ch: m[1].trim() }); plain += m[1]; } else plain += p;
      });
      const next = src[i + 1];
      if (next != null && next.trim() && !isChLine(next) && !/^\[[^\[\]]+\]$/.test(next.trim())) {
        let lyr = next.replace(/\[\/?ch\]/g, '');
        // Un accord tombé au milieu d'un mot est posé au début de ce mot (sauf s'il y en a déjà un).
        const used = new Set();
        chords.forEach((c) => {
          let p = c.pos;
          if (p < lyr.length && /\S/.test(lyr[p])) { while (p > 0 && /\S/.test(lyr[p - 1])) p--; }
          if (used.has(p)) p = c.pos;
          used.add(p);
          c.at = p;
        });
        chords.slice().sort((a, b) => b.at - a.at).forEach((c) => {
          if (c.at > lyr.length) lyr = lyr.padEnd(c.at);
          lyr = lyr.slice(0, c.at) + `[${c.ch}]` + lyr.slice(c.at);
        });
        out.push(lyr.replace(/\s+$/, ''));
        i++;
      } else out.push(chords.map((c) => `[${c.ch}]`).join(' '));
      continue;
    }
    out.push(L.replace(/\[\/?ch\]/g, '').replace(/\s+$/, ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const CP_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const CP_QUALS = [['', 'majeur'], ['m', 'm'], ['7', '7'], ['m7', 'm7'], ['maj7', 'maj7'], ['sus2', 'sus2'], ['sus4', 'sus4'], ['add9', 'add9'], ['5', '5'], ['6', '6'], ['9', '9'], ['dim', 'dim']];

/* ----- Parties du morceau (Intro, Couplet, Refrain…) et leurs couleurs ----- */
const SEC_COLORS = { ardoise: 'Ardoise', bleu: 'Bleu', violet: 'Violet', rose: 'Rose', ambre: 'Ambre', vert: 'Vert', sarcelle: 'Sarcelle', sable: 'Sable' };
const SEC_TYPES = [
  ['pre-refrain', 'Pré-refrain', 'violet'], ['post-refrain', 'Post-refrain', 'violet'], ['refrain', 'Refrain', 'rose'], ['couplet', 'Couplet', 'bleu'],
  ['intro', 'Intro', 'ardoise'], ['outro', 'Outro', 'ardoise'], ['pont', 'Pont', 'ambre'], ['solo', 'Solo', 'vert'], ['riff', 'Riff', 'vert'],
  ['interlude', 'Interlude', 'sarcelle'], ['instrumental', 'Instrumental', 'sarcelle'], ['break', 'Break', 'ambre'], ['fin', 'Fin', 'ardoise'], ['coda', 'Coda', 'ardoise'],
];
const SEC_ADD = ['Intro', 'Couplet', 'Pré-refrain', 'Refrain', 'Pont', 'Solo', 'Riff', 'Interlude', 'Break', 'Outro'];
function secType(label) {
  const n = frSection(String(label || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z-]+/g, ' ').replace(/\bpre refrain/, 'pre-refrain').replace(/\bpost refrain/, 'post-refrain').trim();
  const t = SEC_TYPES.find(([k]) => n.startsWith(k));
  return t ? t[0] : (n.split(' ')[0] || 'partie').slice(0, 30);
}
function secColor(song, label) {
  const k = secType(label);
  const c = ((song && song.secColors) || {})[k];
  if (SEC_COLORS[c]) return c;
  const t = SEC_TYPES.find(([key]) => key === k);
  return t ? t[2] : 'sable';
}
// Découpe en parties : { label, head (ligne-titre, -1 si le début n'a pas de titre), start, end }.
function cpParts(lines) {
  const parts = [];
  lines.forEach((l, i) => {
    if (l.sec != null) { parts.push({ label: l.sec, head: i, start: i + 1, end: i + 1 }); return; }
    let cur = parts[parts.length - 1];
    if (!cur) { cur = { label: '', head: -1, start: i, end: i }; parts.push(cur); }
    cur.end = i + 1;
  });
  return parts.filter((p) => p.head >= 0 || lines.slice(p.start, p.end).some((l) => l.chunks && l.chunks.length));
}

/* ----- Grille de mesures : les accords de chaque ligne, sans les paroles ----- */
function gridHtml(lines, shift) {
  const rows = [];
  lines.forEach((l) => {
    if (!l.chunks) return;
    const chs = l.chunks.map((c) => c.ch).filter(Boolean).map((c) => transposeChord(c, shift));
    if (!chs.length) return;
    const key = chs.join(' ');
    const last = rows[rows.length - 1];
    if (last && last.key === key) last.n++; else rows.push({ key, chs, n: 1 });
  });
  if (!rows.length) return '<p class="gr-empty">Pas d’accords notés</p>';
  return rows.map((r) => `<div class="gr-row">${r.chs.map((c, i) => `<span class="gr-cell${i === r.chs.length - 1 ? ' end' : ''}">${esc(c)}</span>`).join('')}${r.n > 1 ? `<span class="gr-x">×${r.n}</span>` : ''}</div>`).join('');
}

/* ----- Repères notés par le groupe sur une ligne (« break ici », « on coupe 2 temps ») ----- */
function marksMap(song, lines) {
  const out = {};
  const ok = (i) => lines[i] && lines[i].chunks && lines[i].chunks.length;
  Object.entries(song.marks || {}).forEach(([id, m]) => {
    if (!m || !m.text) return;
    let at = Number(m.at) || 0;
    const same = (i) => ok(i) && normTxt(lineText(lines[i])) === m.snap;
    if (!same(at)) {
      const f = lines.findIndex((l, i) => same(i));
      if (f >= 0) at = f;
      else {
        at = Math.min(Math.max(0, at), lines.length - 1);
        while (at < lines.length - 1 && !ok(at)) at++;
      }
    }
    (out[at] = out[at] || []).push({ id, ...m });
  });
  Object.values(out).forEach((l) => l.sort((a, b) => (a.ts || 0) - (b.ts || 0)));
  return out;
}
function marksHtml(list, o, li) {
  const form = !o.stage && app.markEdit && app.markEdit.li === li && app.sheet && app.sheet.id === o.song.id;
  if (!list && !form) return '';
  const tag = (m) => {
    const inner = `<b>${esc(memberName(m.by) || '')}</b>${esc(m.text)}`;
    return o.marking ? `<button class="cp-mark" data-act="mark-edit" data-id="${esc(m.id)}" data-li="${li}">${inner}</button>` : `<span class="cp-mark">${inner}</span>`;
  };
  return `${list ? `<div class="cp-marks">${list.map(tag).join('')}</div>` : ''}${form ? `
    <div class="mk-form">
      <input class="input" id="mkText" data-draft="mk.text" data-enter="mark-save" maxlength="80" placeholder="Ex. break ici, on coupe 2 temps" value="${esc(draft('mk.text'))}" aria-label="Repère">
      <button class="btn small primary" data-act="mark-save">OK</button>
      ${app.markEdit.id ? '<button class="btn small ghost danger" data-act="mark-del">Supprimer</button>' : ''}
      <button class="btn small ghost" data-act="mark-cancel">Annuler</button>
    </div>` : ''}`;
}

// Les parties, chacune avec sa couleur. o : { stage, edit, sel, view, pop, marking, song }.
function partsHtml(song, lines, shift, o) {
  const marks = o.edit ? {} : marksMap(song, lines);
  return cpParts(lines).map((p, n) => {
    const col = p.head >= 0 ? secColor(song, p.label) : '';
    const name = p.head >= 0 ? frSection(p.label) : (o.edit ? 'Début' : '');
    const tools = o.edit ? `<button class="link-btn pt-btn" data-act="part-text" data-i="${n}">${ICON.edit}Paroles</button>` : '';
    const head = name ? `<div class="cp-sec"><span class="sec-chip">${esc(name)}</span>${tools}</div>` : '';
    const range = lines.slice(p.start, p.end);
    let body;
    if (o.edit && app.cpEdit.part === n) {
      body = `<div class="pt-edit">
        <textarea class="input chart-input pt-text" id="cpPart" data-draft="cp.part" spellcheck="false" rows="${Math.min(14, Math.max(3, draft('cp.part').split('\n').length + 1))}" placeholder="[Am]Les paroles avec [G]leurs accords">${esc(draft('cp.part'))}</textarea>
        <div class="pt-actions"><span class="hint"><code>[Am]mot</code> pour un accord</span><button class="btn small ghost" data-act="part-text-cancel">Annuler</button><button class="btn small primary" data-act="part-text-ok">OK</button></div>
      </div>`;
    } else if (o.view === 'grid') {
      const here = Object.entries(marks).filter(([li]) => li >= p.start && li < p.end).flatMap(([, l]) => l);
      body = gridHtml(range, shift) + (here.length ? marksHtml(here, { ...o, marking: false }, -1) : '');
    } else {
      body = range.map((l, k) => cpLine(l, p.start + k, shift, o) + marksHtml(marks[p.start + k], o, p.start + k)).join('');
    }
    return `<section class="cp-part${col ? ' c' : ''}" data-part="${n}"${col ? ` style="--sc: var(--sc-${col})"` : ''}>${head}${body}</section>`;
  }).join('');
}
// Frise : les parties dans l'ordre, en couleur. Toucher une partie y emmène.
function friseHtml(song, lines) {
  const parts = cpParts(lines).map((p, n) => ({ ...p, n })).filter((p) => p.head >= 0);
  if (parts.length < 2) return '';
  return `<nav class="frise" aria-label="Structure du morceau">${parts.map((p) => `<button class="fr-b" data-act="part-jump" data-i="${p.n}" style="--sc: var(--sc-${secColor(song, p.label)})">${esc(frSection(p.label))}</button>`).join('')}</nav>`;
}

/* ----- Diagrammes d'accords (guitare) ----- */
const CHORD_OPEN = {
  C: 'x32010', Cmaj7: 'x32000', C7: 'x32310', Cadd9: 'x32030', Csus2: 'x30013', Csus4: 'x33011',
  D: 'xx0232', Dm: 'xx0231', D7: 'xx0212', Dm7: 'xx0211', Dmaj7: 'xx0222', Dsus2: 'xx0230', Dsus4: 'xx0233',
  E: '022100', Em: '022000', E7: '020100', Em7: '022030', Emaj7: '021100', Esus4: '022200', E5: '022xxx',
  F: '133211', Fmaj7: 'xx3210',
  G: '320003', G7: '320001', Gmaj7: '320002', Gsus4: '330013',
  A: 'x02220', Am: 'x02210', A7: 'x02020', Am7: 'x02010', Amaj7: 'x02120', Asus2: 'x02200', Asus4: 'x02230', A7sus4: 'x02030', A5: 'x022xx',
  B7: 'x21202',
};
// Formes mobiles : fondamentale sur la corde de mi grave (E) ou de la (A). null = corde muette.
const SHAPE_E = { '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], maj7: [0, null, 1, 1, 0, null], sus4: [0, 2, 2, 2, 0, 0], 5: [0, 2, 2, null, null, null], 9: [0, null, 0, 1, 0, 2], '7sus4': [0, 2, 0, 2, 0, 0] };
const SHAPE_A = { '': [null, 0, 2, 2, 2, 0], m: [null, 0, 2, 2, 1, 0], 7: [null, 0, 2, 0, 2, 0], m7: [null, 0, 2, 0, 1, 0], maj7: [null, 0, 2, 1, 2, 0], sus2: [null, 0, 2, 2, 0, 0], sus4: [null, 0, 2, 2, 3, 0], 5: [null, 0, 2, 2, null, null], 6: [null, 0, 2, 2, 2, 2], m6: [null, 0, 2, 2, 1, 2], add9: [null, 0, 2, 4, 2, 0], 9: [null, 0, -1, 0, 0, 0], dim: [null, 0, 1, 2, 1, null], m7b5: [null, 0, 1, 0, 1, null], '7sus4': [null, 0, 2, 0, 3, 0], aug: [null, 0, 3, 2, 2, 1] };
const QUAL_ALIAS = { min: 'm', mi: 'm', '-': 'm', M: '', maj: '', M7: 'maj7', Maj7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', '7M': 'maj7', min7: 'm7', mi7: 'm7', '-7': 'm7', sus: 'sus4', 4: 'sus4', 2: 'sus2', add2: 'add9', 'ø': 'm7b5', 'ø7': 'm7b5', 'm7-5': 'm7b5', o: 'dim', '°': 'dim', dim7: 'dim', '+': 'aug', sus7: '7sus4', '7(4)': '7sus4', '7sus': '7sus4' };
function chordShape(name) {
  const m = String(name || '').match(/^([A-G])([#b♯♭]?)([^/]*)/);
  if (!m) return null;
  const v = (NOTE_V[m[1]] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0) + 12) % 12;
  let q = m[3].trim();
  if (q in QUAL_ALIAS) q = QUAL_ALIAS[q];
  const root = SHARPS[v];
  const simple = (x) => (/^m(?!aj)/.test(x) ? (x.includes('7') ? 'm7' : 'm') : x.includes('maj7') ? 'maj7' : x.includes('7') ? '7' : '');
  const tryQ = [q, simple(q)];
  for (const qq of tryQ) {
    const open = CHORD_OPEN[root + qq];
    if (open) return { frets: [...open].map((c) => (c === 'x' ? -1 : Number(c))), simplified: qq !== q };
    const cands = [[SHAPE_E[qq], (v - 4 + 12) % 12], [SHAPE_A[qq], (v - 9 + 12) % 12]]
      .filter(([sh, r]) => sh && sh.every((o) => o == null || r + o >= 0))
      .map(([sh, r]) => sh.map((o) => (o == null ? -1 : r + o)))
      .sort((a, b) => Math.max(...a) - Math.max(...b));
    if (cands.length) return { frets: cands[0], simplified: qq !== q };
  }
  return null;
}
function chordSvg(name) {
  const sh = chordShape(name);
  if (!sh) return '<svg viewBox="0 0 64 80" aria-hidden="true"><text x="32" y="46" text-anchor="middle" font-size="11" fill="currentColor">?</text></svg>';
  const f = sh.frets;
  const pressed = f.filter((x) => x > 0);
  const hi = pressed.length ? Math.max(...pressed) : 0;
  const lo = pressed.length ? Math.min(...pressed) : 0;
  const base = hi > 5 ? lo : 1;
  const X = (i) => 7 + i * 10, Y = (fr) => 18 + (fr - base + 0.5) * 12;
  let s = `<svg viewBox="-9 0 73 82" aria-label="Diagramme ${esc(name)}" role="img">`;
  for (let i = 0; i < 6; i++) s += `<line x1="${X(i)}" y1="18" x2="${X(i)}" y2="78" stroke="currentColor" stroke-width="1"/>`;
  for (let k = 0; k <= 5; k++) s += `<line x1="7" y1="${18 + k * 12}" x2="57" y2="${18 + k * 12}" stroke="currentColor" stroke-width="${k === 0 && base === 1 ? 3 : 1}"/>`;
  if (base > 1) s += `<text x="-8" y="${Y(base) + 3}" font-size="8.5" font-weight="700" fill="currentColor">${base}</text>`;
  // Barré : la case la plus basse, tenue d'une corde jusqu'à la chanterelle sans corde à vide ni muette entre les deux.
  const atLo = f.map((x, i) => (x === lo ? i : -1)).filter((i) => i >= 0);
  const barre = lo > 0 && atLo.length >= 2 && f[5] === lo && f.slice(atLo[0]).every((x) => x >= lo);
  if (barre) s += `<rect x="${X(atLo[0]) - 3.5}" y="${Y(lo) - 3.5}" width="${X(5) - X(atLo[0]) + 7}" height="7" rx="3.5" fill="currentColor"/>`;
  f.forEach((x, i) => {
    if (x < 0) s += `<path d="M${X(i) - 3} 6l6 6M${X(i) + 3} 6l-6 6" stroke="currentColor" stroke-width="1.4"/>`;
    else if (x === 0) s += `<circle cx="${X(i)}" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/>`;
    else if (!(barre && x === lo)) s += `<circle cx="${X(i)}" cy="${Y(x)}" r="4" fill="currentColor"/>`;
  });
  return s + '</svg>';
}
const songChords = (lines, shift) => [...new Set(lines.flatMap((l) => (l.chunks || []).map((c) => c.ch).filter(Boolean)).map((c) => transposeChord(c, shift)))].slice(0, 24);

/* ----- Paroles synchronisées (LRCLIB) : la ligne en cours s'allume, calée sur l'original ----- */
function parseLrc(txt) {
  const out = [];
  String(txt || '').split('\n').forEach((line) => {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) return;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    tags.forEach((m) => out.push({ t: Number(m[1]) * 60 + Number(m[2]), text }));
  });
  return out.sort((a, b) => a.t - b.t);
}
const lrcWords = (s) => normTxt(s).split(' ').filter(Boolean);
// On aligne chaque ligne minutée sur la ligne de paroles correspondante, dans l'ordre.
function syncMap(lines, lrc) {
  const lyr = [];
  lines.forEach((l, i) => { const w = lrcWords(lineText(l)); if (w.length) lyr.push({ i, w: new Set(w) }); });
  const map = [];
  let p = 0;
  for (const e of lrc) {
    const ew = lrcWords(e.text);
    if (!ew.length) { map.push({ t: e.t, li: -1 }); continue; }
    let best = -1, bs = 0;
    for (let k = p; k < Math.min(lyr.length, p + 8); k++) {
      const sc = ew.filter((w) => lyr[k].w.has(w)).length / ew.length;
      if (sc > bs + 0.05) { bs = sc; best = k; }
    }
    if (best >= 0 && bs >= 0.5) { map.push({ t: e.t, li: lyr[best].i }); p = best + 1; }
  }
  return map;
}
function syncFor(song) {
  if (!song) return null;
  const ly = app.lyrics[lyricsKey(song)];
  if (!ly || ly.state !== 'ok' || !ly.synced) return null;
  const base = sheetBase(song);
  if (!base.text) return null;
  const key = hashStr(base.text) + ':' + base.text.length + ':' + ly.synced.length;
  const c = app.syncCache[song.id];
  if (c && c.key === key) return c.map;
  const map = syncMap(cpParse(base.text), parseLrc(ly.synced));
  const ok = map.filter((m) => m.li >= 0).length >= 4 ? map : null;
  app.syncCache[song.id] = { key, map: ok };
  return ok;
}
function syncLine(map, t) {
  let li = -1;
  for (const m of map) { if (m.t > t) break; li = m.li; }
  return li;
}
function syncHighlight(root, li, follow) {
  const cp = root && root.querySelector('.cp');
  if (!cp) return;
  cp.classList.toggle('syncing', li >= 0);
  const cur = cp.querySelector('.cp-line.now');
  const want = li >= 0 ? cp.querySelector(`.cp-line[data-li="${li}"]`) : null;
  if (cur === want) return;
  if (cur) cur.classList.remove('now');
  root.querySelectorAll('.fr-b.now').forEach((b) => b.classList.remove('now'));
  if (!want) return;
  want.classList.add('now');
  const part = want.closest('.cp-part');
  const b = part && root.querySelector(`.fr-b[data-i="${part.dataset.part}"]`);
  if (b) b.classList.add('now');
  if (follow) want.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
// Page du morceau : on lance le défilement en même temps que l'original (ou la répète).
const kara = { id: null, t: 0, run: false, last: 0 };
setInterval(() => {
  const now = performance.now();
  if (kara.id) {
    if (kara.run) kara.t += Math.min(1, (now - kara.last) / 1000);
    kara.last = now;
    const song = D('songs')[kara.id];
    const open = song && app.sheet && app.sheet.type === 'song' && app.sheet.id === kara.id && !app.cpEdit;
    const map = open && syncFor(song);
    if (!map) { kara.id = null; renderSheet(); }
    else {
      const root = $('#sheet');
      syncHighlight(root, syncLine(map, kara.t), kara.run);
      const tm = root.querySelector('.kara-time');
      if (tm) tm.textContent = `${Math.floor(kara.t / 60)}:${pad(Math.floor(kara.t % 60))}`;
    }
  }
  const st = app.stage;
  if (st && st.scroll) {
    const s = D('songs')[stageIds()[st.idx]];
    const map = s && st.lyrics && syncFor(s);
    if (map) syncHighlight($('#stage'), syncLine(map, st.syncT || 0), false);
  }
}, 100);

/* ----- Ce qu'on affiche : notre version, sinon la grille trouvée en ligne, sinon les paroles seules ----- */
function sheetBase(song) {
  if (song.sheet) return { src: 'ours', text: song.sheet };
  if (app.mode === 'local') return { src: 'none', state: 'local' };
  loadSheet(song);
  const sh = app.sheets[lyricsKey(song)] || { state: 'loading' };
  if (sh.state === 'loading') return { src: 'none', state: 'loading' };
  if (sh.state === 'ok') { if (sh.cp == null) sh.cp = ugToCP(sh.content); return { src: 'ug', text: sh.cp, meta: sh }; }
  loadLyrics(song);
  const ly = app.lyrics[lyricsKey(song)] || { state: 'loading' };
  if (ly.state === 'ok' && ly.text && !ly.instrumental) return { src: 'lrc', text: ly.text.trim(), why: sh.state };
  const state = ly.state === 'loading' ? 'loading' : ly.instrumental ? 'instrumental' : sh.state === 'error' || ly.state === 'error' ? 'error' : 'none';
  return { src: 'none', state };
}
const SHEET_EMPTY = {
  local: 'Disponible sur le site en ligne.',
  loading: 'Chargement…',
  instrumental: 'Instrumental.',
  none: 'Ni grille ni paroles trouvées. Touche « Accords » pour écrire la vôtre.',
  error: 'Grille indisponible. <button class="link-btn" data-act="sheet-retry">Réessayer</button>',
};

// Éditeur : structure (parties, ordre, couleurs), paroles de chaque partie, accords posés en touchant les mots.
function cpEditor(song) {
  const ed = app.cpEdit;
  const shift = Number(song.shift) || 0;
  const cur = song.sheet || '';
  if (cur !== ed.saved) { ed.lines = cpParse(cur || ed.start); ed.saved = cur; ed.sel = null; ed.part = null; ed.colors = null; } // changé ailleurs (annuler, un autre membre)
  if (ed.raw) {
    return `
      <p class="hint" style="margin-top:0"><code>[Am]mot</code> pour un accord, <code># Refrain</code> pour une partie.</p>
      <textarea class="input chart-input" id="cpRaw" data-draft="cp.raw" spellcheck="false" placeholder="# Couplet&#10;[Am]Première ligne des [G]paroles">${esc(draft('cp.raw'))}</textarea>
      <div class="chart-actions">
        <button class="btn primary" data-act="cp-save">Terminé</button>
        <button class="btn" data-act="cp-raw">Revenir aux parties</button>
      </div>`;
  }
  const sel = ed.sel;
  const recent = songChords(ed.lines, shift).slice(0, 12);
  const word = sel ? ((ed.lines[sel.l] || {}).chunks || [])[sel.c] : null;
  const parts = cpParts(ed.lines);
  return `
    <div class="cp-bar">
      <span>Touche un mot pour son accord.</span>
      <button class="btn small primary" data-act="cp-save">Terminé</button>
    </div>
    <div class="struct">
      <h4 class="struct-h">Structure</h4>
      <ol class="struct-list">${parts.map((p, n) => {
        const col = p.head >= 0 ? secColor(song, p.label) : 'sable';
        const nl = ed.lines.slice(p.start, p.end).filter((l) => l.chunks && l.chunks.length).length;
        return `<li class="sp" style="--sc: var(--sc-${col})">
          <button class="sp-dot" data-act="part-colors" data-i="${n}" aria-label="Couleur" aria-expanded="${ed.colors === n}"></button>
          <input class="sp-name" value="${esc(p.head >= 0 ? frSection(p.label) : '')}" placeholder="Début" data-commit="part-rename" data-i="${n}" list="secTypes" maxlength="30" aria-label="Nom de la partie">
          <span class="sp-n">${nl ? plural(nl, 'ligne', 'lignes') : 'vide'}</span>
          <span class="sp-act">
            <button data-act="part-move" data-i="${n}" data-v="-1" ${n ? '' : 'disabled'} aria-label="Monter">${ICON.chevUp}</button>
            <button data-act="part-move" data-i="${n}" data-v="1" ${n < parts.length - 1 ? '' : 'disabled'} aria-label="Descendre">${ICON.chevDown}</button>
            <button data-act="part-dup" data-i="${n}" aria-label="Dupliquer">${ICON.copy}</button>
            <button data-act="part-del" data-i="${n}" aria-label="Supprimer">${ICON.trash}</button>
          </span>
        </li>${ed.colors === n ? `<li class="sp-colors">${Object.entries(SEC_COLORS).map(([k, l]) => `<button data-act="part-color" data-i="${n}" data-v="${k}" style="--sc: var(--sc-${k})" aria-label="${l}" aria-pressed="${k === col}"></button>`).join('')}<small>Pour tous les « ${esc(frSection(p.label) || 'Début')} »</small></li>` : ''}`;
      }).join('')}</ol>
      <select class="input struct-add" data-commit="part-add" aria-label="Ajouter une partie"><option value="">+ Ajouter une partie</option>${SEC_ADD.map((l) => `<option>${l}</option>`).join('')}</select>
      <datalist id="secTypes">${SEC_TYPES.map(([, l]) => `<option value="${l}">`).join('')}</datalist>
    </div>
    <div class="cp edit">${partsHtml(song, ed.lines, shift, { edit: true, sel: sel ? sel.l + ':' + sel.c : '', song })}</div>
    <div class="chart-actions">
      <button class="btn small" data-act="cp-raw">Tout le texte d’un coup</button>
      ${song.sheet ? '<button class="btn small ghost danger" data-act="cp-reset">Effacer notre version</button>' : ''}
    </div>
    ${word ? `
    <div class="cp-picker">
      <div class="cpp-head"><span>Accord sur « ${esc(word.tx.trim() || '…')} »</span><button class="btn small primary" data-act="cp-done">OK</button></div>
      ${recent.length ? `<div class="cpp-row">${recent.map((c) => `<button class="cpp-chip" data-act="cp-recent" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
      <div class="cpp-grid">${CP_ROOTS.map((r) => `<button data-act="cp-root" data-v="${r}" aria-pressed="${ed.root === r}">${r}</button>`).join('')}</div>
      <div class="cpp-grid q">${CP_QUALS.map(([v, l]) => `<button data-act="cp-qual" data-v="${v}" aria-pressed="${ed.root && ed.qual === v}">${l}</button>`).join('')}</div>
      <button class="link-btn" data-act="cp-clear">Retirer l’accord</button>
    </div>` : ''}`;
}

// Bloc « Accords et paroles » de la page du morceau et du mode scène.
function songSheetBlock(song, stage) {
  if (!stage && app.cpEdit && app.cpEdit.id === song.id) return cpEditor(song);
  const base = sheetBase(song);
  if (base.src === 'none') return `<p class="empty-note">${SHEET_EMPTY[base.state] || SHEET_EMPTY.none}</p>`;
  if (base.src !== 'lrc') loadLyrics(song); // pour les paroles synchronisées
  const shift = Math.max(-11, Math.min(11, Number(song.shift) || 0));
  const lines = cpParse(base.text);
  const view = app.sheetView;
  const sh = base.meta || {};
  const bits = [sh.capo ? `Capo ${sh.capo}` : '', sh.tuning && !/^standard$/i.test(sh.tuning) ? `Accordage ${sh.tuning}` : '', shift ? `Tona ${shiftLabel(song)}` : ''].filter(Boolean);
  const o = { stage, view, pop: !stage, marking: !stage && app.marking, song };
  const body = partsHtml(song, lines, shift, o);
  if (stage) {
    return `${bits.length ? `<div class="st-cs-meta">${esc(bits.join(' · '))}</div>` : ''}${friseHtml(song, lines)}<div class="cp on-stage${view === 'grid' ? ' grid' : ''}">${body}</div>`;
  }
  const map = syncFor(song);
  const karaOn = kara.id === song.id;
  const chords = app.sheetDiag ? songChords(lines, shift) : [];
  const source = base.src === 'ug' ? `Ultimate Guitar${sh.rating ? ` · ${String(sh.rating).replace('.', ',')}/5` : ''}` : base.src === 'lrc' ? `Pas de grille trouvée : paroles seules${base.why === 'error' ? ' · <button class="link-btn" data-act="sheet-retry">Réessayer la grille</button>' : ''}` : 'Notre version';
  return `
    <div class="sh-tools">
      <div class="seg sm" role="group" aria-label="Affichage">
        <button data-act="sheet-view" data-v="full" aria-pressed="${view !== 'grid'}">Paroles</button>
        <button data-act="sheet-view" data-v="grid" aria-pressed="${view === 'grid'}">Grille</button>
      </div>
      <button class="tchip" data-act="sheet-diag" aria-pressed="${!!app.sheetDiag}">Diagrammes</button>
      <button class="tchip" data-act="sheet-marks" aria-pressed="${!!app.marking}">Repères</button>
      ${map && !karaOn ? `<button class="tchip" data-act="kara-start" title="Lance-le au début du morceau : la ligne en cours s’allume">${ICON.play}Paroles synchro</button>` : ''}
      <span class="zoom2" role="group" aria-label="Taille du texte"><button data-act="sheet-zoom" data-v="-1" aria-label="Texte plus petit">A−</button><button data-act="sheet-zoom" data-v="1" aria-label="Texte plus grand">A+</button></span>
      ${bits.map((b) => `<span class="cs-chip">${esc(b)}</span>`).join('')}
    </div>
    ${karaOn ? `
    <div class="kara on">
      <button class="btn small primary" data-act="kara-pause">${kara.run ? ICON.pause + 'Pause' : ICON.play + 'Reprendre'}</button>
      <span class="kara-time">0:00</span>
      <button class="btn small ghost" data-act="kara-nudge" data-v="-1" aria-label="Reculer d’une seconde">−1 s</button>
      <button class="btn small ghost" data-act="kara-nudge" data-v="1" aria-label="Avancer d’une seconde">+1 s</button>
      <button class="btn small ghost" data-act="kara-stop" aria-label="Arrêter">${ICON.close}</button>
    </div>` : ''}
    ${friseHtml(song, lines)}
    ${chords.length ? `<div class="cd-strip">${chords.map((c) => `<figure class="cd"><button data-act="chord-pop" data-v="${esc(c)}" aria-label="${esc(c)}">${chordSvg(c)}</button><figcaption>${esc(c)}</figcaption></figure>`).join('')}</div>` : ''}
    ${app.marking ? '<p class="hint mk-hint">Touche une ligne pour y noter un repère.</p>' : ''}
    <div class="cp${view === 'grid' ? ' grid' : ''}" style="--sz:${app.sheetZoom}">${body}</div>
    <p class="hint">${source}</p>
    ${app.chordPop ? `
    <div class="cd-pop" role="dialog" aria-label="Diagramme de ${esc(app.chordPop)}">
      ${chordSvg(app.chordPop)}
      <div class="cd-pop-t"><b>${esc(app.chordPop)}</b>${(chordShape(app.chordPop) || {}).simplified ? '<small>Forme simplifiée</small>' : ''}</div>
      <button class="btn small ghost" data-act="chord-pop-close" aria-label="Fermer">${ICON.close}</button>
    </div>` : ''}`;
}

const ICON = {
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  listen: '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><path d="M5 8h14M5 12h14M5 16h14"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="3"/></svg>',
  stage: '<svg viewBox="0 0 24 24"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3"/><path d="M10 9l5 3-5 3z"/></svg>',
  print: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M8 16L16 8M9.5 8H16v6.5"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2 3l-1 3h6a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7 13V4H4v9zM7 13l4 7c1.5 0 2.5-1 2-3l-1-3h6a2 2 0 0 0 2-2.3l-1.2-6A2 2 0 0 0 16.8 4H7"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/></svg>',
  scroll: '<svg viewBox="0 0 24 24"><path d="M12 4v16M7 15l5 5 5-5"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/></svg>',
  ul: '<svg viewBox="0 0 24 24"><path d="M12 15.5v-11M7.5 9L12 4.5 16.5 9M5 19.5h14"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 14V4M8 7.5l4-4 4 4M7 10.5H5.5v9h13v-9H17"/></svg>',
  chevUp: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/></svg>',
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
  tab: LS.get('hy.tab', 'repertoire'),
  repSort: LS.get('hy.repSort', 'az'),
  query: '',
  gigId: LS.get('hy.gig', null),
  calMonth: monthOf(todayISO()),
  matosView: LS.get('hy.matosView', 'inventaire'),
  gearOwner: 'all',
  showPast: false,
  sheet: null,
  drafts: {},
  mode: 'boot', // boot | online | offline | local
  sending: false,
  lastSync: 0,
  dragging: false,
  needRender: false,
  suggest: { q: '', items: [] },
  calSel: null,
  calMode: 'fill',
  theme: LS.get('hy.theme', 'auto'),
  repView: LS.get('hy.repView', 'list'),
  seen: LS.get('hy.seen', null),
  seenBefore: 0,
  chartEdit: null,
  cpEdit: null,
  sheetView: LS.get('hy.sheetView', 'full') === 'grid' ? 'grid' : 'full',
  sheetZoom: LS.get('hy.sheetZoom', 1),
  sheetDiag: LS.get('hy.sheetDiag', false),
  marking: false,
  markEdit: null,
  chordPop: null,
  syncCache: {},
  partsEdit: null,
  plotSel: null,
  repTab: LS.get('hy.repTab', 'songs'),
  planTab: LS.get('hy.planTab', 'agenda'),
  stage: null,
  wake: null,
  img: null,
  backups: null,
  lyrics: {},
  sheets: {},
};
if (!['auto', 'light', 'dark'].includes(app.theme)) app.theme = 'auto';
if (app.seen == null) { app.seen = Date.now(); LS.set('hy.seen', app.seen); }
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
  return { 'content-type': 'application/json' };
}
try { localStorage.removeItem('hy.code'); } catch {}
function setMode(m) {
  if (app.mode === m) return;
  app.mode = m;
  renderHeader();
  if (app.sheet && app.sheet.type === 'profile') renderSheet();
}

async function pull() {
  if (app.mode === 'local' || app.sending || app.pending.length) return;
  try {
    const q = app.base && app.rev ? '?rev=' + encodeURIComponent(app.rev) : '';
    const r = await fetch(API + q, { headers: headers(), cache: 'no-store' });
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
  if (app.mode === 'local' || app.sending || !app.pending.length) return;
  app.sending = true;
  renderHeader();
  const batch = app.pending.slice(0, 200);
  try {
    const r = await fetch(API, { method: 'POST', headers: headers(), body: JSON.stringify({ ops: batch }) });
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

/* ----- Setlist : morceaux et intermèdes (présentation, pause…) ----- */
const ITEM_PRESETS = ['Présentation du groupe', 'Pause', 'Remerciements', 'Annonce', 'Accordage'];
const AVG_SONG = 240; // durée supposée d'un morceau dont on ne connaît pas la durée
function gigEntries(g) {
  const songs = D('songs');
  const items = (g && g.items) || {};
  return ((g && g.songs) || []).map((id) => (songs[id] ? { id, song: songs[id] } : items[id] ? { id, item: items[id] } : null)).filter(Boolean);
}
const entrySecs = (e) => (e.song ? e.song.duration || 0 : (Number(e.item.dur) || 0) * 60);
const fmtMin = (sec) => `${Math.round(sec / 60)} min`;

/* ----- Fil d'activité ----- */
// Ajoute une ligne au fil. Si je refais la même chose dans les 10 minutes, on met à jour la ligne au lieu d'en créer une.
function logOps(text, key, many) {
  if (!app.me || !app.view) return [];
  const now = Date.now();
  const entries = Object.values(D('log'));
  const last = entries.filter((e) => e.by === app.me).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
  if (key && last && last.k === key && now - last.ts < 600000) {
    return [{ op: 'set', path: ['log', last.id], value: { ...last, ts: now, text: many || text } }];
  }
  const id = newId('l');
  const ops = [{ op: 'set', path: ['log', id], value: { id, by: app.me, text, k: key || '', ts: now } }];
  if (entries.length >= 80) {
    entries.sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(0, entries.length - 59)
      .forEach((e) => ops.push({ op: 'del', path: ['log', e.id] }));
  }
  return ops;
}
function markSeen() {
  const newest = Object.values(D('log')).reduce((m, e) => Math.max(m, e.ts || 0), 0);
  app.seen = Math.max(Date.now(), newest);
  LS.set('hy.seen', app.seen);
}
function unseenCount() {
  if (app.sheet && app.sheet.type === 'activity') { markSeen(); return 0; }
  return Object.values(D('log')).filter((e) => e.ts > app.seen && e.by !== app.me).length;
}

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
    renderPlaybar(); renderView(); renderSheet(); renderStage();
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
    renderPlaybar(); renderView(); renderSheet(); renderStage();
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
  document.querySelectorAll('.beats').forEach((g) => g.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', !!cur && cur.n === i && now - cur.t < 0.16)));
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
  renderStage();
  renderOverlay();
}

function renderHeader() {
  const me = $('#meBtn');
  const dotCls = app.mode === 'local' ? 'local' : app.mode === 'offline' ? 'offline' : (app.sending || app.pending.length) ? 'sending' : '';
  me.innerHTML = `<span class="dot ${dotCls}"></span>${esc(app.me ? memberName(app.me) : 'Profil')}`;
  me.title = statusText();
  const n = app.view ? unseenCount() : 0;
  const badge = $('#bellN');
  badge.hidden = !n;
  badge.textContent = n > 9 ? '9+' : String(n);
  $('#bellBtn').setAttribute('aria-label', n ? `Activité du groupe, ${n} nouveauté${n > 1 ? 's' : ''}` : 'Activité du groupe');
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

function repSeg() {
  const n = Object.values(D('ideas')).filter((it) => ideaState(it) === 'open').length;
  return `<div class="seg top-seg" role="group" aria-label="Vue">
    <button data-act="rep-tab" data-v="songs" aria-pressed="${app.repTab !== 'ideas'}">Morceaux</button>
    <button data-act="rep-tab" data-v="ideas" aria-pressed="${app.repTab === 'ideas'}">Idées${n ? ` <span class="chip-n">${n}</span>` : ''}</button>
  </div>`;
}
const NEED = Math.floor(MEMBERS.length / 2) + 1; // majorité : 3 sur 4
const voteCount = (it, v) => Object.values(it.votes || {}).filter((x) => x === v).length;
const ideaState = (it) => (voteCount(it, -1) >= NEED ? 'no' : 'open');

function viewIdeas() {
  const all = Object.values(D('ideas'));
  const list = all.sort((a, b) => (ideaState(a) === 'no') - (ideaState(b) === 'no') || voteCount(b, 1) - voteCount(a, 1) || (b.ts || 0) - (a.ts || 0));
  const rows = list.map((it) => {
    const mine = (it.votes || {})[app.me] || 0;
    const no = ideaState(it) === 'no';
    return `
      <li class="idea${no ? ' rejected' : ''}">
        ${coverTile(it)}
        <div class="id-main">
          <span class="title">${esc(it.title)}</span>
          <span class="artist">${esc(it.artist)}${it.by ? ` · proposé par ${esc(memberName(it.by))}` : ''}</span>
          ${it.note ? `<span class="id-note">${esc(it.note)}</span>` : ''}
          <span class="id-voters">${MEMBERS.map((m) => { const v = (it.votes || {})[m.id] || 0; return `<i class="${v > 0 ? 'yes' : v < 0 ? 'no' : ''}" style="--mc:${m.color}" title="${esc(m.name)} : ${v > 0 ? 'pour' : v < 0 ? 'contre' : 'pas encore voté'}">${esc(m.name[0])}</i>`; }).join('')}
            ${no ? '<em>Refusé à la majorité</em>' : `<em>${voteCount(it, 1)} sur ${NEED} pour passer</em>`}</span>
        </div>
        <div class="id-side">
          <div class="id-votes">
            <button class="vote up" data-act="idea-vote" data-id="${esc(it.id)}" data-v="1" aria-pressed="${mine === 1}" aria-label="Voter pour" ${app.me ? '' : 'disabled'}>${ICON.up}</button>
            <button class="vote down" data-act="idea-vote" data-id="${esc(it.id)}" data-v="-1" aria-pressed="${mine === -1}" aria-label="Voter contre" ${app.me ? '' : 'disabled'}>${ICON.down}</button>
          </div>
          <div class="id-links">
            <a href="${esc(ytMusic(it.artist + ' ' + it.title))}" target="_blank" rel="noopener">Écouter</a>
            <button data-act="idea-del" data-id="${esc(it.id)}">Retirer</button>
          </div>
        </div>
      </li>`;
  }).join('');
  return `
    <div class="section-head">
      <h2>Répertoire</h2>
      <button class="btn primary small" data-act="add-idea">${ICON.plus}Proposer un morceau</button>
    </div>
    ${repSeg()}
    <p class="lede">${NEED} votes pour sur ${MEMBERS.length} : le morceau rejoint le répertoire.</p>
    ${list.length ? `<ul class="ideas">${rows}</ul>` : emptyCard('Aucune idée pour l’instant', 'Propose un morceau, les autres votent.', 'add-idea', 'Proposer un morceau')}`;
}

function viewRepertoire() {
  if (app.repTab === 'ideas') return viewIdeas();
  const all = songsList();
  let list = all.slice();
  const q = app.query.trim().toLowerCase();
  if (q) list = list.filter((s) => (s.title + ' ' + s.artist).toLowerCase().includes(q));
  const sorts = {
    artist: (a, b) => (a.artist || '').localeCompare(b.artist || '', 'fr') || byTitle(a, b),
    work: (a, b) => ((a.levels || {})[app.me] || 0) - ((b.levels || {})[app.me] || 0) || avgLevel(a) - avgLevel(b) || byTitle(a, b),
    ready: (a, b) => avgLevel(b) - avgLevel(a) || byTitle(a, b),
    behind: (a, b) => avgLevel(a) - avgLevel(b) || byTitle(a, b),
    bpm: (a, b) => (a.bpm || 999) - (b.bpm || 999) || byTitle(a, b),
    dur: (a, b) => (a.duration || 9999) - (b.duration || 9999) || byTitle(a, b),
  };
  if (sorts[app.repSort]) list.sort(sorts[app.repSort]);
  const n = all.length;
  const pct = n ? Math.round((all.reduce((t, s) => t + avgLevel(s), 0) / (n * 4)) * 100) : 0;
  const ready = all.filter((s) => MEMBERS.every((m) => ((s.levels || {})[m.id] || 0) >= 3)).length;
  const counts = [0, 0, 0, 0, 0];
  all.forEach((s) => MEMBERS.forEach((m) => counts[(s.levels || {})[m.id] || 0]++));
  const cells = Math.max(1, n * MEMBERS.length);
  const meter = [4, 3, 2, 1].map((v) => `<span style="width:${(counts[v] / cells) * 100}%;background:${LV_COLORS[v]}"></span>`).join('');

  const grid = app.repView === 'grid';
  const rows = list.map((s) => grid ? `
    <li class="tile${metro.playing && metro.songId === s.id ? ' playing' : ''}" data-act="open-song" data-id="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(s.title)}, ${esc(s.artist)}">
      ${coverTile(s, 'xl')}
      <span class="t-title">${esc(s.title)}</span>
      <span class="t-artist">${esc(s.artist)}</span>
      <span class="t-meta"><span class="pips">${pipsFor(s)}</span><span class="t-bpm">${[s.bpm ? s.bpm + ' bpm' : '', fmtDur(s.duration)].filter(Boolean).join(' · ')}</span></span>
    </li>` : `
    <li class="song${metro.playing && metro.songId === s.id ? ' playing' : ''}" data-act="open-song" data-id="${esc(s.id)}" tabindex="0" role="button">
      ${coverTile(s)}
      <div class="main"><span class="title">${esc(s.title)}</span><span class="artist">${esc(s.artist)}${s.duration ? ` · ${fmtDur(s.duration)}` : ''}</span></div>
      <div class="tempo"><span class="bpm${s.bpm ? '' : ' empty'}">${s.bpm || '—'}</span><span class="key">${esc(s.key || '')}</span></div>
      <div class="pips">${pipsFor(s)}</div>
    </li>`).join('');

  return `
    <div class="section-head">
      <h2>Répertoire</h2>
      <button class="btn primary small" data-act="add-song">${ICON.plus}Ajouter un morceau</button>
    </div>
    ${repSeg()}
    <div class="summary">
      <div class="pct">${pct}<small>%</small></div>
      <div class="sum-line"><strong>${ready}</strong> sur ${n} prêts pour tout le monde</div>
      <div class="meter" aria-hidden="true">${meter}</div>
    </div>
    <div class="toolbar">
      <label class="sort">
        <span>Trier</span>
        <select data-commit="rep-sort" aria-label="Trier le répertoire">
          ${[['az', 'Titre'], ['artist', 'Artiste'], ['ready', 'Les plus prêts (groupe)'], ['behind', 'À bosser (groupe)'], ['work', 'À bosser (moi)'], ['bpm', 'Tempo'], ['dur', 'Durée']].map(([v, l]) => `<option value="${v}" ${app.repSort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      <div class="seg icons" role="group" aria-label="Affichage">
        <button data-act="rep-view" data-v="list" aria-pressed="${!grid}" aria-label="En liste" title="En liste">${ICON.list}</button>
        <button data-act="rep-view" data-v="grid" aria-pressed="${grid}" aria-label="En mosaïque" title="En mosaïque">${ICON.grid}</button>
      </div>
      <input class="search" type="search" placeholder="Chercher un morceau" data-draft="q" data-bind="query" value="${esc(app.query)}" aria-label="Chercher un morceau">
    </div>
    <ul class="songs${grid ? ' grid' : ''}">${rows || '<p class="empty-note">Aucun morceau ne correspond.</p>'}</ul>
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

const gigEvent = (g) => Object.values(D('events')).filter((e) => e.gigId === g.id).sort((a, b) => a.date.localeCompare(b.date)).find((e) => e.date >= todayISO())
  || Object.values(D('events')).find((e) => e.gigId === g.id);
function gigHead(g, count, countLabel) {
  const ev = gigEvent(g);
  const when = ev ? `${fmtDay.format(parseISO(ev.date))}${ev.place ? ', ' + ev.place : ''}` : g.date ? fmtDay.format(parseISO(g.date)) : 'Date à définir';
  return `
    <div class="gig-head">
      <div class="gig-titles">
        <div class="gig-name">${esc(g.name)}</div>
        <div class="gig-sub">${ev ? `<button class="link-btn gig-when" data-act="open-event" data-id="${esc(ev.id)}">${ICON.cal}${esc(when)}</button>` : esc(when)} · ${esc(countLabel(count))}</div>
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
    return head + emptyCard('Pas encore de setlist', 'Une setlist par concert, à ranger en faisant glisser les morceaux.', 'new-gig', 'Créer une setlist');
  }
  const entries = gigEntries(g);
  const tr = g.transitions || {};
  let num = 0;
  const rows = entries.map((e, i) => {
    const next = entries[i + 1];
    if (e.item) {
      const it = e.item;
      return `
      <li class="sl-row sl-item" data-id="${esc(e.id)}">
        <button class="grip" data-drag-handle aria-label="Déplacer ${esc(it.title)}">${ICON.grip}</button>
        <span class="sl-num"></span>
        <span class="it-ico" aria-hidden="true">${ICON.mic}</span>
        <button class="sl-main" data-act="edit-item" data-id="${esc(e.id)}"><span class="title">${esc(it.title)}</span>${it.note ? `<span class="artist">${esc(it.note)}</span>` : ''}</button>
        <span class="sl-meta"><span class="key">${it.dur ? esc(it.dur) + ' min' : ''}</span></span>
        <button class="x" data-act="gig-remove-song" data-id="${esc(e.id)}" aria-label="Retirer ${esc(it.title)} de la setlist">${ICON.close}</button>
      </li>`;
    }
    const s = e.song;
    num++;
    let gap = '';
    if (next && next.song) {
      const t = tr[e.id + '__' + next.id];
      gap = `<li class="sl-gap">${t
        ? `<button class="tr-card" data-act="edit-transition" data-from="${esc(e.id)}" data-to="${esc(next.id)}"><span class="tr-label">Transition</span><span class="tr-title">${esc(t.title || 'Transition')}</span>${t.text ? `<span class="tr-text">${esc(t.text)}</span>` : ''}</button>`
        : `<button class="tr-add" data-act="edit-transition" data-from="${esc(e.id)}" data-to="${esc(next.id)}" aria-label="Ajouter une transition entre ${esc(s.title)} et ${esc(next.song.title)}">${ICON.plus}Transition</button>`}</li>`;
    }
    return `
      <li class="sl-row${metro.playing && metro.songId === e.id ? ' playing' : ''}" data-id="${esc(e.id)}">
        <button class="grip" data-drag-handle aria-label="Déplacer ${esc(s.title)}">${ICON.grip}</button>
        <span class="sl-num">${num}</span>
        ${coverTile(s, 'sm')}
        <button class="sl-main" data-act="open-song" data-id="${esc(e.id)}"><span class="title">${esc(s.title)}</span><span class="artist">${esc(s.artist)}${s.duration ? ` · ${fmtDur(s.duration)}` : ''}</span>${tuneBits(s).length ? `<span class="tune-tag">${esc(tuneBits(s).join(', '))}</span>` : ''}</button>
        <span class="sl-meta"><span class="bpm">${s.bpm || ''}</span><span class="key">${esc(s.key || '')}</span></span>
        <button class="x" data-act="gig-remove-song" data-id="${esc(e.id)}" aria-label="Retirer ${esc(s.title)} de la setlist">${ICON.close}</button>
      </li>${gap}`;
  }).join('');
  const nSongs = entries.filter((e) => e.song).length;
  const nItems = entries.length - nSongs;
  const total = entries.reduce((t, e) => t + entrySecs(e), 0);
  const missing = entries.filter((e) => e.song && !e.song.duration).length;
  const target = Number(g.target) || 0;
  const over = target && total > target * 60;
  const countLabel = (n) => plural(n, 'morceau', 'morceaux') + (nItems ? ` et ${plural(nItems, 'intermède', 'intermèdes')}` : '')
    + (total ? `, environ ${fmtMin(total)}${missing ? ' (sans les durées manquantes)' : ''}` : '');
  return head + gigChips() + gigHead(g, nSongs, countLabel) + `
    ${target ? `<div class="target${over ? ' over' : ''}"><div class="meter"><span style="width:${Math.min(100, (total / (target * 60)) * 100)}%"></span></div><span>${over ? `Trop long de ${fmtMin(total - target * 60)} pour les ${target} min prévues` : `${fmtMin(total)} sur les ${target} min prévues`}</span></div>` : ''}
    ${entries.length ? `<div class="sl-tools">
      <button class="btn small primary" data-act="stage-open">${ICON.stage}Mode scène</button>
      <button class="btn small" data-act="print-setlist">${ICON.print}Imprimer</button>
      <button class="btn small" data-act="gig-image">${ICON.image}Image</button>
    </div>` : ''}
    ${entries.length ? `<ol class="setlist" id="setlist">${rows}</ol><p class="hint">Fais glisser ≡ pour changer l’ordre.</p>` : '<p class="empty-note">Aucun morceau dans cette setlist pour l’instant.</p>'}
    <div class="add-row add-two">
      <button class="btn primary" data-act="pick-songs">${ICON.plus}Ajouter des morceaux</button>
      <button class="btn" data-act="new-item">${ICON.mic}Présentation, pause…</button>
    </div>`;
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
      ${!past && app.me ? (() => {
        const wd = fmtWeekday.format(parseISO(iso));
        const any = Array.from({ length: 13 }, (_, w) => addDays(iso, 7 * w)).some((d) => availOn(d).includes(app.me));
        return `<div class="dp-repeat"><span>Tous les ${esc(wd)}s, pendant 3 mois :</span>
          <button class="chip" data-act="repeat-avail" data-v="on">Je suis dispo</button>
          ${any ? '<button class="chip" data-act="repeat-avail" data-v="off">Plus dispo</button>' : ''}</div>`;
      })() : ''}
    </div>`;
}

function planSeg() {
  return `<div class="seg top-seg" role="group" aria-label="Vue">
    <button data-act="plan-tab" data-v="agenda" aria-pressed="${app.planTab !== 'contacts'}">Agenda</button>
    <button data-act="plan-tab" data-v="contacts" aria-pressed="${app.planTab === 'contacts'}">Contacts</button>
  </div>`;
}
const CONTACT_KINDS = [['salle', 'Salles'], ['orga', 'Orgas'], ['son', 'Ingés son'], ['studio', 'Studios et répètes'], ['autre', 'Autres']];
const telHref = (t) => { const d = String(t || '').replace(/[^0-9+]/g, ''); return d.length >= 6 ? 'tel:' + d : ''; };
const mailHref = (m) => (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(m || '') ? 'mailto:' + m : '');

function viewContacts() {
  const all = Object.values(D('contacts')).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
  const head = `
    <div class="section-head">
      <h2>Planning</h2>
      <button class="btn primary small" data-act="new-contact">${ICON.plus}Ajouter un contact</button>
    </div>
    ${planSeg()}`;
  if (!all.length) return head + emptyCard('Le carnet est vide', 'Salles, orgas, ingés son, studios.', 'new-contact', 'Ajouter un contact');
  return head + CONTACT_KINDS.map(([k, label]) => {
    const list = all.filter((c) => (CONTACT_KINDS.some(([kk]) => kk === c.kind) ? c.kind : 'autre') === k);
    if (!list.length) return '';
    return `
      <section class="gear-group">
        <h3>${esc(label)}<span class="count">${list.length}</span></h3>
        <ul class="gear-list">${list.map((c) => {
          const tel = telHref(c.phone), mail = mailHref(c.email);
          return `
          <li class="gear-row contact" data-act="edit-contact" data-id="${esc(c.id)}" tabindex="0" role="button">
            <div class="gr-main"><span class="gr-name">${esc(c.name)}</span>${[c.place, c.phone, c.note].filter(Boolean).length ? `<span class="gr-details">${esc([c.place, c.phone, c.note].filter(Boolean).join(' · '))}</span>` : ''}</div>
            <span class="ct-actions">
              ${tel ? `<a class="ct-btn" href="${esc(tel)}" aria-label="Appeler ${esc(c.name)}">${ICON.phone}</a>` : ''}
              ${mail ? `<a class="ct-btn" href="${esc(mail)}" aria-label="Écrire à ${esc(c.name)}">${ICON.mail}</a>` : ''}
            </span>
          </li>`;
        }).join('')}</ul>
      </section>`;
  }).join('');
}

function sheetContact(s) {
  const isNew = !s.id;
  if (!isNew && !D('contacts')[s.id]) return null;
  return `
    ${sheetHead(isNew ? 'Nouveau contact' : 'Modifier le contact')}
    <div class="form">
      <div class="field"><label for="c-name">Nom</label><input id="c-name" class="input" data-draft="ct.name" value="${esc(draft('ct.name'))}" placeholder="ex. La Vapeur, Julie (programmation)"></div>
      <div class="field"><label for="c-kind">Type</label><select id="c-kind" class="input" data-draft="ct.kind">${CONTACT_KINDS.map(([k, l]) => `<option value="${k}" ${draft('ct.kind', 'salle') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="grid-2">
        <div class="field"><label for="c-phone">Téléphone</label><input id="c-phone" class="input" type="tel" data-draft="ct.phone" value="${esc(draft('ct.phone'))}" placeholder="06 12 34 56 78"></div>
        <div class="field"><label for="c-email">E-mail</label><input id="c-email" class="input" type="email" data-draft="ct.email" value="${esc(draft('ct.email'))}" placeholder="prog@salle.fr"></div>
      </div>
      <div class="field"><label for="c-place">Lieu, adresse</label><input id="c-place" class="input" data-draft="ct.place" value="${esc(draft('ct.place'))}" placeholder="ex. 42 avenue de Stalingrad, Dijon"></div>
      <div class="field"><label for="c-note">Infos</label><textarea id="c-note" class="input" data-draft="ct.note" placeholder="ex. Répond plutôt le soir, a vu notre concert de juin">${esc(draft('ct.note'))}</textarea></div>
      ${formActions(isNew, 'contact-save', 'close-sheet', 'contact-delete')}
    </div>`;
}

function viewPlanning() {
  if (app.planTab === 'contacts') return viewContacts();
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
  }).join('')}</ul>` : '<p class="empty-note">Les jours où au moins deux personnes sont dispo s’affichent ici.</p>';

  const all = Object.values(D('events')).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const up = all.filter((e) => e.date >= today);
  const past = all.filter((e) => e.date < today).reverse();
  const row = (e, isPast) => `
    <li class="ev${isPast ? ' past' : ''}" data-act="open-event" data-id="${esc(e.id)}" tabindex="0" role="button">
      ${dateBlock(e.date)}
      <div><div class="ev-title">${esc(evTitle(e))}${e.type === 'concert' ? '<span class="badge">Concert</span>' : ''}</div>
        <div class="ev-sub">${esc(fmtWeekday.format(parseISO(e.date)))}${e.time ? ' à ' + fmtTime(e.time) : ''}${e.place ? ', ' + esc(e.place) : ''}${D('gigs')[e.gigId] ? ` · ${esc(D('gigs')[e.gigId].name)}` : ''}${e.type !== 'concert' && (e.prog || []).length ? ` · ${plural(e.prog.filter((id) => D('songs')[id]).length, 'morceau', 'morceaux')} au programme` : ''}</div></div>
      <div class="ev-count">${availOn(e.date).length}/${MEMBERS.length}<small>dispos</small></div>
    </li>`;

  return `
    <div class="section-head">
      <h2>Planning</h2>
      <button class="btn primary small" data-act="add-event">${ICON.plus}Ajouter une date</button>
    </div>
    ${planSeg()}
    <div class="seg cal-mode" role="group" aria-label="Mode de l’agenda">
      <button data-act="cal-mode" data-v="fill" aria-pressed="${app.calMode === 'fill'}">Remplir mes dispos</button>
      <button data-act="cal-mode" data-v="view" aria-pressed="${app.calMode === 'view'}">Voir le détail</button>
    </div>
    <p class="lede">${app.calMode === 'fill'
      ? (app.me ? 'Touche tes jours de dispo.' : 'Choisis ton profil d’abord.')
      : 'Touche un jour pour voir qui est dispo.'}</p>
    <div class="plan-grid">
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
    <div class="plan-side">
    <h3 class="block-title">Meilleures dates</h3>
    ${bestHtml}
    <h3 class="block-title">Dates calées</h3>
    ${up.length ? `<ul class="events">${up.map((e) => row(e)).join('')}</ul>` : '<p class="empty-note">Aucune date calée pour l’instant.</p>'}
    ${past.length ? `
      <button class="link-btn past-toggle" data-act="toggle-past" aria-expanded="${app.showPast}">${app.showPast ? 'Masquer' : 'Voir'} les dates passées (${past.length})</button>
      ${app.showPast ? `<ul class="events">${past.map((e) => row(e, true)).join('')}</ul>` : ''}` : ''}
    </div>
    </div>`;
}

/* ----- Matos ----- */
function gearGrouped(items) {
  return GEAR_CATS.map((c) => ({ c, items: items.filter((x) => (GEAR_CATS.some((k) => k.id === x.cat) ? x.cat : 'autre') === c.id).sort((a, b) => a.name.localeCompare(b.name, 'fr')) }))
    .filter((g) => g.items.length);
}
const qtyTag = (x) => ((x.qty || 1) > 1 ? ` <span class="qty">×${x.qty}</span>` : '');

/* ----- Fiche technique ----- */
const POSITIONS = [['bl', 'Fond gauche'], ['bc', 'Fond centre'], ['br', 'Fond droite'], ['fl', 'Devant gauche (jardin)'], ['fc', 'Devant centre'], ['fr', 'Devant droite (cour)']];
const POS_XY = { bl: [90, 72], bc: [180, 72], br: [270, 72], fl: [90, 150], fc: [180, 150], fr: [270, 150] };
// Plan de scène libre : la scène est un rectangle, les repères (jardin, cour…) peuvent aller partout autour.
const PLOT_W = 360, PLOT_H = 262;
const STAGE_R = { x: 30, y: 22, w: 300, h: 182 };
const PLOT_LABELS = [['l_jardin', 'Jardin', 46, 222], ['l_cour', 'Cour', 314, 222], ['l_public', 'PUBLIC', 180, 248]];
const LABEL_PRESETS = ['Jardin', 'Cour', 'Public', 'Table de mixage', 'Loges', 'Prise 220 V', 'Entrée', 'Bar', 'Retours'];
const numOr = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
const r1 = (v) => Math.round(v * 10) / 10;
function clampPlot(kind, x, y, hw = 8, hh = 8) {
  const box = kind === 'label' ? { x: 2, y: 2, w: PLOT_W - 4, h: PLOT_H - 4 } : { x: STAGE_R.x + 2, y: STAGE_R.y + 2, w: STAGE_R.w - 4, h: STAGE_R.h - 4 };
  const cx = (lo, hi, v) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  return { x: cx(box.x + hw, box.x + box.w - hw, x), y: cx(box.y + hh, box.y + box.h - hh, y) };
}
// Demi-largeur et demi-hauteur d'un élément du plan, pour qu'il ne déborde pas du cadre.
function plotHalf(it) {
  const k = it.s || 1;
  if (it.kind === 'member') return [24 * k, 22 * k];
  if (it.kind === 'gear') { const n = Math.min(20, it.name.length); return [(Math.max(40, n * 4.3 + 18) * k) / 2, 10 * k]; }
  return [((it.text.length * 6.2 + 8) * k) / 2, 8 * k];
}
// Le matos du plan : celui coché pour le concert choisi dans « Pour un concert ».
function gigGear() {
  const g = currentGig();
  const gearMap = D('gear');
  return g ? Object.keys(g.gear || {}).filter((id) => gearMap[id]).map((id) => gearMap[id]) : [];
}
function plotItems() {
  const saved = (D('tech').plot) || {};
  const items = [];
  const pos = techPositions();
  bandSetup().forEach((x) => {
    const id = 'm_' + x.m.id;
    const sv = saved[id] || {};
    const [dx, dy] = POS_XY[pos[x.m.id]];
    items.push({ id, kind: 'member', x: numOr(sv.x, dx), y: numOr(sv.y, dy), s: numOr(sv.s, 1), setup: x, name: x.m.name });
  });
  // Le matos n'arrive sur scène que quand on l'y fait glisser depuis la liste.
  gigGear().forEach((x) => {
    const id = 'g_' + x.id;
    const sv = saved[id];
    if (!sv || sv.hidden || sv.x == null) return;
    items.push({ id, kind: 'gear', x: Number(sv.x), y: Number(sv.y), s: numOr(sv.s, 1), gear: x, name: x.name });
  });
  const labels = PLOT_LABELS.map(([id, text, x, y]) => ({ id, text, x, y }));
  Object.keys(saved).filter((id) => id.startsWith('l_') && !PLOT_LABELS.some(([d]) => d === id)).forEach((id) => labels.push({ id, text: '', x: 180, y: 236 }));
  labels.forEach((l) => {
    const sv = saved[l.id] || {};
    if (sv.hidden) return;
    const text = sv.text != null ? sv.text : l.text;
    if (!text) return;
    items.push({ id: l.id, kind: 'label', x: numOr(sv.x, l.x), y: numOr(sv.y, l.y), s: numOr(sv.s, 1), text, name: text });
  });
  return items;
}
function plotSave(id, patch) {
  const cur = ((D('tech').plot) || {})[id] || {};
  commit([{ op: 'set', path: ['tech', 'plot', id], value: { ...cur, ...patch } }]);
}
const STANDS = ['', 'Petit pied', 'Grand pied perche', 'Pince', 'Aucun'];
function bandSetup() {
  const members = D('members');
  const gear = Object.values(D('gear'));
  return MEMBERS.map((m) => {
    const role = (members[m.id] || {}).role || '';
    const r = role.toLowerCase();
    const owns = new Set(gear.filter((x) => x.owner === m.id).map((x) => x.cat));
    const guess = (re, cat) => re.test(r) || (!r && owns.has(cat));
    return {
      m, role,
      drums: guess(/batt|drum/, 'batterie'),
      bass: guess(/bass/, 'basses'),
      guitar: guess(/guit/, 'guitares'),
      keys: guess(/clav|piano|synth|keys|orgue/, 'claviers'),
      lead: /chant(?!.*ch(œ|oe)ur)|lead|voix/.test(r),
      backing: /ch(œ|oe)ur/.test(r),
    };
  });
}
function techPositions() {
  const saved = (D('tech').pos) || {};
  const pos = {};
  const taken = () => Object.values(pos);
  const setup = bandSetup();
  setup.forEach((x) => { if (POS_XY[saved[x.m.id]]) pos[x.m.id] = saved[x.m.id]; });
  setup.filter((x) => !pos[x.m.id]).sort((a, b) => b.drums - a.drums || b.lead - a.lead).forEach((x) => {
    const pref = x.drums ? ['bc', 'bl', 'br'] : x.lead ? ['fc', 'fl', 'fr'] : ['fl', 'fr', 'fc', 'bl', 'br', 'bc'];
    pos[x.m.id] = pref.find((p) => !taken().includes(p)) || POSITIONS.map(([p]) => p).find((p) => !taken().includes(p)) || 'fc';
  });
  return pos;
}
function stagePlotSvg(print, edit) {
  const sel = edit ? app.plotSel : null;
  const body = plotItems().map((it) => {
    let inner = '', box;
    if (it.kind === 'member') {
      const x = it.setup;
      const what = [x.drums && 'Batterie', x.bass && 'Basse', x.guitar && 'Guitare', x.keys && 'Clavier', (x.lead || x.backing) && (x.lead ? 'Chant' : 'Chœurs')].filter(Boolean).join(', ') || x.role;
      box = [-30, -30, 60, 62];
      inner = `
        ${x.drums ? '<rect x="-40" y="-30" width="80" height="48" rx="6" class="sp-kit"/>' : ''}
        ${x.lead || x.backing ? '<line x1="15" y1="-4" x2="22" y2="-11" class="sp-mic"/><circle cx="23.5" cy="-12.5" r="3" class="sp-mic-dot"/>' : ''}
        <circle r="12" fill="${x.m.color}"/>
        <text y="4.2" class="sp-ini">${esc(x.m.name[0])}</text>
        <text y="-17" class="sp-name">${esc(x.m.name)}</text>
        ${what ? `<text y="24" class="sp-what">${esc(what.slice(0, 26))}</text>` : ''}`;
    } else if (it.kind === 'gear') {
      const label = it.gear.name.length > 20 ? it.gear.name.slice(0, 19) + '…' : it.gear.name;
      const w = Math.max(40, label.length * 4.3 + 18), h = 20;
      box = [-w / 2, -h / 2, w, h];
      inner = `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="4" class="sp-gear"/>
        <circle cx="${-w / 2 + 7}" cy="0" r="2.8" fill="${memberColor(it.gear.owner)}"/>
        <text x="4" y="2.6" class="sp-gtx">${esc(label)}</text>`;
    } else {
      const w = it.text.length * 6.2 + 8, h = 16;
      box = [-w / 2, -h / 2 - 1, w, h];
      inner = `<text y="3.6" class="sp-label">${esc(it.text)}</text>`;
    }
    const k = it.s;
    const isSel = sel === it.id;
    const hit = edit ? `<rect class="sp-hit" x="${box[0] - 6}" y="${box[1] - 6}" width="${box[2] + 12}" height="${box[3] + 12}" rx="6"/>` : '';
    const ring = isSel ? `<rect class="sp-sel" x="${box[0] - 4}" y="${box[1] - 4}" width="${box[2] + 8}" height="${box[3] + 8}" rx="6"/>` : '';
    // Poignées : agrandir/réduire (coin bas droit), retirer (coin haut droit), renommer (coin haut gauche).
    const corner = (cx, cy) => `transform="translate(${r1(cx * k)} ${r1(cy * k)})" data-cx="${cx}" data-cy="${cy}"`;
    const handles = isSel ? `
      <g class="ph ph-size" data-plot-handle="resize" ${corner(box[0] + box[2] + 4, box[1] + box[3] + 4)}><circle r="9"/><path d="M-3.5 3.5L3.5 -3.5M0.5 -3.5H3.5V-0.5M-3.5 0.5V3.5H-0.5"/></g>
      ${it.kind !== 'member' ? `<g class="ph ph-del" data-plot-handle="act" data-act="plot-hide" ${corner(box[0] + box[2] + 4, box[1] - 4)}><circle r="9"/><path d="M-3 -3L3 3M3 -3L-3 3"/></g>` : ''}
      ${it.kind === 'label' ? `<g class="ph ph-edit" data-plot-handle="act" data-act="plot-rename" ${corner(box[0] - 4, box[1] - 4)}><circle r="9"/><path d="M-3.5 3.5h2l5-5-2-2-5 5z"/></g>` : ''}` : '';
    return `<g class="pi ${it.kind}${isSel ? ' sel' : ''}"${edit ? ` data-plot-id="${it.id}"` : ''} transform="translate(${r1(it.x)} ${r1(it.y)})"><g class="pi-body" transform="scale(${k})">${hit}${ring}${inner}</g>${handles}</g>`;
  }).join('');
  return `<svg class="plot${print ? ' print' : ''}${edit ? ' edit' : ''}" viewBox="0 0 ${PLOT_W} ${PLOT_H}" role="img" aria-label="Plan de scène">
    <rect x="${STAGE_R.x}" y="${STAGE_R.y}" width="${STAGE_R.w}" height="${STAGE_R.h}" rx="10" class="sp-stage"/>
    ${body}
  </svg>`;
}
function suggestInputs() {
  const rows = [];
  const add = (label, mic, stand, who) => rows.push({ id: newId('in'), label, mic, stand, who });
  const setup = bandSetup();
  setup.filter((x) => x.drums).forEach((x) => {
    add('Grosse caisse', 'Beta 52 ou D112', 'Petit pied', x.m.id);
    add('Caisse claire', 'SM57', 'Petit pied', x.m.id);
    add('Charleston', 'Statique (SM81…)', 'Petit pied', x.m.id);
    add('Tom alto', 'e604 ou SM57', 'Pince', x.m.id);
    add('Tom basse', 'e604 ou SM57', 'Pince', x.m.id);
    add('Overhead gauche', 'Statique', 'Grand pied perche', x.m.id);
    add('Overhead droite', 'Statique', 'Grand pied perche', x.m.id);
  });
  setup.filter((x) => x.bass).forEach((x) => add('Basse', 'DI', 'Aucun', x.m.id));
  setup.filter((x) => x.guitar).forEach((x) => add(`Guitare (${x.m.name})`, 'SM57 sur l’ampli', 'Petit pied', x.m.id));
  setup.filter((x) => x.keys).forEach((x) => { add(`Clavier G (${x.m.name})`, 'DI', 'Aucun', x.m.id); add(`Clavier D (${x.m.name})`, 'DI', 'Aucun', x.m.id); });
  setup.filter((x) => x.lead).forEach((x) => add(`Chant (${x.m.name})`, 'SM58', 'Grand pied perche', x.m.id));
  setup.filter((x) => x.backing && !x.lead).forEach((x) => add(`Chœurs (${x.m.name})`, 'SM58', 'Grand pied perche', x.m.id));
  return rows;
}
const BACKLINE_CATS = ['amplis', 'batterie', 'claviers', 'inears', 'sono'];
function backline() {
  return Object.values(D('gear')).filter((x) => BACKLINE_CATS.includes(x.cat)).sort((a, b) => BACKLINE_CATS.indexOf(a.cat) - BACKLINE_CATS.indexOf(b.cat) || a.name.localeCompare(b.name, 'fr'));
}
function plotToolbar() {
  const placed = new Set(plotItems().map((it) => it.id));
  const tray = gigGear().filter((x) => !placed.has('g_' + x.id));
  const g = currentGig();
  return `
    <aside class="tray">
      <div class="tray-head"><b>Matos du concert</b>${g ? `<span>${esc(g.name)}</span>` : ''}</div>
      ${gigChips()}
      ${!g ? '<p class="empty-note">Crée d’abord un concert.</p>'
        : !gigGear().length ? '<p class="empty-note">Rien de coché dans « Pour un concert ».</p>'
        : tray.length ? `<div class="tray-list">${tray.map((x) => `<button class="tray-item" data-tray-id="${esc(x.id)}" title="Fais glisser sur la scène"><i style="background:${memberColor(x.owner)}"></i><span>${esc(x.name)}</span></button>`).join('')}</div>
          <p class="hint">Glisse sur la scène.</p>`
        : '<p class="empty-note">Tout est sur scène.</p>'}
      <button class="btn small" data-act="plot-label">${ICON.plus}Repère</button>
      <button class="link-btn" data-act="plot-reset">Tout remettre à zéro</button>
    </aside>`;
}
function sheetPlotLabel(s) {
  const cur = s.id ? plotItems().find((x) => x.id === s.id) : null;
  if (s.id && !cur) return null;
  const v = draft('pl.text');
  return `
    ${sheetHead(cur ? 'Renommer le repère' : 'Ajouter un repère')}
    <div class="form">
      <div class="chips">${LABEL_PRESETS.map((t) => `<button class="chip" data-act="pl-preset" data-v="${esc(t)}" aria-pressed="${v === t}">${esc(t)}</button>`).join('')}</div>
      <div class="field"><label for="pl-text">Texte</label><input id="pl-text" class="input" data-draft="pl.text" data-enter="pl-save" value="${esc(v)}" maxlength="40" placeholder="ex. Table de mixage"></div>
      ${formActions(!cur, 'pl-save', 'close-sheet', '', cur ? 'Enregistrer' : 'Ajouter')}
    </div>`;
}
function viewTech() {
  const tech = D('tech');
  // Ancienne liste d'entrées générée d'après les rôles : on repart de zéro une fois.
  if (tech.inputsV !== 2 && app.mode !== 'boot' && !app.techMig) {
    app.techMig = true;
    setTimeout(() => commit([{ op: 'set', path: ['tech', 'inputs'], value: [] }, { op: 'set', path: ['tech', 'inputsV'], value: 2 }]), 0);
  }
  const inputs = tech.inputsV === 2 && Array.isArray(tech.inputs) ? tech.inputs : [];
  const chosen = gigGear();
  const bl = chosen.length ? chosen : backline();
  const sugg = inputSuggestions();
  return `
    <h3 class="block-title">Plan de scène</h3>
    <div class="tech-grid">
      ${plotToolbar()}
      <div class="plot-wrap">${stagePlotSvg(false, true)}</div>
    </div>
    <h3 class="block-title">Liste des entrées<span class="count">${inputs.length || ''}</span></h3>
    ${inputs.length ? `<ol class="inputs">${inputs.map((r, i) => `
      <li class="in-row" data-act="edit-input" data-i="${i}" role="button" tabindex="0">
        <span class="in-n">${i + 1}</span>
        <div class="gr-main"><span class="gr-name">${esc(r.label)}</span><span class="gr-details">${esc([r.mic, r.stand && r.stand !== 'Aucun' ? r.stand.toLowerCase() : '', r.who ? memberName(r.who) : ''].filter(Boolean).join(' · '))}</span></div>
      </li>`).join('')}</ol>` : ''}
    ${sugg.length ? `<div class="sugg"><span>D’après le matos :</span>${sugg.map((r, i) => `<button class="chip" data-act="input-sug" data-i="${i}">${ICON.plus}${esc(r.label)}</button>`).join('')}${sugg.length > 1 ? '<button class="link-btn" data-act="input-sug-all">Tout ajouter</button>' : ''}</div>` : ''}
    <div class="add-row"><button class="btn" data-act="new-input">${ICON.plus}Ajouter une entrée</button></div>
    <h3 class="block-title">Matos apporté<span class="count">${bl.length || ''}</span></h3>
    ${bl.length ? `<ul class="bl-list">${bl.map((x) => `<li><span>${esc(x.name)}${qtyTag(x)}</span><span class="owner">${esc(memberName(x.owner))}</span></li>`).join('')}</ul>` : '<p class="empty-note">Coche le matos dans « Pour un concert ».</p>'}
    <h3 class="block-title">Infos pour l’orga</h3>
    <textarea class="input" data-draft="tech.notes" placeholder="ex. 4 retours, 2 prises 220 V, balance à 18 h">${esc(draft('tech.notes', tech.notes || ''))}</textarea>
    <div class="chart-actions"><button class="btn" data-act="tech-notes-save">Enregistrer</button></div>
    <div class="add-row"><button class="btn primary block" data-act="tech-print">${ICON.print}Imprimer la fiche technique</button></div>`;
}

// Entrées proposées d'après le matos coché pour le concert (et les chanteurs sans micro coché).
function inputSuggestions() {
  const gear = gigGear();
  const out = [];
  const add = (label, mic, stand, who) => out.push({ label, mic, stand, who });
  const modeler = (n) => /helix|quad ?cortex|kemper|pod ?go|headrush|ampero|fractal|axe-?fx|gt-?1000|tonex|cortex/i.test(n);
  const bassAmp = (n) => /bass|basse|ampeg|markbass|darkglass|hartke|eden|aguilar|gallien|trace elliot/i.test(n);
  const eDrum = (n) => /électro|electro|e-?drum|td-?\d|v-?drum|alesis|dtx|nitro|roland|électronique/i.test(n);
  const name = (id) => memberName(id);
  gear.forEach((x) => {
    const who = x.owner, nm = x.name;
    if (x.cat === 'amplis') {
      if (bassAmp(nm)) add(`Basse (${name(who)})`, 'DI de l’ampli', 'Aucun', who);
      else add(`Ampli guitare ${nm} (${name(who)})`, 'SM57', 'Petit pied', who);
    } else if (x.cat === 'effets' && modeler(nm)) {
      add(`${nm} G (${name(who)})`, 'DI', 'Aucun', who);
      add(`${nm} D (${name(who)})`, 'DI', 'Aucun', who);
    } else if (x.cat === 'basses' && !gear.some((y) => y.owner === who && y.cat === 'amplis' && bassAmp(y.name))) {
      add(`Basse (${name(who)})`, 'DI', 'Aucun', who);
    } else if (x.cat === 'guitares' && !gear.some((y) => y.owner === who && (y.cat === 'amplis' || (y.cat === 'effets' && modeler(y.name))))) {
      add(`Guitare (${name(who)})`, 'DI', 'Aucun', who);
    } else if (x.cat === 'claviers') {
      add(`${nm} G (${name(who)})`, 'DI', 'Aucun', who);
      add(`${nm} D (${name(who)})`, 'DI', 'Aucun', who);
    } else if (x.cat === 'batterie') {
      if (eDrum(nm)) { add(`${nm} G`, 'DI', 'Aucun', who); add(`${nm} D`, 'DI', 'Aucun', who); }
      else { add('Grosse caisse', 'Beta 52 ou D112', 'Petit pied', who); add('Caisse claire', 'SM57', 'Petit pied', who); add('Overheads', 'Statiques', 'Grand pied perche', who); }
    } else if (x.cat === 'micros') {
      add(`Voix ${name(who)}`, nm, 'Grand pied perche', who);
    }
  });
  bandSetup().filter((x) => (x.lead || x.backing) && !gear.some((y) => y.cat === 'micros' && y.owner === x.m.id))
    .forEach((x) => add(`${x.lead ? 'Chant' : 'Chœurs'} (${x.m.name})`, 'SM58', 'Grand pied perche', x.m.id));
  const tech = D('tech');
  const have = new Set((tech.inputsV === 2 && Array.isArray(tech.inputs) ? tech.inputs : []).map((r) => (r.label || '').toLowerCase()));
  const seen = new Set();
  return out.filter((r) => { const k = r.label.toLowerCase(); if (have.has(k) || seen.has(k)) return false; seen.add(k); return true; });
}
function sheetInput(s) {
  const inputs = Array.isArray(D('tech').inputs) ? D('tech').inputs : [];
  const isNew = s.i == null;
  if (!isNew && !inputs[s.i]) return null;
  return `
    ${sheetHead(isNew ? 'Nouvelle entrée' : `Entrée ${s.i + 1}`)}
    <div class="form">
      <div class="field"><label for="in-label">Source</label><input id="in-label" class="input" data-draft="in.label" value="${esc(draft('in.label'))}" placeholder="ex. Guitare (Pierre)"></div>
      <div class="field"><label for="in-mic">Micro ou DI</label><input id="in-mic" class="input" data-draft="in.mic" value="${esc(draft('in.mic'))}" placeholder="ex. SM57"></div>
      <div class="grid-2">
        <div class="field"><label for="in-stand">Pied</label><select id="in-stand" class="input" data-draft="in.stand">${STANDS.map((t) => `<option value="${esc(t)}" ${draft('in.stand') === t ? 'selected' : ''}>${esc(t || '—')}</option>`).join('')}</select></div>
        <div class="field"><label for="in-who">Qui</label><select id="in-who" class="input" data-draft="in.who"><option value="">—</option>${MEMBERS.map((m) => `<option value="${m.id}" ${draft('in.who') === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      </div>
      ${formActions(isNew, 'input-save', 'close-sheet', 'input-delete')}
    </div>`;
}
function printTech() {
  const tech = D('tech');
  const inputs = Array.isArray(tech.inputs) ? tech.inputs : [];
  const setup = bandSetup();
  const chosen = gigGear();
  const bl = chosen.length ? chosen : backline();
  $('#printArea').innerHTML = `
    <div class="pr-head"><div class="pr-band">Hysteria</div><div class="pr-gig"><strong>Fiche technique</strong><br>${esc(fmtDay.format(new Date()))}</div></div>
    <h2 class="pr-h">Le groupe</h2>
    <p class="pr-p">${setup.map((x) => `<strong>${esc(x.m.name)}</strong>${x.role ? ' : ' + esc(x.role) : ''}`).join(' · ')}</p>
    <h2 class="pr-h">Plan de scène</h2>
    <div class="pr-plot">${stagePlotSvg(true, false)}</div>
    <h2 class="pr-h">Liste des entrées</h2>
    ${inputs.length ? `<table class="pr-table"><thead><tr><th>N°</th><th>Source</th><th>Micro / DI</th><th>Pied</th><th>Qui</th></tr></thead><tbody>${inputs.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.label)}</td><td>${esc(r.mic || '')}</td><td>${esc(r.stand || '')}</td><td>${esc(r.who ? memberName(r.who) : '')}</td></tr>`).join('')}</tbody></table>` : '<p class="pr-p">À définir.</p>'}
    ${bl.length ? `<h2 class="pr-h">Matos apporté</h2><p class="pr-p">${bl.map((x) => `${esc(x.name)}${(x.qty || 1) > 1 ? ' ×' + x.qty : ''} (${esc(memberName(x.owner))})`).join(' · ')}</p>` : ''}
    ${tech.notes ? `<h2 class="pr-h">Infos</h2><p class="pr-p" style="white-space:pre-wrap">${esc(tech.notes)}</p>` : ''}`;
  if (PREVIEW) { toast('L’impression marche sur le site en ligne'); return; }
  window.print();
}

function viewMatos() {
  const seg = `
    <div class="seg matos-seg" role="group" aria-label="Vue">
      <button data-act="matos-view" data-v="inventaire" aria-pressed="${app.matosView === 'inventaire'}">Inventaire</button>
      <button data-act="matos-view" data-v="concert" aria-pressed="${app.matosView === 'concert'}">Pour un concert</button>
      <button data-act="matos-view" data-v="tech" aria-pressed="${app.matosView === 'tech'}">Fiche technique</button>
    </div>`;
  const gear = Object.values(D('gear'));
  if (app.matosView === 'tech') return `<div class="section-head"><h2>Matos</h2></div>${seg}` + viewTech();

  if (app.matosView === 'inventaire') {
    const head = `
      <div class="section-head">
        <h2>Matos</h2>
        <button class="btn primary small" data-act="new-gear">${ICON.plus}Ajouter du matos</button>
      </div>${seg}`;
    if (!gear.length) {
      return head + emptyCard('L’inventaire est vide', 'Guitares, amplis, pédales, câbles… et à qui c’est.', 'new-gear', 'Ajouter du matos');
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
  if (!g) return head + emptyCard('Pas encore de concert', 'Crée un concert pour préparer son matos.', 'new-gig', 'Créer un concert');
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
      ${done ? '<button class="link-btn past-toggle" data-act="gig-uncheck-all">Tout décocher</button>' : ''}` : `<p class="empty-note">${gear.length ? 'Rien de choisi.' : 'Remplis d’abord l’inventaire.'}</p>`}
    <div class="add-row"><button class="btn primary block" data-act="${gear.length ? 'pick-gear' : 'go-inventory'}">${gear.length ? 'Choisir le matos' : 'Aller à l’inventaire'}</button></div>`;
}

/* ================= Panneaux ================= */
function openSheet(s) {
  app.sheet = s;
  app.chartEdit = null;
  app.cpEdit = null;
  app.partsEdit = null;
  renderSheet();
}
function closeSheet() {
  const wasActivity = app.sheet && app.sheet.type === 'activity';
  app.sheet = null;
  app.chartEdit = null;
  app.cpEdit = null;
  app.markEdit = null;
  app.chordPop = null;
  renderSheet();
  if (wasActivity) renderHeader();
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
    'pick-prog': sheetPickProg,
    'gig-image': sheetGigImage,
    gear: sheetGear,
    'pick-gear': sheetPickGear,
    transition: sheetTransition,
    profile: sheetProfile,
    activity: sheetActivity,
    item: sheetItem,
    contact: sheetContact,
    input: sheetInput,
    plotlabel: sheetPlotLabel,
  }[s.type];
  const html = fn ? fn(s) : null;
  if (html === null) { hide(); return; }
  const wasHidden = wrap.hidden;
  const page = s.type === 'song' && !s.edit;
  if (wrap.classList.contains('as-page') !== page) { wrap.classList.toggle('as-page', page); el.scrollTop = 0; }
  wrap.hidden = false;
  document.body.style.overflow = 'hidden';
  patch(el, html);
  const hero = el.querySelector('.song-hero');
  el.classList.toggle('has-hero', !!hero);
  if (hero) el.style.setProperty('--hero-ink', hero.style.getPropertyValue('--hero-ink'));
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
  const editing = app.cpEdit && app.cpEdit.id === song.id;
  ensureTone(song);
  const tone = toneOf(song);
  return `
    <div class="song-hero" style="--hero:${tone};--hero-ink:${inkFor(tone)}">
      <div class="hero-in">
        <div class="hero-top">${coverTile(song, 'lg')}${closeBtn()}</div>
        <div class="hero-titles">
          ${inGigs.length ? `<div class="sh-num">${esc(inGigs.map((g) => g.name).join(', '))}</div>` : ''}
          <h2 class="sh-title">${esc(song.title)}</h2>
          <div class="sh-sub">${esc(song.artist)}${song.duration ? ` · ${fmtDur(song.duration)}` : ''}</div>
        </div>
        <div class="row-actions">
          <a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener">${ICON.listen}Écouter</a>
          <button class="btn" data-act="cp-edit-top" aria-pressed="${!!editing}">${ICON.edit}${editing ? 'Terminé' : 'Accords'}</button>
          <button class="btn" data-act="song-edit">Modifier</button>
        </div>
      </div>
    </div>

    <div class="song-body">
      <div class="sb-chords" id="chordsSec">
        <h3 class="block-title">Accords et paroles${editing ? '' : `<span class="bt-right"><button class="link-btn" data-act="cp-edit">Modifier</button></span>`}</h3>
        ${songSheetBlock(song)}
        <a class="btn block songsterr" href="${esc(songsterrUrl(song))}" target="_blank" rel="noopener">${ICON.out}Tablature sur Songsterr</a>
      </div>

      <aside class="sb-side">
      <div class="sb-tempo">
        <div class="tempo-box">
          <div class="tempo-row">
            <div class="tempo-read"><span class="big${song.bpm ? '' : ' empty'}">${song.bpm || '—'}</span><span class="unit">BPM</span></div>
            <div class="tonabox">
              <span class="keyl">Tona jouée</span>
              <div class="tona-ctl" role="group" aria-label="Tonalité jouée par rapport à l’originale">
                <button data-act="shift" data-v="-1" aria-label="Baisser d’un demi-ton">−</button>
                <span class="tona-v">${shiftLabel(song)}</span>
                <button data-act="shift" data-v="1" aria-label="Monter d’un demi-ton">+</button>
              </div>
            </div>
          </div>
          <div class="tune-row">
            <div><b>${fmtDur(song.duration) || '—'}</b><small>Durée</small></div>
            <div><b>${esc(tuningOf(song) || 'Standard')}</b><small>Accordage</small></div>
            <div><b>${song.capo > 0 ? 'Case ' + song.capo : 'Sans'}</b><small>Capo</small></div>
          </div>
          ${song.bpm
            ? `<button class="btn ${playing ? 'playing' : 'primary'} block" data-act="metro-toggle">${playing ? ICON.stop + 'Arrêter le click' : ICON.play + 'Lancer le click'}</button>`
            : '<p class="empty-note" style="margin:0">Pas de tempo : ajoute-le dans « Modifier ».</p>'}
        </div>
      </div>
      <div class="sb-rest">
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
          <textarea class="input" id="noteText" data-draft="note.${esc(song.id)}" placeholder="Une note pour le groupe" aria-label="Nouvelle note">${esc(draft('note.' + song.id))}</textarea>
          <div><button class="btn" data-act="note-add">Ajouter la note</button></div>
        </div>
      </div>
      </aside>
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
      list = '<p class="empty-note">Suggestions disponibles en ligne.</p>';
    } else if (q.trim().length >= 2) {
      if (sg.q !== q.trim()) list = '<p class="empty-note">Recherche…</p>';
      else if (sg.error) list = '<p class="empty-note">Recherche indisponible.</p>';
      else if (!sg.items.length) list = '<p class="empty-note">Rien trouvé.</p>';
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
    ${sheetHead(s.idea ? 'Proposer un morceau' : isNew ? 'Nouveau morceau' : 'Modifier le morceau', '')}
    <div class="form">
      ${search}
      <div class="field"><label for="f-title">Titre</label><input id="f-title" class="input" data-draft="song.title" value="${esc(draft('song.title'))}" autocomplete="off"></div>
      <div class="field"><label for="f-artist">Artiste</label><input id="f-artist" class="input" data-draft="song.artist" value="${esc(draft('song.artist'))}" autocomplete="off"></div>
      ${s.idea ? `
      <div class="field"><label for="f-note">Pourquoi celui-là ? (facultatif)</label><textarea id="f-note" class="input" data-draft="song.note" placeholder="ex. Gros riff, facile à caler, ça marcherait en ouverture">${esc(draft('song.note'))}</textarea></div>
      ${formActions(true, 'song-save', 'close-sheet', '', 'Proposer')}
    </div>` : ''}
      ${s.idea ? '' : `<div class="grid-2">
        <div class="field"><label for="f-bpm">Tempo (BPM)</label><input id="f-bpm" class="input" inputmode="numeric" data-draft="song.bpm" value="${esc(draft('song.bpm'))}" placeholder="ex. 120"></div>
        <div class="field"><label for="f-dur">Durée</label><input id="f-dur" class="input" inputmode="numeric" data-draft="song.dur" value="${esc(draft('song.dur'))}" placeholder="ex. 3:47"></div>
      </div>
      <div class="field"><label for="f-key">Tonalité d’origine</label><input id="f-key" class="input" data-draft="song.key" value="${esc(draft('song.key'))}" placeholder="ex. F♯m"></div>
      <div class="grid-2">
        <div class="field"><label for="f-tuning">Accordage</label><select id="f-tuning" class="input" data-draft="song.tuning">${TUNINGS.map((t) => `<option ${draft('song.tuning', 'Standard') === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label for="f-capo">Capo</label><select id="f-capo" class="input" data-draft="song.capo">${Array.from({ length: 13 }, (_, i) => `<option value="${i}" ${String(draft('song.capo', '0')) === String(i) ? 'selected' : ''}>${i ? 'Case ' + i : 'Sans capo'}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="f-link">Lien d’écoute</label><input id="f-link" class="input" type="url" data-draft="song.link" value="${esc(draft('song.link'))}" placeholder="Rempli tout seul si tu le laisses vide"></div>
      ${formActions(isNew, 'song-save', 'song-cancel', 'song-delete')}
    </div>`}`;
}

// Recherche de morceaux (suggestions à la saisie), avec un petit délai.
let suggestTimer = 0;
function querySuggest(q) {
  clearTimeout(suggestTimer);
  q = q.trim();
  if (app.mode === 'local' || q.length < 2) { app.suggest = { q: '', items: [] }; return; }
  suggestTimer = setTimeout(async () => {
    try {
      const r = await fetch('/api/search?limit=20&q=' + encodeURIComponent(q), { headers: headers() });
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
/* ----- Programme de répète ----- */
// Le concert qui suit une date (avec sa setlist) : ses morceaux passent en premier dans les propositions.
function concertAfter(iso) {
  return Object.values(D('events')).filter((e) => e.type === 'concert' && e.date >= iso && D('gigs')[e.gigId])
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}
function progWhy(s) {
  const lv = s.levels || {};
  const low = MEMBERS.filter((m) => (lv[m.id] || 0) < 3).map((m) => m.name);
  if (!low.length) return 'presque prêt';
  if (low.length === MEMBERS.length) return avgLevel(s) ? 'pas encore en place' : 'personne n’a commencé';
  return 'à bosser : ' + low.join(', ');
}
// Propositions : d'abord les morceaux pas prêts de la prochaine setlist, puis ceux en cours, les moins avancés d'abord.
function progSuggest(ev, max = 6) {
  const songs = D('songs');
  const inProg = new Set(ev.prog || []);
  const c = concertAfter(ev.date);
  const g = c && D('gigs')[c.gigId];
  const inSet = new Set(g ? (g.songs || []).filter((id) => songs[id]) : []);
  return Object.values(songs)
    .filter((s) => !inProg.has(s.id) && avgLevel(s) < 4)
    .map((s) => ({ s, set: inSet.has(s.id), avg: avgLevel(s) }))
    .sort((a, b) => (b.set - a.set) || ((a.set ? a.avg : a.avg || 9) - (b.set ? b.avg : b.avg || 9)) || byTitle(a.s, b.s))
    .slice(0, max)
    .map((x) => ({ ...x, why: (x.set ? `setlist ${g.name} · ` : '') + progWhy(x.s) }));
}
function progSet(evId, fn) {
  const ev = D('events')[evId];
  if (!ev) return;
  const songs = D('songs');
  const before = (ev.prog || []).filter((id) => songs[id]);
  const list = fn(before.slice());
  const log = list.length > before.length ? logOps(`a préparé le programme de la répète du ${fmtShort.format(parseISO(ev.date))}`, 'prog:' + evId) : [];
  commit([{ op: 'set', path: ['events', evId, 'prog'], value: list }, ...log]);
}
function progBlock(ev) {
  const songs = D('songs');
  const prog = (ev.prog || []).filter((id) => songs[id]).map((id) => songs[id]);
  const sug = ev.date >= todayISO() ? progSuggest(ev) : [];
  const total = prog.reduce((t, s) => t + (s.duration || AVG_SONG), 0);
  return `
    <h3 class="block-title">Programme${prog.length ? ` <span class="count">${prog.length}</span>` : ''}<span class="bt-right"><button class="link-btn" data-act="pick-prog" data-id="${esc(ev.id)}">Choisir</button></span></h3>
    ${prog.length ? `<ol class="prog-list">${prog.map((s) => `
      <li class="prog-row">${coverTile(s, 'sm')}<span class="pr-main"><span class="title">${esc(s.title)}</span><span class="pips">${pipsFor(s)}</span></span>
        <button class="x" data-act="prog-del" data-ev="${esc(ev.id)}" data-id="${esc(s.id)}" aria-label="Retirer ${esc(s.title)}">${ICON.close}</button></li>`).join('')}</ol>
      <div class="prog-foot"><span>~${fmtMin(total)} de jeu</span><button class="btn small primary" data-act="stage-prog" data-id="${esc(ev.id)}">${ICON.stage}Mode scène</button></div>`
      : '<p class="empty-note" style="margin:0">Rien de prévu pour l’instant.</p>'}
    ${sug.length ? `<div class="prog-sug-head"><span>Proposés d’après vos niveaux</span><button class="link-btn" data-act="prog-add-all" data-id="${esc(ev.id)}">Tout ajouter</button></div>
      <ul class="prog-list sug">${sug.map(({ s, why }) => `
        <li class="prog-row">${coverTile(s, 'sm')}<span class="pr-main"><span class="title">${esc(s.title)}</span><span class="why">${esc(why)}</span></span>
          <button class="add" data-act="prog-add" data-ev="${esc(ev.id)}" data-id="${esc(s.id)}" aria-label="Ajouter ${esc(s.title)} au programme">${ICON.plus}</button></li>`).join('')}</ul>` : ''}`;
}
function sheetPickProg(s) {
  const ev = D('events')[s.id];
  if (!ev) return null;
  const inProg = new Set((ev.prog || []).filter((id) => D('songs')[id]));
  const q = draft('pick.q').trim().toLowerCase();
  const list = songsList().filter((x) => !q || (x.title + ' ' + x.artist).toLowerCase().includes(q));
  return `
    ${sheetHead('Programme', `${esc(evTitle(ev))} du ${esc(fmtShort.format(parseISO(ev.date)))}, ${plural(inProg.size, 'morceau', 'morceaux')}`)}
    <input class="search block-search" type="search" placeholder="Chercher dans le répertoire" data-draft="pick.q" data-rerender value="${esc(draft('pick.q'))}" aria-label="Chercher dans le répertoire">
    <ul class="pick-list">${list.map((x) => `
      <li><button class="pick-row with-cov" data-act="toggle-prog-song" data-id="${esc(x.id)}" aria-pressed="${inProg.has(x.id)}">
        <span class="check-box">${ICON.check}</span>
        ${coverTile(x, 'sm')}
        <span class="pick-main"><span class="title">${esc(x.title)}</span><span class="artist">${esc(x.artist)}</span></span>
        <span class="pick-meta pips">${pipsFor(x)}</span>
      </button></li>`).join('') || '<p class="empty-note">Aucun morceau ne correspond.</p>'}
    </ul>
    <div class="sheet-foot"><button class="btn primary block" data-act="pick-prog-done">Terminé</button></div>`;
}

function sheetEvent(s) {
  const ev = D('events')[s.id];
  if (!ev) return null;
  const av = availOn(ev.date);
  return `
    ${sheetHead(esc(evTitle(ev)), `${esc(fmtDay.format(parseISO(ev.date)))}${ev.time ? ' à ' + fmtTime(ev.time) : ''}${ev.place ? ', ' + esc(ev.place) : ''}`, esc(relDays(daysUntil(ev.date))))}
    <h3 class="block-title" style="margin-top:4px">Dispos ce jour-là</h3>
    <div class="dispo-row">${dispoChips(ev.date)}</div>
    ${app.me && !av.includes(app.me) && ev.date >= todayISO() ? `<div class="my-dispo"><button class="chip" data-act="toggle-day" data-date="${esc(ev.date)}">Je suis dispo ce jour-là</button></div>` : ''}
    ${ev.type === 'concert' ? (() => {
      const g = D('gigs')[ev.gigId];
      if (!g) return `<h3 class="block-title">Setlist</h3><p class="empty-note" style="margin:0">Aucune pour l’instant. <button class="link-btn" data-act="event-edit">Associer une setlist</button></p>`;
      const ent = gigEntries(g);
      const total = ent.reduce((t, e) => t + entrySecs(e), 0);
      return `<h3 class="block-title">Setlist</h3>
        <button class="linked-gig" data-act="open-gig" data-id="${esc(g.id)}"><b>${esc(g.name)}</b><span>${plural(ent.filter((e) => e.song).length, 'morceau', 'morceaux')}${total ? ` · ${fmtMin(total)}` : ''}</span>${ICON.next}</button>`;
    })() : ''}
    ${ev.type !== 'concert' ? progBlock(ev) : ''}
    ${ev.notes ? `<h3 class="block-title">Infos</h3><p class="note-text" style="margin:0">${esc(ev.notes)}</p>` : ''}
    ${ev.date >= todayISO() ? (() => {
      const { ics, gcal } = calLinks(ev);
      const online = app.mode !== 'local';
      return `<h3 class="block-title">Dans ton agenda</h3>
        <div class="cal-export">
          ${online ? `<a class="btn primary" href="${esc(ics)}">${ICON.cal}Agenda du téléphone</a>` : `<button class="btn primary" data-act="ics-offline">${ICON.cal}Agenda du téléphone</button>`}
          <a class="btn" href="${esc(gcal)}" target="_blank" rel="noopener">Google Agenda</a>
        </div>
        <p class="hint">Avec un rappel la veille.</p>`;
    })() : ''}
    <div class="form-actions" style="margin-top:22px"><button class="btn" data-act="event-edit">Modifier</button></div>`;
}

// Liens d'export : fichier .ics (avec rappel la veille) et modèle Google Agenda.
function calLinks(ev) {
  const title = `Hysteria : ${evTitle(ev)}`;
  const time = /^\d{2}:\d{2}$/.test(ev.time || '') ? ev.time : '20:00';
  const details = ev.notes || '';
  const ics = '/api/ics?' + new URLSearchParams({ id: ev.id, t: title, d: ev.date, h: time, dur: '180', loc: ev.place || '', desc: details }).toString();
  const start = parseISO(ev.date);
  const [hh, mm] = time.split(':').map(Number);
  start.setHours(hh, mm, 0, 0);
  const end = new Date(start.getTime() + 3 * 3600000);
  const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const gcal = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE', text: title, dates: `${f(start)}/${f(end)}`, ctz: 'Europe/Paris', location: ev.place || '', details,
  }).toString();
  return { ics, gcal };
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
      ${type === 'concert' ? `<div class="field"><label for="e-gig">Setlist (facultatif)</label><select id="e-gig" class="input" data-draft="ev.gig">
        <option value="">Pas encore</option>
        ${gigsList().map((g) => `<option value="${esc(g.id)}" ${draft('ev.gig') === g.id ? 'selected' : ''}>${esc(g.name)} (${plural(gigEntries(g).filter((e) => e.song).length, 'morceau', 'morceaux')})</option>`).join('')}
      </select></div>` : ''}
      <div class="field"><label for="e-notes">Infos</label><textarea id="e-notes" class="input" data-draft="ev.notes" placeholder="ex. Ramener les in-ears chargés, balance à 19 h">${esc(draft('ev.notes'))}</textarea></div>
      ${formActions(isNew, 'event-save', 'event-cancel', 'event-delete')}
    </div>`;
}

/* ----- Concert / setlist ----- */
function sheetGig(s) {
  const isNew = !s.id;
  if (!isNew && !D('gigs')[s.id]) return null;
  return `
    ${sheetHead(isNew ? 'Nouvelle setlist' : 'Modifier le concert', '')}
    <div class="form">
      <div class="field"><label for="g-name">Nom du concert</label><input id="g-name" class="input" data-draft="gig.name" data-enter="gig-save" value="${esc(draft('gig.name'))}" placeholder="ex. Fête de la musique"></div>
      <div class="grid-2">
        <div class="field"><label for="g-date">Date (facultatif)</label><input id="g-date" class="input" type="date" data-draft="gig.date" value="${esc(draft('gig.date'))}"></div>
        <div class="field"><label for="g-target">Durée prévue (min)</label><input id="g-target" class="input" type="number" inputmode="numeric" min="0" max="600" data-draft="gig.target" value="${esc(draft('gig.target'))}" placeholder="ex. 45"></div>
      </div>
      ${formActions(isNew, 'gig-save', 'close-sheet', 'gig-delete', isNew ? 'Créer' : '')}
    </div>`;
}

function sheetItem(s) {
  const g = currentGig();
  if (!g) return null;
  const isNew = !s.id;
  if (!isNew && !(g.items || {})[s.id]) return null;
  const title = draft('item.title');
  return `
    ${sheetHead(isNew ? 'Ajouter un intermède' : 'Modifier l’intermède', '')}
    <div class="form">
      <div class="chips">${ITEM_PRESETS.map((t) => `<button class="chip" data-act="item-preset" data-v="${esc(t)}" aria-pressed="${title === t}">${esc(t)}</button>`).join('')}</div>
      <div class="field"><label for="i-title">Intitulé</label><input id="i-title" class="input" data-draft="item.title" value="${esc(title)}" placeholder="ex. Présentation du groupe" maxlength="80"></div>
      <div class="field" style="max-width:160px"><label for="i-dur">Durée (min)</label><input id="i-dur" class="input" type="number" inputmode="numeric" min="0" max="60" data-draft="item.dur" value="${esc(draft('item.dur', '1'))}"></div>
      <div class="field"><label for="i-note">Qui, quoi (facultatif)</label><textarea id="i-note" class="input" data-draft="item.note" placeholder="ex. Pierre présente, Matthieu fait un roulement pendant ce temps">${esc(draft('item.note'))}</textarea></div>
      ${formActions(isNew, 'item-save', 'close-sheet', 'item-delete')}
    </div>`;
}

function sheetPickSongs() {
  const g = D('gigs')[app.gigId];
  if (!g) return null;
  const inGig = new Set((g.songs || []).filter((id) => D('songs')[id]));
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
      <div class="field"><label for="t-text">Comment on la fait</label><textarea id="t-text" class="input" data-draft="tr.text" placeholder="ex. Matthieu garde le charley sur 4 temps, Pierre lance le riff sur le dernier temps">${esc(draft('tr.text'))}</textarea></div>
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
    <h3 class="block-title">Apparence</h3>
    <div class="seg theme-seg" role="group" aria-label="Apparence">
      ${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Nuit']].map(([v, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${app.theme === v}">${l}</button>`).join('')}
    </div>
    
    ${backupBlock()}
    ${app.mode === 'local' ? `
      <h3 class="block-title">${PREVIEW ? 'Aperçu' : 'Mode local'}</h3>
      <p class="empty-note" style="margin:0 0 12px">Mode local : rien n’est partagé.</p>
      <button class="btn danger" data-act="reset-local">Repartir de zéro</button>` : ''}`;
}

// Pose l'accord choisi (affiché dans la tona jouée) sur le mot sélectionné, en le stockant dans la tona d'origine.
function cpApply() {
  const ed = app.cpEdit;
  const chunk = ed && ed.sel && ((ed.lines[ed.sel.l] || {}).chunks || [])[ed.sel.c];
  if (!chunk) return;
  const song = D('songs')[ed.id];
  const shift = Number(song.shift) || 0;
  chunk.ch = ed.root ? transposeChord(ed.root + ed.qual, -shift) : '';
  cpSave();
}
// Enregistre la version en cours d'édition (annulable si on donne un libellé).
function cpSave(undoLabel) {
  const ed = app.cpEdit;
  const song = ed && D('songs')[ed.id];
  if (!song) return;
  const text = cpSerialize(ed.lines).replace(/\n{3,}/g, '\n\n').trim().slice(0, 18000);
  if (!text || text === (song.sheet || '')) { renderSheet(); return; }
  // Rien de changé par rapport à la grille trouvée en ligne : on ne crée pas encore notre version.
  if (!song.sheet && text === cpSerialize(cpParse(ed.start)).replace(/\n{3,}/g, '\n\n').trim()) { renderSheet(); return; }
  ed.saved = text;
  const ops = [{ op: 'set', path: ['songs', song.id, 'sheet'], value: text }, ...(!song.sheet ? logOps(`a fait sa version de «\u00a0${song.title}\u00a0»`, 'sheet:' + song.id) : [])];
  if (undoLabel) commitUndoable(ops, undoLabel); else commit(ops);
}
// Partie n de l'éditeur, avec la ligne-titre. Le début sans titre est nommé avant d'être déplacé.
function cpPart(n, name) {
  const ed = app.cpEdit;
  let parts = cpParts(ed.lines);
  if (name && parts[n] && parts[n].head < 0) { ed.lines.splice(parts[n].start, 0, { sec: 'Début' }); parts = cpParts(ed.lines); }
  const p = parts[n];
  return p ? { p, from: p.head >= 0 ? p.head : p.start, to: p.end, parts } : null;
}
// Applique le texte de la partie en cours d'écriture.
function cpPartApply() {
  const ed = app.cpEdit;
  if (!ed || ed.part == null) return false;
  const r = cpPart(ed.part);
  ed.part = null;
  if (!r) return false;
  const shift = Number(D('songs')[ed.id].shift) || 0;
  const nl = cpShift(cpParse(draft('cp.part').replace(/\s+$/, '')), -shift);
  while (nl.length && nl[nl.length - 1].chunks && !nl[nl.length - 1].chunks.length) nl.pop();
  if (r.p !== r.parts[r.parts.length - 1]) nl.push({ chunks: [] });
  const before = cpSerialize(ed.lines.slice(r.p.start, r.p.end)).trim();
  ed.lines.splice(r.p.start, r.p.end - r.p.start, ...nl);
  delete app.drafts['cp.part'];
  return cpSerialize(nl).trim() !== before;
}

/* ----- Activité ----- */
function sheetActivity() {
  const list = Object.values(D('log')).filter((e) => e && e.ts).sort((a, b) => b.ts - a.ts);
  const head = sheetHead('Activité');
  if (!list.length) return head + '<p class="empty-note">Rien pour l’instant.</p>';
  const today = todayISO();
  const groups = [];
  list.forEach((e) => {
    const iso = toISO(new Date(e.ts));
    const label = iso === today ? 'Aujourd’hui' : iso === addDays(today, -1) ? 'Hier' : fmtDay.format(parseISO(iso));
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(e);
  });
  return head + groups.map((g) => `
    <h3 class="block-title" style="text-transform:none">${esc(g.label.charAt(0).toUpperCase() + g.label.slice(1))}</h3>
    <ul class="acts">${g.items.map((e) => {
      const d = new Date(e.ts);
      const fresh = e.by !== app.me && e.ts > app.seenBefore;
      return `<li class="act${fresh ? ' fresh' : ''}"><i style="background:${memberColor(e.by)}"></i><p><strong>${esc(memberName(e.by))}</strong> ${esc(e.text)}</p><time>${pad(d.getHours())}:${pad(d.getMinutes())}</time></li>`;
    }).join('')}</ul>`).join('');
}

/* ----- Mode scène ----- */
// Ce qu'on joue en mode scène : une setlist, ou le programme d'une répète.
function stageList(st) {
  if (!st) return null;
  if (st.evId) {
    const ev = D('events')[st.evId];
    if (!ev) return null;
    const songs = D('songs');
    return {
      name: `${evTitle(ev)} du ${fmtShort.format(parseISO(ev.date))}`, kind: 'prog', transitions: {}, target: 0,
      entries: (ev.prog || []).filter((id) => songs[id]).map((id) => ({ id, song: songs[id] })),
    };
  }
  const g = D('gigs')[st.gigId];
  return g ? { name: g.name, kind: 'gig', transitions: g.transitions || {}, target: Number(g.target) || 0, entries: gigEntries(g) } : null;
}
const stageSrc = (st) => (st.evId ? 'e:' + st.evId : 'g:' + st.gigId);
function stageIds() {
  const L = stageList(app.stage);
  return L ? L.entries.map((e) => e.id) : [];
}
const fmtClock = (sec) => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`;
function chronoElapsed(st) { return (st.acc || 0) + (st.t0 ? (Date.now() - st.t0) / 1000 : 0); }
function chronoHtml(st) {
  const L = stageList(st);
  const entries = L ? L.entries : [];
  const left = entries.slice(st.idx).reduce((t, e) => t + (entrySecs(e) || (e.song ? AVG_SONG : 0)), 0);
  const el = chronoElapsed(st);
  const target = L ? L.target : 0;
  const end = el + left;
  let cls = '', extra = `reste ~${fmtMin(left)}`;
  if (target) {
    const diff = end - target * 60;
    if (diff > 60) { cls = ' over'; extra = `+${fmtMin(diff)} sur ${target} min`; }
    else extra = `reste ~${fmtMin(left)} sur ${target}`;
  }
  if (!st.t0 && !st.acc) return `<button class="st-chrono" data-act="stage-chrono"><b>Chrono</b><small>toucher pour lancer</small></button>`;
  return `<button class="st-chrono${cls}${st.t0 ? '' : ' paused'}" data-act="stage-chrono" aria-label="Chrono du concert"><b>${fmtClock(el)}</b><small>${esc(extra)}</small></button>`;
}
function renderStage() {
  const el = $('#stage');
  const st = app.stage;
  if (!st || !app.view) {
    if (!el.hidden) { el.hidden = true; el.innerHTML = ''; }
    return;
  }
  const L = stageList(st);
  const entries = L ? L.entries : [];
  if (!entries.length) { stageExit(); return; }
  st.idx = Math.max(0, Math.min(st.idx, entries.length - 1));
  const cur = entries[st.idx];
  const nextE = entries[st.idx + 1];
  const prevSong = entries.slice(0, st.idx).reverse().find((e) => e.song);
  const s = cur.song;
  const nxt = nextE && nextE.song;
  const tr = s && nxt ? L.transitions[cur.id + '__' + nextE.id] : null;
  const playing = s && metro.playing && metro.songId === s.id;
  const tune = s ? tuningOf(s) : '';
  const tuneChanged = s && prevSong && tuningOf(prevSong.song) !== tune;
  const refSong = s || (prevSong && prevSong.song);
  const nxtChange = nxt && refSong && (tuningOf(nxt) !== tuningOf(refSong) || (nxt.capo || 0) !== (refSong.capo || 0));
  const songNum = entries.slice(0, st.idx + 1).filter((e) => e.song).length;
  const nSongs = entries.filter((e) => e.song).length;
  const parts = s ? MEMBERS.map((m) => [m, ((s.parts || {})[m.id] || '').trim()]).filter(([, t]) => t) : [];
  const factor = s ? Math.max(0.4, Math.min(2.5, Number(s.scrollx) || 1)) : 1;

  const songBody = s ? `
      <div>
        <h2 class="st-title">${esc(s.title)}</h2>
        <div class="st-artist" style="margin-top:6px">${esc(s.artist)}</div>
      </div>
      <div class="st-stats">
        ${s.bpm ? `<div><b>${s.bpm}</b><small>BPM</small></div>` : ''}
        ${Number(s.shift) ? `<div><b class="word">${shiftLabel(s)}</b><small>Tona / l’originale</small></div>` : ''}
        ${s.duration ? `<div><b>${fmtDur(s.duration)}</b><small>Durée</small></div>` : ''}
        <div><b class="word${tuneChanged ? ' warn' : ''}">${esc(tune || 'Standard')}</b><small>Accordage${tuneChanged ? ', ça change' : ''}</small></div>
        ${s.capo > 0 ? `<div><b>${s.capo}</b><small>Capo</small></div>` : ''}
      </div>
      <div class="st-tools">
        <button class="st-btn${playing ? ' on' : ''}" data-act="stage-click" ${s.bpm ? '' : 'disabled'}>${playing ? ICON.stop + 'Click' : ICON.play + (s.bpm ? 'Click' : 'Pas de tempo')}</button>
        ${playing ? '<div class="beats" aria-hidden="true"><i class="accent"></i><i></i><i></i><i></i></div>' : ''}
        <button class="st-btn" data-act="stage-auto" aria-pressed="${!!st.auto}" title="Lance le click tout seul à chaque morceau">Click auto</button>
        <span class="st-group">
          <button class="st-btn${st.scroll && !st.paused ? ' on' : ''}" data-act="stage-scroll">${st.scroll && !st.paused ? ICON.pause + 'Défilement' : ICON.scroll + (st.scroll ? 'Reprendre' : 'Défilement')}</button>
          ${st.scroll ? `<button class="st-mini" data-act="scroll-speed" data-v="-1" aria-label="Plus lent">−</button><span class="st-val">×${String(Math.round(factor * 10) / 10).replace('.', ',')}</span><button class="st-mini" data-act="scroll-speed" data-v="1" aria-label="Plus vite">+</button>` : ''}
        </span>
        <button class="st-btn" data-act="stage-lyrics" aria-pressed="${!!st.lyrics}">Accords et paroles</button>
        ${st.lyrics ? `<button class="st-btn" data-act="sheet-view" data-v="${app.sheetView === 'grid' ? 'full' : 'grid'}" aria-pressed="${app.sheetView === 'grid'}">Grille</button>` : ''}
      </div>
      ${st.scroll && st.paused && !st.syncT && st.lyrics && syncFor(s) ? '<p class="st-hint">Paroles synchro : touche l’écran quand le morceau commence.</p>' : ''}
      ${st.lyrics ? `<div class="st-lyr">${songSheetBlock(s, true)}</div>` : ''}` : `
      <div>
        <div class="st-kind">Intermède</div>
        <h2 class="st-title">${esc(cur.item.title)}</h2>
        ${cur.item.dur ? `<div class="st-artist" style="margin-top:6px">${esc(cur.item.dur)} min</div>` : ''}
      </div>
      ${cur.item.note ? `<p class="st-note">${esc(cur.item.note)}</p>` : ''}`;

  const nextHtml = nextE
    ? (nxt ? `<div class="st-nx"><div class="nx-main"><small>Ensuite</small><b>${esc(nxt.title)}</b></div>
          <div class="nx-meta">${[nxt.bpm ? nxt.bpm + ' bpm' : '', fmtDur(nxt.duration)].filter(Boolean).join(' · ')}${nxtChange ? `<span class="nx-warn">${esc([tuningOf(nxt) || 'Standard', nxt.capo > 0 ? 'capo ' + nxt.capo : 'sans capo'].join(', '))}</span>` : ''}</div></div>`
      : `<div class="st-nx"><div class="nx-main"><small>Ensuite</small><b>${esc(nextE.item.title)}</b></div><div class="nx-meta">${nextE.item.dur ? esc(nextE.item.dur) + ' min' : ''}</div></div>`)
    : '<div class="st-end">Dernier morceau.</div>';

  let n = 0;
  const side = `
    <aside class="st-side${st.side ? ' open' : ''}" aria-label="${L.kind === 'prog' ? 'Programme' : 'Déroulé'}">
      <div class="ss-head"><b>${L.kind === 'prog' ? 'Programme' : 'Déroulé'}</b><span>${esc(L.name)}</span><button class="st-mini ss-close" data-act="stage-side" aria-label="Fermer le déroulé">${ICON.close}</button></div>
      <ol class="ss-list">${entries.map((e, i) => {
        const cls = i < st.idx ? 'done' : i === st.idx ? 'now' : '';
        if (e.item) return `<li><button class="ss-row item ${cls}" data-act="stage-jump" data-i="${i}"><span class="ss-n">·</span><span class="ss-t">${esc(e.item.title)}</span><span class="ss-d">${e.item.dur ? esc(e.item.dur) + ' min' : ''}</span></button></li>`;
        n++;
        const tn = tuningOf(e.song);
        return `<li><button class="ss-row ${cls}" data-act="stage-jump" data-i="${i}"><span class="ss-n">${n}</span><span class="ss-t">${esc(e.song.title)}${tn || e.song.capo > 0 ? `<small>${esc(tuneBits(e.song).join(', '))}</small>` : ''}</span><span class="ss-d">${fmtDur(e.song.duration)}</span></button></li>`;
      }).join('')}</ol>
    </aside>`;
  const html = `
    ${side}
    <div class="st-main">
    <div class="st-top">
      <button class="st-quit" data-act="stage-exit">${ICON.prev}Quitter</button>
      <button class="st-mini st-side-btn" data-act="stage-side" aria-pressed="${!!st.side}" aria-label="Déroulé du concert">${ICON.list}</button>
      ${chronoHtml(st)}
      <span class="st-pos">${s ? `<b>${songNum}</b> / ${nSongs}` : '<b>·</b>'}</span>
    </div>
    <div class="st-body">
      ${songBody}
      <div class="st-next">
        ${tr ? `<div class="st-tr"><small>Transition</small><b>${esc(tr.title || 'Transition')}</b>${tr.text ? `<p>${esc(tr.text)}</p>` : ''}</div>` : ''}
        ${nextHtml}
      </div>
    </div>
    <div class="st-bar">
      <span class="st-group">
        <button class="st-mini" data-act="stage-zoom" data-v="-1" aria-label="Texte plus petit">A−</button>
        <button class="st-mini" data-act="stage-zoom" data-v="1" aria-label="Texte plus grand">A+</button>
      </span>
      <span class="st-group">
        <button class="st-mini wide st-sync" data-act="stage-sync" aria-pressed="${!!st.sync && app.mode !== 'local'}" title="Quand quelqu’un change de morceau, tout le monde suit">${ICON.sync}Synchro</button>
        <button class="st-mini wide" data-act="stage-lock">${ICON.lock}Verrouiller</button>
      </span>
    </div>
    <div class="st-nav">
      <button data-act="stage-go" data-v="-1" ${st.idx ? '' : 'disabled'} aria-label="Précédent">${ICON.prev}Précédent</button>
      <button data-act="stage-go" data-v="1" ${nextE ? '' : 'disabled'} aria-label="Suivant">Suivant${ICON.next}</button>
    </div>
    </div>
    ${st.locked ? `<div class="st-lock"><button class="st-unlock" data-hold="unlock">${ICON.lock}<span>Maintiens pour déverrouiller</span></button><p>Écran verrouillé : le pédalier marche toujours.</p></div>` : ''}`;
  const body = el.querySelector('.st-body');
  const keep = st.shown === cur.id && body ? body.scrollTop : 0;
  el.style.setProperty('--zoom', String(st.zoom || 1));
  el.innerHTML = html;
  el.hidden = false;
  const nb = el.querySelector('.st-body');
  if (nb) nb.scrollTop = keep;
  const now = el.querySelector('.ss-row.now');
  if (now) now.scrollIntoView({ block: 'nearest' });
  if (st.shown !== cur.id) {
    st.pos = 0; st.lastSet = 0; st.scrollStart = performance.now() + 2500; st.syncT = 0; st.armed = null;
  }
  if (nxt && app.mode !== 'local') { if (!nxt.sheet) loadSheet(nxt); loadLyrics(nxt); } // le suivant est prêt à temps
  st.shown = cur.id;
  if (st.scroll && !st.paused) startScroll();
}

// Défilement automatique : la grille passe en entier sur la durée du morceau (ou son tempo à défaut).
function scrollDuration(s) {
  if (s.duration) return s.duration;
  if (s.sheet && s.bpm) {
    const ours = cpParse(s.sheet).filter((l) => l.chunks && l.chunks.some((c) => c.tx.trim())).length;
    if (ours) return Math.max(90, ours * 2 * 4 * 60 / s.bpm);
  }
  const sh = app.sheets[lyricsKey(s)];
  const lines = sh && sh.state === 'ok' ? sh.content.split('\n').filter((l) => l.trim() && !/^\s*(\[ch\][^\[]*\[\/ch\]\s*)+$/.test(l) && !/^\s*\[[^\]]+\]\s*$/.test(l)).length : 0;
  if (lines && s.bpm) return Math.max(90, lines * 2 * 4 * 60 / s.bpm); // une ligne de paroles ≈ 2 mesures
  return 210;
}
function startScroll() {
  if (scrollLoop.on) return;
  scrollLoop.on = true;
  scrollLoop.t = performance.now();
  requestAnimationFrame(scrollLoop);
}
function scrollLoop(now) {
  const st = app.stage;
  if (!st || !st.scroll || st.paused) { scrollLoop.on = false; return; }
  const dt = Math.min(0.1, (now - scrollLoop.t) / 1000);
  scrollLoop.t = now;
  requestAnimationFrame(scrollLoop);
  const b = document.querySelector('#stage .st-body');
  const s = D('songs')[stageIds()[st.idx]];
  const map = s && st.lyrics && syncFor(s);
  if (!b || !s || (!map && now < (st.scrollStart || 0))) return;
  if (Math.abs(b.scrollTop - (st.lastSet || 0)) > 3) st.pos = b.scrollTop; // on a fait défiler à la main
  const max = b.scrollHeight - b.clientHeight;
  if (map) {
    // Paroles synchronisées : au premier passage on attend un toucher au début du morceau.
    if (st.armed !== s.id) { st.armed = s.id; if (!st.syncT) { st.paused = true; renderStage(); return; } }
    // Puis on suit le minutage de l'original (accéléré ou ralenti avec ×).
    const factor = Math.max(0.4, Math.min(2.5, Number(s.scrollx) || 1));
    st.syncT = (st.syncT || 0) + dt * factor;
    const li = syncLine(map, st.syncT);
    const line = li >= 0 && b.querySelector(`.cp-line[data-li="${li}"]`);
    if (!line) return;
    const target = Math.max(0, Math.min(max, line.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - b.clientHeight * 0.32));
    const from = st.pos || b.scrollTop;
    st.pos = from + (target - from) * Math.min(1, dt * 4);
    b.scrollTop = st.pos;
    st.lastSet = b.scrollTop;
    return;
  }
  if (max <= 0 || st.pos >= max) return;
  const factor = Math.max(0.4, Math.min(2.5, Number(s.scrollx) || 1));
  st.pos = Math.min(max, (st.pos || 0) + (max / scrollDuration(s)) * factor * dt);
  b.scrollTop = st.pos;
  st.lastSet = b.scrollTop;
}
setInterval(() => {
  const st = app.stage;
  const c = st && st.t0 && document.querySelector('#stage .st-chrono');
  if (c) c.outerHTML = chronoHtml(st);
}, 1000);
async function keepAwake(on) {
  try {
    if (on && !app.wake && navigator.wakeLock) {
      app.wake = await navigator.wakeLock.request('screen');
      app.wake.addEventListener('release', () => { app.wake = null; });
    } else if (!on && app.wake) {
      const w = app.wake;
      app.wake = null;
      await w.release();
    }
  } catch { app.wake = null; }
}
function stageGo(d, remote) {
  const st = app.stage;
  if (!st) return;
  const ids = stageIds();
  const n = st.idx + d;
  if (n < 0 || n >= ids.length) return;
  st.idx = n;
  if (!remote) liveSend();
  const s = D('songs')[ids[n]];
  if (st.auto && s && s.bpm) metro.start(s.id, s.bpm);
  else if (metro.playing) metro.stop();
  else renderStage();
}
// Synchro de la scène : chacun envoie le morceau où il passe, les autres suivent (relevé toutes les 1,5 s).
function liveSend() {
  const st = app.stage;
  if (!st || !st.sync || app.mode === 'local') return;
  const k = newId('k');
  st.liveK = k;
  fetch(API, { method: 'POST', headers: headers(), body: JSON.stringify({ live: { src: stageSrc(st), id: stageIds()[st.idx] || '', i: st.idx, by: app.me || '', k, t: Date.now() } }) }).catch(() => {});
}
async function livePull() {
  const st = app.stage;
  if (!st || !st.sync || app.mode === 'local' || livePull.busy) return;
  livePull.busy = true;
  try {
    const r = await fetch(API + '?live=1', { headers: headers(), cache: 'no-store' });
    if (!(r.headers.get('content-type') || '').includes('application/json')) return;
    const { live } = await r.json();
    const join = !st.joined;
    st.joined = true;
    if (!live || app.stage !== st || !st.sync || live.src !== stageSrc(st) || live.k === st.liveK) return;
    st.liveK = live.k;
    if (join && Date.now() - (Number(live.t) || 0) > 15 * 60000) return; // vieille position : on ne la reprend pas en arrivant
    const ids = stageIds();
    let n = ids.indexOf(live.id);
    if (n < 0) n = Math.min(Number(live.i) || 0, ids.length - 1);
    if (n < 0 || n === st.idx) return;
    stageGo(n - st.idx, true);
    const e = stageList(st).entries[n];
    const what = e.song ? e.song.title : e.item.title;
    toast(join ? `Tu rejoins le groupe : ${what}` : `${live.by ? memberName(live.by) : 'Le groupe'} passe à ${what}`);
  } catch {} finally { livePull.busy = false; }
}
setInterval(() => { if (app.stage && document.visibilityState === 'visible') livePull(); }, 1500);
function stageStart(src) {
  if (metro.playing) metro.stop();
  app.stage = { ...src, idx: 0, auto: LS.get('hy.stageAuto', false), lyrics: LS.get('hy.stageSheet', true), scroll: LS.get('hy.stageScroll', false), paused: false, zoom: LS.get('hy.stageZoom', 1), locked: false, pos: 0, sync: LS.get('hy.stageSync', true), joined: false };
  document.body.style.overflow = 'hidden';
  keepAwake(true);
  renderStage();
  livePull();
  const q = $('#stage .st-nav [data-v="1"]');
  if (q) q.focus({ preventScroll: true });
}
function stageExit() {
  if (!app.stage) return;
  app.stage = null;
  if (metro.playing) metro.stop();
  keepAwake(false);
  if (!app.sheet) document.body.style.overflow = '';
  renderStage();
}

/* ----- Setlist imprimable ----- */
function printSetlist() {
  const g = currentGig();
  if (!g) return;
  const entries = gigEntries(g);
  if (!entries.length) { toast('La setlist est vide'); return; }
  const tr = g.transitions || {};
  let num = 0;
  const rows = entries.map((e, i) => {
    if (e.item) return `<li class="pr-item">${esc(e.item.title)}${e.item.dur ? ` (${esc(e.item.dur)} min)` : ''}${e.item.note ? ` : ${esc(e.item.note)}` : ''}</li>`;
    const s = e.song;
    num++;
    const next = entries[i + 1];
    const t = next && next.song && tr[e.id + '__' + next.id];
    const meta = [fmtDur(s.duration), s.bpm ? s.bpm + ' bpm' : '', s.key ? transposeChord(s.key, Number(s.shift) || 0) : ''].filter(Boolean).join(' · ');
    const tune = tuneBits(s).join(', ');
    return `<li class="pr-row"><span class="pr-n">${num}</span><span class="pr-t">${esc(s.title)}<small>${esc(s.artist)}</small></span><span class="pr-m">${esc(meta)}${tune ? `<em>${esc(tune)}</em>` : ''}</span></li>`
      + (t ? `<li class="pr-tr">↳ ${esc(t.title || 'Transition')}${t.text ? ' : ' + esc(t.text) : ''}</li>` : '');
  }).join('');
  const total = entries.reduce((n, e) => n + entrySecs(e), 0);
  $('#printArea').innerHTML = `
    <div class="pr-head"><div class="pr-band">Hysteria</div><div class="pr-gig"><strong>${esc(g.name)}</strong>${g.date ? '<br>' + esc(fmtDay.format(parseISO(g.date))) : ''}</div></div>
    <ol class="pr-list">${rows}</ol>
    <div class="pr-foot">${plural(num, 'morceau', 'morceaux')}${total ? `, environ ${fmtMin(total)}` : ''}${g.target ? ` (prévu : ${esc(g.target)} min)` : ''}</div>`;
  if (PREVIEW) { toast('L’impression marche sur le site en ligne'); return; }
  window.print();
}

/* ----- Setlist en image (story ou post) ----- */
const IMG_THEMES = {
  brume: { bg: ['#c3cabe', '#eceee6'], ink: '#1d2119', dust: '#565e4e', line: 'rgba(29,33,25,.16)', acc: '#45543a' },
  nuit: { bg: ['#0f110e', '#272c22'], ink: '#e7e9e0', dust: '#aab19d', line: 'rgba(231,233,224,.14)', acc: '#a9bb8c' },
  mousse: { bg: ['#2f3b28', '#56683f'], ink: '#f4f3e8', dust: '#cfd7bf', line: 'rgba(244,243,232,.2)', acc: '#e8d58f' },
};
const IMG_DISPLAY = "Syne, Futura, 'Century Gothic', sans-serif";
const IMG_BODY = "'Instrument Sans', system-ui, -apple-system, sans-serif";
const slugify = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'setlist';
function imgOpts() {
  const o = LS.get('hy.img', {}) || {};
  return { fmt: o.fmt === 'post' ? 'post' : 'story', theme: IMG_THEMES[o.theme] ? o.theme : 'brume', artists: o.artists !== false };
}
function imgData(g) {
  const ev = gigEvent(g);
  const date = (ev && ev.date) || g.date || '';
  const bits = [date ? fmtDay.format(parseISO(date)) : '', ev && ev.time ? fmtTime(ev.time) : '', (ev && ev.place) || ''];
  const songs = gigEntries(g).filter((e) => e.song).map((e) => e.song);
  return { name: g.name || 'Setlist', line: bits.filter(Boolean).join(' · '), songs, secs: songs.reduce((t, x) => t + (x.duration || 0), 0) };
}
const imgKey = (g, o) => { const d = imgData(g); return JSON.stringify([o, d.name, d.line, d.songs.map((x) => [x.title, x.artist, x.duration])]); };
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
function spacedWidth(ctx, text, sp) { let w = 0; for (const ch of text) w += ctx.measureText(ch).width + sp; return w - sp; }
function drawSpaced(ctx, text, x, y, sp) { for (const ch of text) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + sp; } }
async function drawSetlistImage(g, o) {
  const fonts = ['800 100px Syne', '700 60px Syne', '500 40px "Instrument Sans"', '700 40px "Instrument Sans"'];
  drawSetlistImage.fonts = drawSetlistImage.fonts || Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
  await drawSetlistImage.fonts;
  const T = IMG_THEMES[o.theme];
  const d = imgData(g);
  const W = 1080, H = o.fmt === 'story' ? 1920 : 1350, P = 92;
  const top = o.fmt === 'story' ? 240 : 100, bottom = o.fmt === 'story' ? H - 260 : H - 96;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, W * 0.5, H);
  grd.addColorStop(0, T.bg[0]); grd.addColorStop(1, T.bg[1]);
  x.fillStyle = grd; x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic';

  // Le nom du groupe sur toute la largeur.
  x.font = `800 100px ${IMG_DISPLAY}`;
  const wm = 100 * (W - 2 * P) / spacedWidth(x, 'HYSTERIA', 4);
  x.font = `800 ${wm}px ${IMG_DISPLAY}`;
  x.fillStyle = T.ink;
  let y = top + wm * 0.74;
  drawSpaced(x, 'HYSTERIA', P, y, wm * 0.04);

  // Concert, date et lieu.
  y += 34;
  x.fillStyle = T.acc; x.fillRect(P, y, 64, 6);
  let nf = 64;
  x.font = `700 ${nf}px ${IMG_DISPLAY}`;
  while (nf > 40 && x.measureText(d.name).width > W - 2 * P) { nf -= 2; x.font = `700 ${nf}px ${IMG_DISPLAY}`; }
  y += 30 + nf * 0.95;
  x.fillStyle = T.ink;
  x.fillText(fitText(x, d.name, W - 2 * P), P, y);
  if (d.line) {
    x.font = `500 34px ${IMG_BODY}`; x.fillStyle = T.dust;
    y += 54;
    x.fillText(fitText(x, d.line, W - 2 * P), P, y);
  }

  // Les morceaux : une ou deux colonnes, taille ajustée à la place.
  const y0 = y + 70, y1 = bottom - 80, area = y1 - y0;
  const n = d.songs.length, k = o.artists ? 2.2 : 1.55;
  let cols = 1, rows = n, f = Math.min(66, area / Math.max(1, rows * k));
  if (f < 36 && n > 6) { cols = 2; rows = Math.ceil(n / 2); f = Math.min(54, area / (rows * k)); }
  f = Math.max(16, f);
  const rowH = f * k, gap = 44, colW = (W - 2 * P - (cols - 1) * gap) / cols;
  const used = rows * rowH;
  const start = y0 + Math.max(0, (area - used) / 2) * 0.7;
  d.songs.forEach((s, i) => {
    const col = cols === 2 && i >= rows ? 1 : 0;
    const r = col ? i - rows : i;
    const cx = P + col * (colW + gap);
    const by = start + r * rowH + f * 0.95;
    x.font = `700 ${Math.round(f * 0.58)}px ${IMG_BODY}`; x.fillStyle = T.acc;
    x.fillText(String(i + 1).padStart(2, '0'), cx, by);
    const tx = cx + f * 1.3;
    x.font = `700 ${Math.round(f)}px ${IMG_DISPLAY}`; x.fillStyle = T.ink;
    const tw = x.measureText(s.title).width, room = colW - f * 1.3;
    if (tw > room) x.font = `700 ${Math.floor(Math.max(f * 0.7, f * room / tw * 0.98))}px ${IMG_DISPLAY}`; // titre long : un peu plus petit avant de couper
    x.fillText(fitText(x, s.title, room), tx, by);
    if (o.artists) {
      x.font = `500 ${Math.round(f * 0.54)}px ${IMG_BODY}`; x.fillStyle = T.dust;
      x.fillText(fitText(x, s.artist || '', colW - f * 1.3), tx, by + f * 0.78);
    }
    if (r < rows - 1 && !(col === 0 && cols === 2 && i === n - 1)) { x.fillStyle = T.line; x.fillRect(tx, start + (r + 1) * rowH - f * 0.3, colW - f * 1.3, 2); }
  });

  // Pied : nombre de morceaux et durée.
  x.font = `600 30px ${IMG_BODY}`; x.fillStyle = T.dust;
  x.fillText(`${plural(n, 'morceau', 'morceaux')}${d.secs ? ` · environ ${fmtMin(d.secs)}` : ''}`, P, bottom);
  x.fillStyle = T.acc; x.fillRect(W - P - 64, bottom - 10, 64, 6);
  // toDataURL plutôt que toBlob : toBlob attend que la page soit au repos, ce qui peut prendre des secondes.
  const bin = atob(c.toDataURL('image/png').split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}
async function queueImage(g, o, key) {
  if (queueImage.key === key) return;
  queueImage.key = key;
  try {
    const blob = await drawSetlistImage(g, o);
    if (queueImage.key !== key || !blob) return;
    if (app.img) URL.revokeObjectURL(app.img.url);
    app.img = { key, blob, url: URL.createObjectURL(blob), name: `setlist-${slugify(g.name)}.png`, title: g.name };
    if (app.sheet && app.sheet.type === 'gig-image') renderSheet();
  } catch { queueImage.key = null; }
}
function sheetGigImage() {
  const g = currentGig();
  if (!g) return null;
  const o = imgOpts();
  const key = imgKey(g, o);
  const ready = app.img && app.img.key === key;
  if (!ready) queueImage(g, o, key);
  const seg = (k, opts, label) => `<div class="seg" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button data-act="img-opt" data-k="${k}" data-v="${v}" aria-pressed="${o[k] === v}">${l}</button>`).join('')}</div>`;
  return `
    ${sheetHead('Setlist en image', esc(g.name))}
    <div class="img-opts">
      ${seg('fmt', [['story', 'Story'], ['post', 'Post']], 'Format')}
      ${seg('theme', [['brume', 'Brume'], ['nuit', 'Nuit'], ['mousse', 'Mousse']], 'Couleurs')}
      <button class="chip" data-act="img-opt" data-k="artists" aria-pressed="${o.artists}">Artistes</button>
    </div>
    <div class="img-prev ${o.fmt}">${ready ? `<img src="${app.img.url}" alt="Image de la setlist ${esc(g.name)}">` : '<span class="img-wait">Préparation…</span>'}</div>
    <div class="img-actions">
      <button class="btn primary" data-act="img-share" ${ready ? '' : 'disabled'}>${ICON.share}Partager</button>
      <button class="btn" data-act="img-save" ${ready ? '' : 'disabled'}>${ICON.dl}Télécharger</button>
    </div>`;
}
function downloadBlob(blob, name) {
  if (PREVIEW) { toast('Le téléchargement marche sur le site en ligne'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ----- Sauvegarde ----- */
// Remplace les données du groupe par une copie (fichier ou copie automatique du serveur). Annulable.
async function restoreData(data, label) {
  if (data && data.app === 'hysteria' && data.data) data = data.data;
  if (!data || typeof data !== 'object' || !data.songs || typeof data.songs !== 'object') { toast('Ce fichier n’est pas une sauvegarde Hysteria'); return; }
  if (!(await askConfirm(`Remettre toutes les données du groupe comme ${label} ? Ça change pour tout le monde.`, 'Restaurer'))) return;
  const ops = [];
  for (const root of ROOTS) {
    const cur = D(root);
    const next = data[root] && typeof data[root] === 'object' && !Array.isArray(data[root]) ? data[root] : {};
    for (const k of Object.keys(cur)) if (!(k in next)) ops.push({ op: 'del', path: [root, k] });
    for (const [k, v] of Object.entries(next)) if (JSON.stringify(cur[k]) !== JSON.stringify(v)) ops.push({ op: 'set', path: [root, k], value: v });
  }
  if (!ops.length) { toast('Rien à changer : c’est déjà pareil'); return; }
  closeSheet();
  commitUndoable(ops, 'Copie restaurée');
}
async function loadBackups() {
  if (app.mode === 'local') return;
  app.backups = 'loading';
  try {
    const r = await fetch(API + '?backups=1', { headers: headers(), cache: 'no-store' });
    const res = await r.json();
    app.backups = Array.isArray(res.backups) ? res.backups : 'error';
  } catch { app.backups = 'error'; }
  if (app.sheet && app.sheet.type === 'profile') renderSheet();
}
function backupBlock() {
  const b = app.backups;
  const list = app.mode === 'local' ? '' : !Array.isArray(b)
    ? `<p class="hint">${b === 'error' ? 'Copies automatiques indisponibles pour l’instant.' : 'Chargement des copies…'}</p>`
    : b.length ? `<p class="hint bk-hint">Copies automatiques, une par jour (avant les premières modifs), gardées 30 jours :</p>
      <ul class="bk-list">${b.slice(0, 10).map((day) => `<li><span>${esc(fmtDay.format(parseISO(day)))}</span><button class="link-btn" data-act="backup-restore" data-day="${esc(day)}">Restaurer</button></li>`).join('')}</ul>`
    : '<p class="hint">Une copie se fera automatiquement chaque jour où quelque chose change.</p>';
  return `
    <h3 class="block-title">Sauvegarde</h3>
    <div class="bk-actions">
      <button class="btn" data-act="backup-download">${ICON.dl}Télécharger une copie</button>
      <label class="btn">${ICON.ul}Restaurer un fichier<input type="file" accept="application/json,.json" data-file="backup" hidden></label>
    </div>
    ${list}`;
}

/* ----- Couleur de la pochette ----- */
// Tire la couleur marquante d'une pochette (via /api/cover, pour avoir le droit de lire les pixels).
const toneTried = new Set();
function pickTone(px) {
  const buckets = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    const w = 0.3 + sat * Math.max(0, 1 - Math.abs(l - 0.5) * 1.6);
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(k) || { r: 0, g: 0, b: 0, n: 0, w: 0 };
    e.r += r; e.g += g; e.b += b; e.n++; e.w += w;
    buckets.set(k, e);
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.w > best.w) best = e;
  if (!best) return null;
  const hx = (v) => Math.round(v / best.n).toString(16).padStart(2, '0');
  return '#' + hx(best.r) + hx(best.g) + hx(best.b);
}
function ensureTone(s) {
  if (PREVIEW || app.mode === 'local' || !s || isTone(s.tone) || !safeUrl(s.cover) || toneTried.has(s.id + s.cover)) return;
  toneTried.add(s.id + s.cover);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, 32, 32);
      const tone = pickTone(x.getImageData(0, 0, 32, 32).data);
      const cur = D('songs')[s.id];
      if (tone && cur && cur.cover === s.cover && !isTone(cur.tone)) commit([{ op: 'set', path: ['songs', s.id, 'tone'], value: tone }]);
    } catch {}
  };
  img.src = '/api/cover?u=' + encodeURIComponent(s.cover);
}

/* ----- Thème ----- */
const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const root = document.documentElement;
  if (app.theme === 'light' || app.theme === 'dark') { root.dataset.theme = app.theme; app.themeSet = true; }
  else if (app.themeSet) { delete root.dataset.theme; app.themeSet = false; }
  const dark = root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && !!darkMQ && darkMQ.matches);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = dark ? '#20241d' : '#cfd4cb';
}
if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', applyTheme);

/* ----- Écrans d'accueil ----- */
function renderOverlay() {
  const el = $('#overlay');
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
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act';
    b.textContent = action.label;
    b.onclick = () => { t.classList.remove('show'); clearTimeout(toast._t); action.fn(); };
    t.appendChild(b);
  }
  t.classList.toggle('has-act', !!action);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2200);
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

// Annuler : on calcule les opérations inverses avant d'appliquer une suppression.
function getAt(o, path) { let n = o; for (const k of path) { if (!n || typeof n !== 'object') return undefined; n = n[k]; } return n; }
function inverseOps(ops) {
  const sim = clone(app.view);
  const inv = [];
  for (const o of ops) {
    const prev = getAt(sim, o.path);
    inv.unshift(prev === undefined ? { op: 'del', path: o.path } : { op: 'set', path: o.path, value: clone(prev) });
    applyOps(sim, [clone(o)]);
  }
  return inv;
}
function commitUndoable(ops, msg) {
  const inv = inverseOps(ops);
  commit(ops);
  toast(msg, { label: 'Annuler', fn: () => { commit(inv); toast('C’est annulé'); } });
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
    if (app.sheet) closeSheet();
    app.tab = el.dataset.tab;
    LS.set('hy.tab', app.tab);
    renderTabs(); renderView();
    window.scrollTo({ top: 0 });
  },
  'rep-sort'(el) { app.repSort = el.value; LS.set('hy.repSort', app.repSort); renderView(); },
  'rep-tab'(el) { app.repTab = el.dataset.v === 'ideas' ? 'ideas' : 'songs'; LS.set('hy.repTab', app.repTab); renderView(); },
  'plan-tab'(el) { app.planTab = el.dataset.v === 'contacts' ? 'contacts' : 'agenda'; LS.set('hy.planTab', app.planTab); renderView(); },
  'add-idea'() {
    clearDrafts('song.');
    app.suggest = { q: '', items: [] };
    openSheet({ type: 'song', id: null, edit: true, idea: true });
    setTimeout(() => { const i = $('#f-search') || $('#f-title'); if (i) i.focus(); }, 60);
  },
  'idea-vote'(el) {
    if (!app.me) return;
    const it = D('ideas')[el.dataset.id];
    if (!it) return;
    const v = Number(el.dataset.v);
    const votes = { ...(it.votes || {}) };
    if (votes[app.me] === v) delete votes[app.me]; else votes[app.me] = v;
    const pour = Object.values(votes).filter((x) => x === 1).length;
    if (pour >= NEED) {
      const id = newId('s');
      commit([
        { op: 'set', path: ['songs', id], value: { id, title: it.title, artist: it.artist, key: '', bpm: null, link: ytMusic(it.artist + ' ' + it.title), cover: safeUrl(it.cover), duration: it.duration || null, tuning: 'Standard', capo: 0, levels: {} } },
        { op: 'del', path: ['ideas', it.id] },
        ...logOps(`a fait passer «\u00a0${it.title}\u00a0» au répertoire (${pour} voix pour)`),
      ]);
      toast(`Majorité : «\u00a0${it.title}\u00a0» rejoint le répertoire`);
      return;
    }
    commit([{ op: 'set', path: ['ideas', it.id, 'votes'], value: votes }, ...(votes[app.me] ? logOps(`a voté ${v > 0 ? 'pour' : 'contre'} «\u00a0${it.title}\u00a0»`, 'vote:' + it.id) : [])]);
  },
  'idea-del'(el) {
    const it = D('ideas')[el.dataset.id];
    if (!it) return;
    commitUndoable([{ op: 'del', path: ['ideas', it.id] }], 'Idée retirée');
  },
  'new-contact'() { clearDrafts('ct.'); openSheet({ type: 'contact', id: null }); setTimeout(() => { const i = $('#c-name'); if (i) i.focus(); }, 60); },
  'edit-contact'(el) {
    const c = D('contacts')[el.dataset.id];
    if (!c) return;
    clearDrafts('ct.');
    Object.assign(app.drafts, { 'ct.name': c.name || '', 'ct.kind': c.kind || 'autre', 'ct.phone': c.phone || '', 'ct.email': c.email || '', 'ct.place': c.place || '', 'ct.note': c.note || '' });
    openSheet({ type: 'contact', id: c.id });
  },
  'contact-save'() {
    const name = draft('ct.name').trim();
    if (!name) { toast('Donne au moins un nom'); return; }
    const fields = { name, kind: draft('ct.kind', 'salle'), phone: draft('ct.phone').trim(), email: draft('ct.email').trim(), place: draft('ct.place').trim(), note: draft('ct.note').trim() };
    if (app.sheet.id) commit(Object.entries(fields).map(([k, v]) => ({ op: 'set', path: ['contacts', app.sheet.id, k], value: v })));
    else {
      const id = newId('c');
      commit([{ op: 'set', path: ['contacts', id], value: { id, ...fields, by: app.me, ts: Date.now() } }, ...logOps(`a ajouté ${name} aux contacts`, 'contact-add', 'a ajouté des contacts')]);
    }
    clearDrafts('ct.');
    closeSheet();
  },
  'contact-delete'() {
    const c = D('contacts')[app.sheet.id];
    if (!c) return;
    closeSheet();
    commitUndoable([{ op: 'del', path: ['contacts', c.id] }], `${c.name} supprimé des contacts`);
  },
  'tech-pos'(el) {
    const pos = { ...techPositions(), [el.dataset.id]: el.value };
    // Si la place était prise, on échange.
    const other = MEMBERS.find((m) => m.id !== el.dataset.id && pos[m.id] === el.value);
    if (other) pos[other.id] = techPositions()[el.dataset.id];
    commit([{ op: 'set', path: ['tech', 'pos'], value: pos }]);
  },
  async 'tech-generate'() {
    const rows = suggestInputs();
    if (!rows.length) { toast('Renseigne d’abord l’instrument de chacun dans son profil'); return; }
    const cur = D('tech').inputs;
    if (Array.isArray(cur) && cur.length && !(await askConfirm('Remplacer la liste actuelle par celle déduite des rôles ?', 'Remplacer'))) return;
    commitUndoable([{ op: 'set', path: ['tech', 'inputs'], value: rows }], `${rows.length} entrées proposées`);
  },
  'new-input'() { clearDrafts('in.'); openSheet({ type: 'input', i: null }); },
  'edit-input'(el) {
    const r = (D('tech').inputs || [])[Number(el.dataset.i)];
    if (!r) return;
    clearDrafts('in.');
    Object.assign(app.drafts, { 'in.label': r.label || '', 'in.mic': r.mic || '', 'in.stand': r.stand || '', 'in.who': r.who || '' });
    openSheet({ type: 'input', i: Number(el.dataset.i) });
  },
  'input-save'() {
    const label = draft('in.label').trim();
    if (!label) { toast('Indique la source'); return; }
    const list = (Array.isArray(D('tech').inputs) ? D('tech').inputs : []).slice();
    const row = { label, mic: draft('in.mic').trim(), stand: draft('in.stand'), who: draft('in.who') };
    if (app.sheet.i == null) list.push({ id: newId('in'), ...row });
    else list[app.sheet.i] = { ...list[app.sheet.i], ...row };
    commit([{ op: 'set', path: ['tech', 'inputs'], value: list }]);
    clearDrafts('in.');
    closeSheet();
  },
  'input-delete'() {
    const list = (Array.isArray(D('tech').inputs) ? D('tech').inputs : []).slice();
    const i = app.sheet.i;
    if (i == null || !list[i]) return;
    const [gone] = list.splice(i, 1);
    closeSheet();
    commitUndoable([{ op: 'set', path: ['tech', 'inputs'], value: list }], `${gone.label} supprimé`);
  },
  'tech-notes-save'() {
    const v = draft('tech.notes', D('tech').notes || '').trim().slice(0, 3000);
    delete app.drafts['tech.notes'];
    commit([{ op: 'set', path: ['tech', 'notes'], value: v }]);
    toast('Infos enregistrées');
  },
  'tech-print'() { printTech(); },
  'plot-unsel'() { app.plotSel = null; renderView(); },
  'input-sug'(el) {
    const r = inputSuggestions()[Number(el.dataset.i)];
    if (!r) return;
    const list = (D('tech').inputsV === 2 && Array.isArray(D('tech').inputs) ? D('tech').inputs : []).slice();
    list.push({ id: newId('in'), ...r });
    commit([{ op: 'set', path: ['tech', 'inputs'], value: list }, { op: 'set', path: ['tech', 'inputsV'], value: 2 }]);
  },
  'input-sug-all'() {
    const list = (D('tech').inputsV === 2 && Array.isArray(D('tech').inputs) ? D('tech').inputs : []).slice();
    inputSuggestions().forEach((r) => list.push({ id: newId('in'), ...r }));
    commit([{ op: 'set', path: ['tech', 'inputs'], value: list }, { op: 'set', path: ['tech', 'inputsV'], value: 2 }]);
  },
  'plot-size'(el) {
    const it = plotItems().find((x) => x.id === app.plotSel);
    if (!it) return;
    const sNew = Math.round(Math.max(0.5, Math.min(2.6, it.s + Number(el.dataset.v) * 0.15)) * 100) / 100;
    const [hw, hh] = plotHalf({ ...it, s: sNew });
    const p = clampPlot(it.kind, it.x, it.y, hw, hh);
    plotSave(it.id, { s: sNew, x: r1(p.x), y: r1(p.y) });
  },
  'plot-hide'() {
    const it = plotItems().find((x) => x.id === app.plotSel);
    if (!it || it.kind === 'member') return;
    app.plotSel = null;
    const cur = ((D('tech').plot) || {})[it.id] || {};
    const isDefault = it.kind === 'label' && PLOT_LABELS.some(([d]) => d === it.id);
    commitUndoable([isDefault ? { op: 'set', path: ['tech', 'plot', it.id], value: { ...cur, hidden: true } } : { op: 'del', path: ['tech', 'plot', it.id] }], it.kind === 'gear' ? `${it.name} remis dans la liste` : `${it.name} retiré`);
  },
  'plot-unhide'() {
    const plot = (D('tech').plot) || {};
    commit(Object.entries(plot).filter(([, v]) => v && v.hidden).map(([id, v]) => {
      const { hidden, ...rest } = v;
      return { op: 'set', path: ['tech', 'plot', id], value: rest };
    }));
  },
  async 'plot-reset'() {
    if (!(await askConfirm('Remettre le plan à zéro ? Le matos retourne dans la liste.', 'Remettre à zéro'))) return;
    const plot = (D('tech').plot) || {};
    const keep = {};
    Object.entries(plot).forEach(([id, v]) => { if (id.startsWith('l_') && !PLOT_LABELS.some(([d]) => d === id) && !v.hidden) keep[id] = { text: v.text, x: v.x, y: v.y }; });
    app.plotSel = null;
    commitUndoable([{ op: 'set', path: ['tech', 'plot'], value: keep }, { op: 'set', path: ['tech', 'pos'], value: {} }], 'Plan remis en place');
  },
  'plot-label'() { clearDrafts('pl.'); openSheet({ type: 'plotlabel', id: null }); setTimeout(() => { const i = $('#pl-text'); if (i) i.focus(); }, 60); },
  'plot-rename'() {
    const it = plotItems().find((x) => x.id === app.plotSel);
    if (!it || it.kind !== 'label') return;
    clearDrafts('pl.');
    app.drafts['pl.text'] = it.text;
    openSheet({ type: 'plotlabel', id: it.id });
  },
  'pl-preset'(el) { app.drafts['pl.text'] = el.dataset.v; renderSheet(); },
  'pl-save'() {
    const text = draft('pl.text').trim().slice(0, 40);
    if (!text) { toast('Écris le texte du repère'); return; }
    if (app.sheet.id) plotSave(app.sheet.id, { text });
    else {
      const id = 'l_' + newId();
      app.plotSel = id;
      commit([{ op: 'set', path: ['tech', 'plot', id], value: { text, x: 180, y: 234, s: 1 } }]);
    }
    clearDrafts('pl.');
    closeSheet();
  },
  'rep-view'(el) { app.repView = el.dataset.v === 'grid' ? 'grid' : 'list'; LS.set('hy.repView', app.repView); renderView(); },
  'theme'(el) { app.theme = el.dataset.v; LS.set('hy.theme', app.theme); applyTheme(); renderSheet(); },
  'open-activity'() {
    app.seenBefore = app.seen;
    markSeen();
    openSheet({ type: 'activity' });
    renderHeader();
  },

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
      'song.duration': it.duration ? String(it.duration) : '', 'song.dur': fmtDur(it.duration), 'song.search': '',
    });
    app.suggest = { q: '', items: [] };
    renderSheet();
  },
  'close-sheet'() { closeSheet(); },
  'song-edit'() {
    const s = D('songs')[app.sheet.id];
    clearDrafts('song.');
    Object.assign(app.drafts, { 'song.title': s.title, 'song.artist': s.artist, 'song.bpm': s.bpm ? String(s.bpm) : '', 'song.key': s.key || '', 'song.link': s.link || '', 'song.cover': s.cover || '', 'song.duration': s.duration ? String(s.duration) : '', 'song.dur': fmtDur(s.duration), 'song.tuning': TUNINGS.includes(s.tuning) ? s.tuning : 'Standard', 'song.capo': String(s.capo || 0) });
    app.sheet.edit = true;
    renderSheet();
  },
  'song-cancel'() { app.sheet.edit = false; renderSheet(); },
  'song-save'() {
    const title = draft('song.title').trim();
    if (!title) { toast('Il faut au moins un titre'); return; }
    if (app.sheet.idea) {
      const artist = draft('song.artist').trim();
      const k = (title + '|' + artist).toLowerCase();
      if (Object.values(D('songs')).some((x) => (x.title + '|' + x.artist).toLowerCase() === k)) { toast('Il est déjà au répertoire'); return; }
      const id = newId('i');
      commit([{ op: 'set', path: ['ideas', id], value: {
        id, title, artist, cover: safeUrl(draft('song.cover')), duration: parseInt(draft('song.duration'), 10) || null,
        note: draft('song.note').trim().slice(0, 300), by: app.me, ts: Date.now(), votes: app.me ? { [app.me]: 1 } : {},
      } }, ...logOps(`a proposé «\u00a0${title}\u00a0»${artist ? ' de ' + artist : ''}`, 'idea-add', 'a proposé des morceaux')]);
      clearDrafts('song.');
      closeSheet();
      toast('Proposé : aux autres de voter');
      return;
    }
    const bpmN = parseInt(draft('song.bpm'), 10);
    const artist = draft('song.artist').trim();
    const fields = {
      title,
      artist,
      key: draft('song.key').trim(),
      bpm: bpmN >= 30 && bpmN <= 300 ? bpmN : null,
      link: draft('song.link').trim() || ytMusic(artist + ' ' + title),
      cover: safeUrl(draft('song.cover')),
      duration: parseDur(draft('song.dur')) || parseInt(draft('song.duration'), 10) || null,
      tuning: TUNINGS.includes(draft('song.tuning')) ? draft('song.tuning') : 'Standard',
      capo: Math.max(0, Math.min(12, parseInt(draft('song.capo', '0'), 10) || 0)),
    };
    if (app.sheet.id) {
      const id = app.sheet.id;
      const old = D('songs')[id] || {};
      if (old.cover !== fields.cover) fields.tone = '';
      commit(Object.entries(fields).map(([k, v]) => ({ op: 'set', path: ['songs', id, k], value: v })));
      if (metro.playing && metro.songId === id && fields.bpm) { metro.bpm = fields.bpm; renderPlaybar(); }
      app.sheet.edit = false;
      renderSheet();
    } else {
      const id = newId('s');
      commit([{ op: 'set', path: ['songs', id], value: { id, ...fields, levels: {} } }, ...logOps(`a ajouté « ${title} » au répertoire`, 'song-add', 'a ajouté des morceaux au répertoire')]);
      openSheet({ type: 'song', id });
      toast('Morceau ajouté au répertoire');
    }
    clearDrafts('song.');
  },
  async 'song-delete'() {
    const s = D('songs')[app.sheet.id];
    if (!s || !(await askConfirm(`Supprimer « ${s.title} » du répertoire pour tout le monde ?`))) return;
    if (metro.songId === s.id) metro.stop();
    const ops = [{ op: 'del', path: ['songs', s.id] }];
    Object.values(D('notes')).forEach((n) => { if (n.songId === s.id) ops.push({ op: 'del', path: ['notes', n.id] }); });
    Object.values(D('gigs')).forEach((g) => {
      if ((g.songs || []).includes(s.id)) ops.push({ op: 'set', path: ['gigs', g.id, 'songs'], value: g.songs.filter((x) => x !== s.id) });
    });
    ops.push(...logOps(`a supprimé « ${s.title} » du répertoire`));
    closeSheet();
    commitUndoable(ops, 'Morceau supprimé');
  },
  'set-level'(el) {
    if (!app.me) return;
    const song = D('songs')[app.sheet.id];
    const v = Number(el.dataset.v);
    if (!song || ((song.levels || {})[app.me] || 0) === v) return;
    commit([{ op: 'set', path: ['songs', song.id, 'levels', app.me], value: v }, ...logOps(`a mis « ${levelLabel(v)} » sur « ${song.title} »`, 'lv:' + song.id)]);
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
    const title = (D('songs')[songId] || {}).title || '';
    commit([{ op: 'set', path: ['notes', id], value: { id, songId, text, by: app.me, ts: Date.now() } }, ...logOps(`a laissé une note sur « ${title} »`, 'note:' + songId, `a laissé des notes sur « ${title} »`)]);
  },
  'chart-edit'() {
    const song = D('songs')[app.sheet.id];
    if (!song) return;
    app.chartEdit = song.id;
    app.drafts['chart.' + song.id] = song.chart || '';
    renderSheet();
    setTimeout(() => { const t = $('#chartText'); if (t) { t.focus(); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 40);
  },
  'cp-edit-top'() {
    if (app.cpEdit && app.cpEdit.id === app.sheet.id) { actions['cp-save'](); return; }
    actions['cp-edit']();
    setTimeout(() => { const sec = $('#chordsSec'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  },
  'cp-edit'() {
    const song = D('songs')[app.sheet.id];
    if (!song) return;
    let text = song.sheet || '';
    if (!text) {
      const sh = app.sheets[lyricsKey(song)];
      const ly = app.lyrics[lyricsKey(song)];
      if (sh && sh.state === 'ok') text = sh.cp != null ? sh.cp : ugToCP(sh.content);
      else if (ly && ly.state === 'ok' && ly.text) text = ly.text.trim();
    }
    app.cpEdit = { id: song.id, lines: cpParse(text), start: text, saved: song.sheet || '', sel: null, root: '', qual: '', raw: !text.trim(), part: null, colors: null };
    app.marking = false;
    app.markEdit = null;
    app.chordPop = null;
    if (app.cpEdit.raw) app.drafts['cp.raw'] = '';
    renderSheet();
  },
  'cp-pick'(el) {
    const ed = app.cpEdit;
    if (!ed) return;
    const l = Number(el.dataset.l), c = Number(el.dataset.c);
    const chunk = ((ed.lines[l] || {}).chunks || [])[c];
    if (!chunk) return;
    if (ed.part != null) { if (cpPartApply()) cpSave(); else renderSheet(); return; }
    ed.sel = { l, c };
    const shown = chunk.ch ? transposeChord(chunk.ch, Number(D('songs')[ed.id].shift) || 0) : '';
    const m = shown.match(/^([A-G](?:#|b)?)(.*)$/);
    ed.root = m ? m[1] : '';
    ed.qual = m ? m[2] : '';
    renderSheet();
  },
  'cp-root'(el) { const ed = app.cpEdit; if (!ed || !ed.sel) return; ed.root = el.dataset.v; cpApply(); },
  'cp-qual'(el) { const ed = app.cpEdit; if (!ed || !ed.sel) return; ed.qual = el.dataset.v; if (ed.root) cpApply(); else renderSheet(); },
  'cp-recent'(el) {
    const ed = app.cpEdit;
    if (!ed || !ed.sel) return;
    const m = el.dataset.v.match(/^([A-G](?:#|b)?)(.*)$/);
    if (!m) return;
    ed.root = m[1]; ed.qual = m[2];
    cpApply();
  },
  'cp-clear'() { const ed = app.cpEdit; if (!ed || !ed.sel) return; ed.root = ''; ed.qual = ''; cpApply(); },
  'cp-done'() { if (app.cpEdit) { app.cpEdit.sel = null; renderSheet(); } },
  'cp-raw'() {
    const ed = app.cpEdit;
    if (!ed) return;
    cpPartApply();
    const shift = Number(D('songs')[ed.id].shift) || 0;
    if (ed.raw) { ed.lines = cpShift(cpParse(draft('cp.raw')), -shift); ed.raw = false; }
    else { app.drafts['cp.raw'] = cpSerialize(cpShift(ed.lines, shift)); ed.raw = true; ed.sel = null; }
    renderSheet();
  },
  'cp-cancel'() { app.cpEdit = null; delete app.drafts['cp.raw']; renderSheet(); },
  'cp-save'() {
    const ed = app.cpEdit;
    const song = ed && D('songs')[ed.id];
    if (!song) return;
    const shift = Number(song.shift) || 0;
    cpPartApply();
    const lines = ed.raw ? cpShift(cpParse(draft('cp.raw')), -shift) : ed.lines;
    const text = cpSerialize(lines).replace(/\n{3,}/g, '\n\n').trim().slice(0, 18000);
    app.cpEdit = null;
    delete app.drafts['cp.raw'];
    if (!text || text === song.sheet) { renderSheet(); return; }
    commit([{ op: 'set', path: ['songs', song.id, 'sheet'], value: text }, ...logOps(`a fait sa version de «\u00a0${song.title}\u00a0»`, 'sheet:' + song.id)]);
  },
  /* Structure du morceau */
  'part-rename'(el) {
    const ed = app.cpEdit;
    const r = ed && cpPart(Number(el.dataset.i));
    if (!r) return;
    const name = el.value.trim().slice(0, 30);
    if (!name) { renderSheet(); return; }
    if (r.p.head >= 0) ed.lines[r.p.head] = { sec: name };
    else ed.lines.splice(r.from, 0, { sec: name });
    cpSave();
  },
  'part-move'(el) {
    const ed = app.cpEdit;
    if (!ed) return;
    cpPartApply();
    const n = Number(el.dataset.i), d = Number(el.dataset.v);
    if (!cpPart(n, true) || !cpPart(n + d, true)) return;
    const parts = cpParts(ed.lines);
    const [x, y] = d < 0 ? [parts[n + d], parts[n]] : [parts[n], parts[n + d]];
    const xs = ed.lines.slice(x.head, x.end), ys = ed.lines.slice(y.head, y.end);
    if (ys.length && ys[ys.length - 1].chunks && ys[ys.length - 1].chunks.length) ys.push({ chunks: [] });
    ed.lines.splice(x.head, y.end - x.head, ...ys, ...xs);
    ed.colors = null;
    cpSave();
  },
  'part-dup'(el) {
    const ed = app.cpEdit;
    if (!ed) return;
    cpPartApply();
    const r = cpPart(Number(el.dataset.i), true);
    if (!r) return;
    const copy = JSON.parse(JSON.stringify(ed.lines.slice(r.from, r.to)));
    if (copy.length && copy[copy.length - 1].chunks && copy[copy.length - 1].chunks.length) copy.push({ chunks: [] });
    ed.lines.splice(r.to, 0, ...copy);
    cpSave();
  },
  'part-del'(el) {
    const ed = app.cpEdit;
    if (!ed) return;
    cpPartApply();
    const r = cpPart(Number(el.dataset.i));
    if (!r) return;
    ed.lines.splice(r.from, r.to - r.from);
    ed.colors = null;
    cpSave(`« ${frSection(r.p.label) || 'Début'} » supprimé`);
  },
  'part-add'(el) {
    const ed = app.cpEdit;
    const label = el.value;
    el.value = '';
    if (!ed || !label) return;
    cpPartApply();
    const same = cpParts(ed.lines).filter((p) => secType(p.label) === secType(label)).length;
    const name = ['Couplet'].includes(label) ? `${label} ${same + 1}` : label;
    while (ed.lines.length && ed.lines[ed.lines.length - 1].chunks && !ed.lines[ed.lines.length - 1].chunks.length) ed.lines.pop();
    if (ed.lines.length) ed.lines.push({ chunks: [] });
    ed.lines.push({ sec: name });
    ed.part = cpParts(ed.lines).length - 1;
    ed.sel = null;
    app.drafts['cp.part'] = '';
    cpSave();
    setTimeout(() => { const t = $('#cpPart'); if (t) { t.focus(); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 60);
  },
  'part-colors'(el) {
    const ed = app.cpEdit;
    if (!ed) return;
    const n = Number(el.dataset.i);
    ed.colors = ed.colors === n ? null : n;
    renderSheet();
  },
  'part-color'(el) {
    const ed = app.cpEdit;
    const song = ed && D('songs')[ed.id];
    const p = song && cpParts(ed.lines)[Number(el.dataset.i)];
    if (!p || !SEC_COLORS[el.dataset.v]) return;
    ed.colors = null;
    commit([{ op: 'set', path: ['songs', song.id, 'secColors', secType(p.label)], value: el.dataset.v }]);
  },
  'part-text'(el) {
    const ed = app.cpEdit;
    if (!ed) return;
    if (ed.part != null) { const changed = cpPartApply(); if (changed) cpSave(); }
    const n = Number(el.dataset.i);
    const p = cpParts(ed.lines)[n];
    if (!p) { cpSave(); return; }
    const shift = Number(D('songs')[ed.id].shift) || 0;
    ed.part = n;
    ed.sel = null;
    app.drafts['cp.part'] = cpSerialize(cpShift(ed.lines.slice(p.start, p.end), shift)).replace(/\s+$/, '');
    renderSheet();
    setTimeout(() => { const t = $('#cpPart'); if (t) t.focus({ preventScroll: true }); }, 40);
  },
  'part-text-ok'() { if (cpPartApply()) cpSave(); else renderSheet(); },
  'part-text-cancel'() { const ed = app.cpEdit; if (ed) { ed.part = null; delete app.drafts['cp.part']; renderSheet(); } },
  'part-jump'(el) {
    const root = el.closest('#stage') ? $('#stage') : $('#sheet');
    const sec = root && root.querySelector(`.cp-part[data-part="${el.dataset.i}"]`);
    if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },

  /* Affichage des accords et paroles */
  'sheet-view'(el) {
    app.sheetView = el.dataset.v === 'grid' ? 'grid' : 'full';
    LS.set('hy.sheetView', app.sheetView);
    renderSheet();
    renderStage();
  },
  'sheet-diag'() { app.sheetDiag = !app.sheetDiag; LS.set('hy.sheetDiag', app.sheetDiag); renderSheet(); },
  'sheet-zoom'(el) {
    app.sheetZoom = Math.round(Math.max(0.8, Math.min(1.8, (app.sheetZoom || 1) + Number(el.dataset.v) * 0.1)) * 10) / 10;
    LS.set('hy.sheetZoom', app.sheetZoom);
    renderSheet();
  },
  'chord-pop'(el) { app.chordPop = app.chordPop === el.dataset.v ? null : el.dataset.v; renderSheet(); },
  'chord-pop-close'() { app.chordPop = null; renderSheet(); },
  'sheet-marks'() {
    app.marking = !app.marking;
    app.markEdit = null;
    if (app.marking && !app.me) toast('Choisis ton profil pour signer tes repères');
    renderSheet();
  },
  'mark-add'(el) {
    app.markEdit = { li: Number(el.dataset.li), id: null };
    app.drafts['mk.text'] = '';
    renderSheet();
    setTimeout(() => { const t = $('#mkText'); if (t) t.focus({ preventScroll: true }); }, 30);
  },
  'mark-edit'(el) {
    const song = D('songs')[app.sheet && app.sheet.id];
    const m = song && (song.marks || {})[el.dataset.id];
    if (!m) return;
    app.markEdit = { li: Number(el.dataset.li), id: el.dataset.id };
    app.drafts['mk.text'] = m.text;
    renderSheet();
    setTimeout(() => { const t = $('#mkText'); if (t) t.focus({ preventScroll: true }); }, 30);
  },
  'mark-save'() {
    const song = D('songs')[app.sheet && app.sheet.id];
    const me = app.markEdit;
    if (!song || !me) return;
    const text = draft('mk.text').trim().slice(0, 80);
    app.markEdit = null;
    delete app.drafts['mk.text'];
    if (!text) { if (me.id) commitUndoable([{ op: 'del', path: ['songs', song.id, 'marks', me.id] }], 'Repère supprimé'); else renderSheet(); return; }
    if (me.id) { commit([{ op: 'set', path: ['songs', song.id, 'marks', me.id, 'text'], value: text }]); return; }
    const lines = cpParse(sheetBase(song).text || '');
    const value = { at: me.li, snap: normTxt(lineText(lines[me.li])), text, by: app.me || '', ts: Date.now() };
    commit([{ op: 'set', path: ['songs', song.id, 'marks', newId('k')], value }]);
  },
  'mark-del'() {
    const song = D('songs')[app.sheet && app.sheet.id];
    const me = app.markEdit;
    if (!song || !me || !me.id) return;
    app.markEdit = null;
    commitUndoable([{ op: 'del', path: ['songs', song.id, 'marks', me.id] }], 'Repère supprimé');
  },
  'mark-cancel'() { app.markEdit = null; renderSheet(); },
  'kara-start'() {
    const song = D('songs')[app.sheet && app.sheet.id];
    if (!song) return;
    Object.assign(kara, { id: song.id, t: 0, run: true, last: performance.now() });
    renderSheet();
  },
  'kara-pause'() { kara.run = !kara.run; kara.last = performance.now(); renderSheet(); },
  'kara-nudge'(el) { kara.t = Math.max(0, kara.t + Number(el.dataset.v)); },
  'kara-stop'() { kara.id = null; renderSheet(); },

  'cp-reset'() {
    const ed = app.cpEdit;
    const song = ed && D('songs')[ed.id];
    if (!song) return;
    app.cpEdit = null;
    commitUndoable([{ op: 'del', path: ['songs', song.id, 'sheet'] }], 'Notre version effacée');
  },
  'parts-edit'() {
    const song = D('songs')[app.sheet.id];
    if (!song) return;
    clearDrafts('parts.');
    app.partsEdit = song.id;
    renderSheet();
  },
  'parts-cancel'() { clearDrafts('parts.'); app.partsEdit = null; renderSheet(); },
  'parts-save'() {
    const song = D('songs')[app.partsEdit];
    if (!song) return;
    const parts = {};
    MEMBERS.forEach((m) => { const v = draft('parts.' + m.id, (song.parts || {})[m.id] || '').trim().slice(0, 140); if (v) parts[m.id] = v; });
    clearDrafts('parts.');
    app.partsEdit = null;
    commit([{ op: 'set', path: ['songs', song.id, 'parts'], value: parts }, ...logOps(`a noté qui fait quoi sur « ${song.title} »`, 'parts:' + song.id)]);
  },
  'chart-cancel'() { if (app.chartEdit) delete app.drafts['chart.' + app.chartEdit]; app.chartEdit = null; renderSheet(); },
  'chart-save'() {
    const song = D('songs')[app.chartEdit];
    if (!song) return;
    const text = draft('chart.' + song.id).replace(/\s+$/, '').slice(0, 8000);
    delete app.drafts['chart.' + song.id];
    app.chartEdit = null;
    if (text === (song.chart || '')) { renderSheet(); return; }
    commit([{ op: 'set', path: ['songs', song.id, 'chart'], value: text }, ...(text ? logOps(`a mis à jour la grille de « ${song.title} »`, 'chart:' + song.id) : [])]);
    toast(text ? 'Grille enregistrée' : 'Grille effacée');
  },
  async 'note-del'(el) {
    const n = D('notes')[el.dataset.id];
    if (!n) return;
    if (n.by !== app.me && !(await askConfirm(`Supprimer la note de ${memberName(n.by)} ?`))) return;
    commitUndoable([{ op: 'del', path: ['notes', n.id] }], 'Note supprimée');
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
    Object.assign(app.drafts, { 'gig.name': g.name, 'gig.date': g.date || '', 'gig.target': g.target ? String(g.target) : '' });
    openSheet({ type: 'gig', id: g.id });
  },
  'gig-save'() {
    const name = draft('gig.name').trim();
    if (!name) { toast('Donne un nom au concert'); return; }
    const date = draft('gig.date');
    const target = Math.max(0, Math.min(600, parseInt(draft('gig.target'), 10) || 0));
    const id = app.sheet.id;
    if (id) {
      commit([{ op: 'set', path: ['gigs', id, 'name'], value: name }, { op: 'set', path: ['gigs', id, 'date'], value: date || '' }, { op: 'set', path: ['gigs', id, 'target'], value: target }]);
    } else {
      const nid = newId('g');
      setGig(nid);
      commit([{ op: 'set', path: ['gigs', nid], value: { id: nid, name, date: date || '', target, songs: [], gear: {}, items: {}, by: app.me, ts: Date.now() } }, ...logOps(`a créé la setlist « ${name} »`)]);
      toast('Setlist créée');
    }
    clearDrafts('gig.');
    closeSheet();
  },
  async 'gig-delete'() {
    const g = D('gigs')[app.sheet.id];
    if (!g || !(await askConfirm(`Supprimer le concert « ${g.name} », sa setlist et sa liste de matos ?`))) return;
    closeSheet();
    commitUndoable([{ op: 'del', path: ['gigs', g.id] }], 'Concert supprimé');
  },
  'pick-gig'(el) { setGig(el.dataset.id); renderView(); },
  'open-gig'(el) {
    if (!D('gigs')[el.dataset.id]) return;
    setGig(el.dataset.id);
    closeSheet();
    app.tab = 'setlist';
    LS.set('hy.tab', app.tab);
    renderTabs(); renderView();
    window.scrollTo({ top: 0 });
  },
  'pick-songs'() { delete app.drafts['pick.q']; openSheet({ type: 'pick-songs' }); },
  'toggle-gig-song'(el) {
    const g = D('gigs')[app.gigId];
    if (!g) return;
    const list = (g.songs || []).slice();
    const i = list.indexOf(el.dataset.id);
    if (i >= 0) list.splice(i, 1); else list.push(el.dataset.id);
    const song = D('songs')[el.dataset.id];
    const log = i < 0 && song ? logOps(`a ajouté « ${song.title} » à la setlist « ${g.name} »`, 'gs:' + g.id, `a ajouté des morceaux à la setlist « ${g.name} »`) : [];
    commit([{ op: 'set', path: ['gigs', g.id, 'songs'], value: list }, ...log]);
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
    const songs = D('songs');
    const a = (songs[app.sheet.from] || {}).title || '', b = (songs[app.sheet.to] || {}).title || '';
    commit([{ op: 'set', path: ['gigs', g.id, 'transitions', key], value: { title, text, by: app.me, ts: Date.now() } }, ...logOps(`a noté la transition entre « ${a} » et « ${b} »`, 'tr:' + key)]);
    clearDrafts('tr.');
    closeSheet();
  },
  async 'transition-delete'() {
    const g = currentGig();
    if (!g || !(await askConfirm('Supprimer cette transition ?'))) return;
    const key = app.sheet.from + '__' + app.sheet.to;
    closeSheet();
    commitUndoable([{ op: 'del', path: ['gigs', g.id, 'transitions', key] }], 'Transition supprimée');
  },
  'gig-remove-song'(el) {
    const g = currentGig();
    if (!g) return;
    const id = el.dataset.id;
    const ops = [{ op: 'set', path: ['gigs', g.id, 'songs'], value: (g.songs || []).filter((x) => x !== id) }];
    if ((g.items || {})[id]) ops.push({ op: 'del', path: ['gigs', g.id, 'items', id] });
    const name = (D('songs')[id] || (g.items || {})[id] || {}).title || 'Élément';
    commitUndoable(ops, `${name} retiré de la setlist`);
  },
  'new-item'() {
    if (!currentGig()) return;
    clearDrafts('item.');
    openSheet({ type: 'item', id: null });
  },
  'edit-item'(el) {
    const g = currentGig();
    const it = g && (g.items || {})[el.dataset.id];
    if (!it) return;
    clearDrafts('item.');
    Object.assign(app.drafts, { 'item.title': it.title || '', 'item.dur': String(it.dur || ''), 'item.note': it.note || '' });
    openSheet({ type: 'item', id: it.id });
  },
  'item-preset'(el) { app.drafts['item.title'] = el.dataset.v; renderSheet(); },
  'item-save'() {
    const g = currentGig();
    if (!g) return;
    const title = draft('item.title').trim();
    if (!title) { toast('Donne un intitulé'); return; }
    const fields = { title, dur: Math.max(0, Math.min(60, parseInt(draft('item.dur', '1'), 10) || 0)), note: draft('item.note').trim() };
    if (app.sheet.id) {
      commit(Object.entries(fields).map(([k, v]) => ({ op: 'set', path: ['gigs', g.id, 'items', app.sheet.id, k], value: v })));
    } else {
      const id = newId('x');
      commit([
        { op: 'set', path: ['gigs', g.id, 'items', id], value: { id, ...fields } },
        { op: 'set', path: ['gigs', g.id, 'songs'], value: [...(g.songs || []), id] },
      ]);
      toast('Ajouté en fin de setlist : fais-le glisser à sa place');
    }
    clearDrafts('item.');
    closeSheet();
  },
  'item-delete'() {
    const g = currentGig();
    const id = app.sheet.id;
    if (!g || !id) return;
    closeSheet();
    commitUndoable([
      { op: 'set', path: ['gigs', g.id, 'songs'], value: (g.songs || []).filter((x) => x !== id) },
      { op: 'del', path: ['gigs', g.id, 'items', id] },
    ], 'Intermède supprimé');
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
  'repeat-avail'(el) {
    const iso = app.calSel;
    if (!app.me || !iso || iso < todayISO()) return;
    const on = el.dataset.v === 'on';
    const wd = fmtWeekday.format(parseISO(iso));
    const ops = [];
    for (let w = 0; w < 13; w++) {
      const d = addDays(iso, 7 * w);
      const has = availOn(d).includes(app.me);
      if (on && !has) ops.push({ op: 'set', path: ['avail', d, app.me], value: true });
      if (!on && has) ops.push({ op: 'del', path: ['avail', d, app.me] });
    }
    if (!ops.length) { toast(on ? `Tu es déjà dispo tous les ${wd}s` : `Rien à enlever`); return; }
    commit([...ops, ...logOps(on ? `est dispo tous les ${wd}s` : `n’est plus dispo les ${wd}s`, 'rep:' + wd)]);
    toast(on ? `Dispo tous les ${wd}s jusqu’au ${fmtShort.format(parseISO(addDays(iso, 84)))}` : `Plus dispo les ${wd}s`);
  },
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
    Object.assign(app.drafts, { 'ev.type': e.type || 'repet', 'ev.title': e.title || '', 'ev.date': e.date, 'ev.time': e.time || '', 'ev.place': e.place || '', 'ev.notes': e.notes || '', 'ev.gig': e.gigId || '' });
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
      gigId: draft('ev.type', 'repet') === 'concert' && D('gigs')[draft('ev.gig')] ? draft('ev.gig') : '',
    };
    // La setlist prend la date du concert si elle n'en a pas.
    const g = D('gigs')[fields.gigId];
    const gigDate = g && !g.date ? [{ op: 'set', path: ['gigs', g.id, 'date'], value: date }] : [];
    if (app.sheet.id) {
      const id = app.sheet.id;
      commit([...Object.entries(fields).map(([k, v]) => ({ op: 'set', path: ['events', id, k], value: v })), ...gigDate]);
      app.sheet.edit = false;
      renderSheet();
    } else {
      const id = newId('e');
      const when = fmtDay.format(parseISO(date)) + (fields.time ? ' à ' + fmtTime(fields.time) : '');
      commit([{ op: 'set', path: ['events', id], value: { id, ...fields, by: app.me, ts: Date.now() } }, ...gigDate, ...logOps(`a calé ${fields.type === 'concert' ? 'un concert' : 'une répète'} le ${when}`)]);
      closeSheet();
      toast(fields.type === 'concert' ? 'Concert calé' : 'Répète calée');
    }
    clearDrafts('ev.');
  },
  async 'event-delete'() {
    const e = D('events')[app.sheet.id];
    if (!e || !(await askConfirm('Supprimer cette date pour tout le monde ?'))) return;
    closeSheet();
    commitUndoable([{ op: 'del', path: ['events', e.id] }], 'Date supprimée');
  },
  'toggle-past'() { app.showPast = !app.showPast; renderView(); },
  'ics-offline'() { toast('L’ajout à l’agenda marche sur le site en ligne'); },

  /* Mode scène, impression */
  'stage-open'() {
    const g = currentGig();
    if (!g || !gigEntries(g).length) { toast('La setlist est vide'); return; }
    stageStart({ gigId: g.id });
  },
  'prog-add'(el) { const id = el.dataset.id; progSet(el.dataset.ev, (l) => (l.includes(id) ? l : [...l, id])); },
  'prog-del'(el) { const id = el.dataset.id; progSet(el.dataset.ev, (l) => l.filter((x) => x !== id)); },
  'prog-add-all'(el) {
    const ev = D('events')[el.dataset.id];
    if (!ev) return;
    const add = progSuggest(ev).map((x) => x.s.id);
    progSet(ev.id, (l) => [...l, ...add.filter((id) => !l.includes(id))]);
  },
  'pick-prog'(el) { delete app.drafts['pick.q']; openSheet({ type: 'pick-prog', id: el.dataset.id }); },
  'toggle-prog-song'(el) {
    const id = el.dataset.id;
    progSet(app.sheet.id, (l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  },
  'pick-prog-done'() { openSheet({ type: 'event', id: app.sheet.id }); },
  'stage-prog'(el) {
    const ev = D('events')[el.dataset.id];
    if (!ev || !(ev.prog || []).some((id) => D('songs')[id])) { toast('Le programme est vide'); return; }
    closeSheet();
    stageStart({ evId: ev.id });
  },
  'stage-sync'() {
    const st = app.stage;
    if (!st) return;
    if (app.mode === 'local') { toast('La synchro marche sur le site en ligne'); return; }
    st.sync = !st.sync;
    st.joined = false;
    LS.set('hy.stageSync', st.sync);
    toast(st.sync ? 'Synchro : tu suis le groupe' : 'Synchro coupée : tu avances seul');
    renderStage();
    if (st.sync) livePull();
  },
  'stage-exit'() { stageExit(); },
  'stage-side'() { if (app.stage) { app.stage.side = !app.stage.side; renderStage(); } },
  'stage-jump'(el) {
    const st = app.stage;
    if (!st) return;
    const i = Number(el.dataset.i);
    if (window.innerWidth < 900) st.side = false;
    if (i === st.idx) renderStage(); else stageGo(i - st.idx);
  },
  'stage-go'(el) { stageGo(Number(el.dataset.v)); },
  'stage-click'() {
    const ids = stageIds();
    const s = app.stage && D('songs')[ids[app.stage.idx]];
    if (s && s.bpm) metro.toggle(s.id, s.bpm);
  },
  'stage-auto'() {
    if (!app.stage) return;
    app.stage.auto = !app.stage.auto;
    LS.set('hy.stageAuto', app.stage.auto);
    const s = D('songs')[stageIds()[app.stage.idx]];
    if (app.stage.auto && s && s.bpm && !(metro.playing && metro.songId === s.id)) metro.start(s.id, s.bpm);
    else renderStage();
  },
  'stage-scroll'() {
    const st = app.stage;
    if (!st) return;
    if (!st.scroll) { st.scroll = true; st.paused = false; st.scrollStart = performance.now() + 600; st.armed = stageIds()[st.idx]; LS.set('hy.stageScroll', true); }
    else if (st.paused) { st.paused = false; st.scrollStart = 0; }
    else { st.scroll = false; LS.set('hy.stageScroll', false); }
    renderStage();
  },
  'scroll-speed'(el) {
    const s = app.stage && D('songs')[stageIds()[app.stage.idx]];
    if (!s) return;
    const v = Math.round(Math.max(0.4, Math.min(2.5, (Number(s.scrollx) || 1) + Number(el.dataset.v) * 0.1)) * 10) / 10;
    commit([{ op: 'set', path: ['songs', s.id, 'scrollx'], value: v }]);
  },
  'stage-zoom'(el) {
    const st = app.stage;
    if (!st) return;
    st.zoom = Math.round(Math.max(0.7, Math.min(1.9, (st.zoom || 1) + Number(el.dataset.v) * 0.1)) * 10) / 10;
    LS.set('hy.stageZoom', st.zoom);
    renderStage();
  },
  'stage-lock'() { if (app.stage) { app.stage.locked = true; renderStage(); } },
  'stage-chrono'() {
    const st = app.stage;
    if (!st) return;
    if (st.t0) { st.acc = chronoElapsed(st); st.t0 = 0; } else st.t0 = Date.now();
    renderStage();
  },
  'stage-lyrics'() {
    if (!app.stage) return;
    app.stage.lyrics = !app.stage.lyrics;
    LS.set('hy.stageSheet', app.stage.lyrics);
    renderStage();
  },
  'print-setlist'() { printSetlist(); },
  'shift'(el) {
    const song = app.sheet && D('songs')[app.sheet.id];
    if (!song) return;
    let v = (Number(song.shift) || 0) + Number(el.dataset.v);
    if (v > 11) v -= 12;
    if (v < -11) v += 12;
    commit([{ op: 'set', path: ['songs', song.id, 'shift'], value: v }]);
  },
  'sheet-retry'() {
    const s = (app.sheet && app.sheet.type === 'song' && D('songs')[app.sheet.id]) || (app.stage && D('songs')[stageIds()[app.stage.idx]]);
    if (s) { loadSheet(s, true); renderSheet(); renderStage(); }
  },
  'lyrics-retry'() {
    const s = (app.sheet && app.sheet.type === 'song' && D('songs')[app.sheet.id]) || (app.stage && D('songs')[stageIds()[app.stage.idx]]);
    if (s) { loadLyrics(s, true); renderSheet(); renderStage(); }
  },

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
      commit([{ op: 'set', path: ['gear', id], value: { id, ...fields, ts: Date.now() } }, ...logOps(`a ajouté « ${name} » à l’inventaire`, 'gear-add', 'a ajouté du matos à l’inventaire')]);
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
    if (!x || !(await askConfirm(`Supprimer « ${x.name} » de l’inventaire ?`))) return;
    const ops = [{ op: 'del', path: ['gear', x.id] }];
    Object.values(D('gigs')).forEach((g) => { if (g.gear && x.id in g.gear) ops.push({ op: 'del', path: ['gigs', g.id, 'gear', x.id] }); });
    closeSheet();
    commitUndoable(ops, `${x.name} supprimé de l’inventaire`);
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
  'open-profile'() { delete app.drafts['me.role']; openSheet({ type: 'profile' }); loadBackups(); },
  'backup-download'() {
    const body = JSON.stringify({ app: 'hysteria', at: new Date().toISOString(), data: app.view }, null, 1);
    downloadBlob(new Blob([body], { type: 'application/json' }), `hysteria-sauvegarde-${todayISO()}.json`);
  },
  async 'backup-restore'(el) {
    const day = el.dataset.day;
    try {
      const r = await fetch(API + '?backup=' + encodeURIComponent(day), { headers: headers(), cache: 'no-store' });
      const res = await r.json();
      if (!r.ok || !res.data) throw new Error();
      restoreData(res.data, `au début du ${fmtDay.format(parseISO(day))}`);
    } catch { toast('Copie introuvable'); }
  },
  'gig-image'() {
    const g = currentGig();
    if (!g || !gigEntries(g).some((e) => e.song)) { toast('Ajoute des morceaux d’abord'); return; }
    openSheet({ type: 'gig-image' });
  },
  'img-opt'(el) {
    const o = imgOpts();
    if (el.dataset.k === 'artists') o.artists = !o.artists; else o[el.dataset.k] = el.dataset.v;
    LS.set('hy.img', o);
    renderSheet();
  },
  'img-save'() { if (app.img) downloadBlob(app.img.blob, app.img.name); },
  async 'img-share'() {
    const im = app.img;
    if (!im) return;
    const file = new File([im.blob], im.name, { type: 'image/png' });
    if (!PREVIEW && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: im.title }); } catch (e) { if (!e || e.name !== 'AbortError') downloadBlob(im.blob, im.name); }
    } else downloadBlob(im.blob, im.name);
  },
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
  if (e.target.closest('a[href]')) return; // un vrai lien (appel, e-mail, écoute) n'ouvre pas la ligne autour
  if (drag.justEnded && Date.now() - drag.justEnded < 350) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn || el.tagName === 'A') return;
  e.preventDefault();
  fn(el, e);
});

document.addEventListener('keydown', (e) => {
  if (app.stage) {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); stageExit(); return; }
    if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(k)) { e.preventDefault(); stageGo(1); return; }
    if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(k)) { e.preventDefault(); stageGo(-1); return; }
  }
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
  if (t.dataset.file === 'backup' && e.type === 'change') {
    const f = t.files && t.files[0];
    t.value = '';
    if (!f) return;
    f.text().then((txt) => { let d = null; try { d = JSON.parse(txt); } catch {} restoreData(d, `dans le fichier « ${f.name} »`); });
    return;
  }
  if (t.dataset.draft) app.drafts[t.dataset.draft] = t.value;
  if (t.dataset.draft === 'song.search' && e.type === 'input') { querySuggest(t.value); renderSheet(); return; }
  if (t.dataset.bind === 'query') { app.query = t.value; renderView(); }
  if (t.dataset.rerender !== undefined) renderSheet();
  if (t.dataset.commit && e.type === 'change' && actions[t.dataset.commit]) actions[t.dataset.commit](t);
}
document.addEventListener('input', onField);
// Une pochette qui ne charge pas laisse place aux initiales.
document.addEventListener('error', (e) => { if (e.target && e.target.classList && e.target.classList.contains('cov-img')) e.target.remove(); }, true);
document.addEventListener('change', onField);

// Mode scène : glisser à gauche ou à droite pour changer de morceau.
const swipe = { x: null };
$('#stage').addEventListener('pointerdown', (e) => {
  const hold = e.target.closest('[data-hold="unlock"]');
  if (hold) {
    hold.classList.add('holding');
    clearTimeout(swipe.hold);
    swipe.hold = setTimeout(() => { if (app.stage) { app.stage.locked = false; renderStage(); } }, 800);
    return;
  }
  if ((app.stage && app.stage.locked) || e.target.closest('button')) { swipe.x = null; return; }
  Object.assign(swipe, { x: e.clientX, y: e.clientY, t: Date.now() });
});
const endHold = () => { clearTimeout(swipe.hold); document.querySelectorAll('.holding').forEach((b) => b.classList.remove('holding')); };
$('#stage').addEventListener('pointerup', (e) => {
  endHold();
  if (swipe.x == null) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  swipe.x = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - swipe.t < 900) { stageGo(dx < 0 ? 1 : -1); return; }
  // Un simple tap sur la grille met le défilement en pause (ou le relance).
  const st = app.stage;
  if (st && st.scroll && Math.abs(dx) < 8 && Math.abs(dy) < 8 && e.target.closest('.st-body') && !e.target.closest('button, a')) {
    st.paused = !st.paused;
    if (!st.paused) st.scrollStart = 0;
    renderStage();
  }
});
$('#stage').addEventListener('pointercancel', () => { swipe.x = null; endHold(); });
$('#stage').addEventListener('pointerleave', endHold);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && app.stage) keepAwake(true); });

// Plan de scène : on fait glisser les éléments (souris ou doigt).
const pdrag = { g: null };
const tdrag = { el: null };
const rdrag = { g: null };
function svgPoint(svg, cx, cy) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest ? e.target : null;
  if (!t) return;
  // Glisser un élément de la liste vers la scène.
  const tray = t.closest('[data-tray-id]');
  if (tray) {
    e.preventDefault();
    Object.assign(tdrag, { el: tray, id: tray.dataset.trayId, sx: e.clientX, sy: e.clientY, moved: false, ghost: null });
    return;
  }
  const handle = t.closest('.plot.edit [data-plot-handle]');
  if (handle) {
    if (handle.dataset.plotHandle !== 'resize') return; // retirer / renommer : géré par le clic
    e.preventDefault();
    const g = handle.closest('[data-plot-id]');
    const it = plotItems().find((x) => x.id === g.dataset.plotId);
    const c = g.getBoundingClientRect ? g.querySelector('.pi-body').getBoundingClientRect() : null;
    if (!it || !c) return;
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    Object.assign(rdrag, { g, it, cx, cy, d0: Math.max(10, Math.hypot(e.clientX - cx, e.clientY - cy)), s0: it.s, s: it.s });
    try { handle.setPointerCapture(e.pointerId); } catch {}
    return;
  }
  const g = t.closest('.plot.edit [data-plot-id]');
  if (!g) {
    if (t.closest('.plot.edit') && app.plotSel) { app.plotSel = null; renderView(); }
    return;
  }
  const it = plotItems().find((x) => x.id === g.dataset.plotId);
  const ctm = g.ownerSVGElement && g.ownerSVGElement.getScreenCTM();
  if (!it || !ctm) return;
  e.preventDefault();
  const [hw, hh] = plotHalf(it);
  Object.assign(pdrag, { g, id: it.id, kind: it.kind, x0: it.x, y0: it.y, x: it.x, y: it.y, sx: e.clientX, sy: e.clientY, k: ctm.a || 1, moved: false, hw, hh });
  try { g.setPointerCapture(e.pointerId); } catch {}
});
document.addEventListener('pointermove', (e) => {
  if (rdrag.g) {
    const d = Math.hypot(e.clientX - rdrag.cx, e.clientY - rdrag.cy);
    const sNew = Math.max(0.5, Math.min(3, rdrag.s0 * (d / rdrag.d0)));
    rdrag.s = sNew;
    rdrag.g.querySelector('.pi-body').setAttribute('transform', `scale(${r1(sNew * 100) / 100})`);
    rdrag.g.querySelectorAll('.ph').forEach((h) => h.setAttribute('transform', `translate(${r1(h.dataset.cx * sNew)} ${r1(h.dataset.cy * sNew)})`));
    return;
  }
  if (tdrag.el) {
    if (!tdrag.moved && Math.hypot(e.clientX - tdrag.sx, e.clientY - tdrag.sy) < 6) return;
    if (!tdrag.ghost) {
      tdrag.moved = true;
      tdrag.ghost = tdrag.el.cloneNode(true);
      tdrag.ghost.classList.add('tray-ghost');
      document.body.appendChild(tdrag.ghost);
    }
    tdrag.ghost.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 18}px)`;
    return;
  }
  if (!pdrag.g) return;
  const dx = e.clientX - pdrag.sx, dy = e.clientY - pdrag.sy;
  if (!pdrag.moved && Math.hypot(dx, dy) < 4) return;
  pdrag.moved = true;
  const p = clampPlot(pdrag.kind, pdrag.x0 + dx / pdrag.k, pdrag.y0 + dy / pdrag.k, pdrag.hw, pdrag.hh);
  pdrag.x = p.x;
  pdrag.y = p.y;
  pdrag.g.setAttribute('transform', `translate(${r1(p.x)} ${r1(p.y)})`);
});
function endPlotDrag() {
  if (!pdrag.g) return;
  const { id, moved, x, y } = pdrag;
  pdrag.g = null;
  if (moved) { app.plotSel = id; plotSave(id, { x: r1(x), y: r1(y) }); }
  else { app.plotSel = app.plotSel === id ? null : id; renderView(); }
}
document.addEventListener('pointerup', (e) => {
  if (rdrag.g) {
    const { it, s: sNew } = rdrag;
    rdrag.g = null;
    const [hw, hh] = plotHalf({ ...it, s: sNew });
    const p = clampPlot(it.kind, it.x, it.y, hw, hh);
    plotSave(it.id, { s: Math.round(sNew * 100) / 100, x: r1(p.x), y: r1(p.y) });
    return;
  }
  if (tdrag.el) {
    const { id, moved, ghost } = tdrag;
    tdrag.el = null;
    if (ghost) ghost.remove();
    const svg = document.querySelector('.plot.edit');
    const x = (D('gear') || {})[id];
    if (!svg || !x) return;
    let pt;
    if (moved) {
      const r = svg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      pt = svgPoint(svg, e.clientX, e.clientY);
    } else pt = { x: STAGE_R.x + STAGE_R.w / 2, y: STAGE_R.y + STAGE_R.h / 2 }; // simple tap : au centre de la scène
    if (!pt) return;
    const it = { kind: 'gear', s: 1, name: x.name };
    const [hw, hh] = plotHalf(it);
    const p = clampPlot('gear', pt.x, pt.y, hw, hh);
    app.plotSel = 'g_' + id;
    plotSave('g_' + id, { x: r1(p.x), y: r1(p.y), s: 1 });
    return;
  }
  endPlotDrag();
});
document.addEventListener('pointercancel', () => {
  if (tdrag.ghost) tdrag.ghost.remove();
  tdrag.el = null;
  rdrag.g = null;
  endPlotDrag();
});

/* ================= Démarrage ================= */
if (PREVIEW) $('#previewBanner').hidden = false;
applyTheme();
renderAll();
if (PREVIEW || location.protocol === 'file:') goLocal();
else {
  pull().then(() => { if (app.pending.length) push(); });
  setInterval(() => { if (document.visibilityState === 'visible') { pull(); renderNextLine(); } }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  window.addEventListener('online', () => { push(); pull(); });
}
