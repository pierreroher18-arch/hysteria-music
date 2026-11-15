import { getStore } from '@netlify/blobs';
import { applyOps, seedState } from '../../public/shared.mjs';

const KEY = 'state-v1';
const MAX_OPS = 200;

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

export default async (req) => {
  // Code d'accès optionnel : définir la variable BAND_CODE dans Netlify.
  const code = process.env.BAND_CODE;
  if (code && req.headers.get('x-band-code') !== code) {
    return json({ error: 'code' }, 401);
  }

  const store = getStore({ name: 'hysteria', consistency: 'strong' });

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
    const ops = Array.isArray(body && body.ops) ? body.ops.slice(0, MAX_OPS) : [];

    // Lecture → modification → écriture conditionnelle (si personne n'a écrit entre-temps).
    for (let attempt = 0; attempt < 8; attempt++) {
      const entry = await readState(store);
      const next = applyOps(entry.data, ops);
      const res = await store.setJSON(KEY, next, { onlyIfMatch: entry.etag });
      if (res.modified) return json({ rev: res.etag, data: next });
      await sleep(40 + Math.random() * 120 * (attempt + 1));
    }
    return json({ error: 'busy' }, 409);
  }

  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/state' };
