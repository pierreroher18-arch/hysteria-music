// Recherche de morceaux (titre, artiste, pochette, durée) pour les suggestions
// et les pochettes. Deezer d'abord, iTunes en secours. Aucune clé nécessaire.

const json = (body, status = 200, cache = 'public, max-age=3600') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache },
  });

const https = (u) => (typeof u === 'string' && u.startsWith('https://') ? u : '');

async function fromDeezer(q, limit) {
  const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${Math.min(50, limit * 2)}`, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('deezer ' + r.status);
  const j = await r.json();
  if (!j || !Array.isArray(j.data)) throw new Error('deezer shape');
  return j.data.map((t) => ({
    title: t.title_short || t.title || '',
    artist: (t.artist && t.artist.name) || '',
    album: (t.album && t.album.title) || '',
    cover: https(t.album && (t.album.cover_medium || t.album.cover_big)),
    duration: Number(t.duration) || null,
  })).filter((x) => x.title);
}

async function fromItunes(q, limit) {
  const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=${Math.min(50, limit * 2)}&country=FR`, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('itunes ' + r.status);
  const j = await r.json();
  return (j.results || []).map((t) => ({
    title: t.trackName || '',
    artist: t.artistName || '',
    album: t.collectionName || '',
    cover: https((t.artworkUrl100 || '').replace('100x100bb', '300x300bb')),
    duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
  })).filter((x) => x.title);
}

export default async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 6));
  if (q.length < 2) return json({ results: [] });

  for (const source of [fromDeezer, fromItunes]) {
    try {
      // On enlève les doublons (même titre, même artiste) venus des compilations et rééditions.
      const seen = new Set();
      const results = (await source(q, limit)).filter((x) => {
        const k = (x.title + '|' + x.artist).toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).slice(0, limit);
      if (results.length) return json({ results });
    } catch {
      // on passe à la source suivante
    }
  }
  return json({ results: [] }, 200, 'public, max-age=300');
};

export const config = { path: '/api/search' };
