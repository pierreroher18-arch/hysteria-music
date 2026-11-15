import { getStore } from '@netlify/blobs';
import { applyOps, seedState } from '../../public/shared.mjs';

const KEY = 'state-v1';
const LIVE = 'live-v1'; // morceau en cours en mode scène, pour que les téléphones se suivent
const BACKUP = 'backup/'; // une copie par jour, gardée 30 jours
const KEEP = 30;
const MAX_OPS = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
let backedUp = '';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function etagFromList(store) {
  const { blobs } = await store.list({ prefix: KEY });
  const b = blobs.find((x) => x.key === KEY);
  return b ? b.etag : undefined;
}

async function getEntry(store) {
  const e = await store.getWithMetadata(KEY, { type: 'json' });
  if (!e || e.etag) return e;
  // Repli si la lecture ne renvoie pas d'ETag : on le lit via list(), avant et après.
  for (let i = 0; i < 5; i++) {
    const a = await etagFromList(store);
    const data = await store.get(KEY, { type: 'json' });
    const b = await etagFromList(store);
    if (a && a === b && data) return { data, etag: a };
  }
  return e;
}

async function readState(store) {
  let entry = await getEntry(store);
  if (!entry) {
    await store.setJSON(KEY, seedState(), { onlyIfNew: true });
    entry = await getEntry(store);
  }
  return entry;
}

// Copie du jour : l'état tel qu'il était avant la première modification de la journée.
async function dailyBackup(store, data) {
  const day = today();
  if (backedUp === day) return;
  try {
    await store.setJSON(BACKUP + day, data, { onlyIfNew: true });
    backedUp = day;
    const { blobs } = await store.list({ prefix: BACKUP });
    const old = blobs.map((b) => b.key).sort().reverse().slice(KEEP);
    for (const k of old) await store.delete(k);
  } catch {}
}

const cleanLive = (v) => (v && typeof v === 'object' ? {
  src: String(v.src || '').slice(0, 60),
  id: String(v.id || '').slice(0, 60),
  i: Math.max(0, Math.min(999, Math.round(Number(v.i) || 0))),
  by: String(v.by || '').slice(0, 20),
  k: String(v.k || '').slice(0, 30),
  t: Number(v.t) || Date.now(),
} : null);

export default async (req) => {
  const store = getStore({ name: 'hysteria', consistency: 'strong' });
  const q = new URL(req.url).searchParams;

  if (req.method === 'GET' && q.has('live')) {
    return json({ live: (await store.get(LIVE, { type: 'json' })) || null });
  }
  if (req.method === 'GET' && q.has('backups')) {
    const { blobs } = await store.list({ prefix: BACKUP });
    return json({ backups: blobs.map((b) => b.key.slice(BACKUP.length)).filter((d) => DAY.test(d)).sort().reverse() });
  }
  if (req.method === 'GET' && q.has('backup')) {
    const day = q.get('backup') || '';
    const data = DAY.test(day) ? await store.get(BACKUP + day, { type: 'json' }) : null;
    return data ? json({ day, data }) : json({ error: 'introuvable' }, 404);
  }

  if (req.method === 'GET') {
    const entry = await readState(store);
    const known = new URL(req.url).searchParams.get('rev');
    if (known && known === entry.etag) return json({ same: true, rev: entry.etag });
    return json({ rev: entry.etag, data: entry.data });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'json' }, 400);
    }
    if (body && body.live) {
      const live = cleanLive(body.live);
      if (!live.src) return json({ error: 'live' }, 400);
      await store.setJSON(LIVE, live);
      return json({ ok: true });
    }
    const ops = Array.isArray(body && body.ops) ? body.ops.slice(0, MAX_OPS) : [];

    // Lecture → modification → écriture conditionnelle (si personne n'a écrit entre-temps).
    for (let attempt = 0; attempt < 8; attempt++) {
      const entry = await readState(store);
      const before = JSON.stringify(entry.data);
      const next = applyOps(entry.data, ops);
      const res = await store.setJSON(KEY, next, { onlyIfMatch: entry.etag });
      if (res.modified) {
        if (ops.length) await dailyBackup(store, JSON.parse(before));
        return json({ rev: res.etag, data: next });
      }
      await sleep(40 + Math.random() * 120 * (attempt + 1));
    }
    return json({ error: 'busy' }, 409);
  }

  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/state' };
