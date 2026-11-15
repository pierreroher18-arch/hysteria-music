// Paroles d'un morceau, cherchées à la demande dans LRCLIB (base de paroles libre et gratuite).
// Rien n'est enregistré dans les données du groupe : on les redemande quand on les affiche.

const API = 'https://lrclib.net/api';
const UA = 'Hysteria, appli de groupe (Netlify)';

const json = (body, status = 200, cache = 'public, max-age=86400') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache },
  });

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function call(path) {
  const r = await fetch(API + path, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('lrclib ' + r.status);
  return r.json();
}

const usable = (t) => t && (t.instrumental || (typeof t.plainLyrics === 'string' && t.plainLyrics.trim()));

function best(list, artist, title) {
  if (!Array.isArray(list)) return null;
  const a = norm(artist), ti = norm(title);
  const ok = list.filter(usable);
  return ok.find((t) => norm(t.artistName).includes(a.split(' ')[0] || a) && norm(t.trackName).startsWith(ti))
    || ok.find((t) => norm(t.artistName).includes(a.split(' ')[0] || a))
    || null;
}

export default async (req) => {
  const code = process.env.BAND_CODE;
  if (code && req.headers.get('x-band-code') !== code) return json({ error: 'code' }, 401, 'no-store');

  const p = new URL(req.url).searchParams;
  const title = (p.get('title') || '').trim().slice(0, 150);
  const artist = (p.get('artist') || '').trim().slice(0, 150);
  const duration = Number(p.get('duration'));
  if (!title || !artist) return json({ found: false }, 400, 'no-store');

  const q = (o) => '?' + new URLSearchParams(o).toString();
  try {
    let t = null;
    if (duration >= 1 && duration <= 3600) {
      t = await call('/get' + q({ track_name: title, artist_name: artist, duration: String(Math.round(duration)) }));
      if (!usable(t)) t = null;
    }
    if (!t) t = best(await call('/search' + q({ track_name: title, artist_name: artist })), artist, title);
    if (!t) t = best(await call('/search' + q({ q: `${artist} ${title}` })), artist, title);
    if (!t) return json({ found: false }, 200, 'public, max-age=3600');
    return json({
      found: true,
      instrumental: !!t.instrumental,
      lyrics: t.instrumental ? '' : String(t.plainLyrics || '').slice(0, 20000),
      track: t.trackName || title,
      artist: t.artistName || artist,
      source: 'LRCLIB',
    });
  } catch {
    return json({ found: false, error: 'source' }, 502, 'no-store');
  }
};

export const config = { path: '/api/lyrics' };
