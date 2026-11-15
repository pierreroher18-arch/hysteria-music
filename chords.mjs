// Grille d'accords avec paroles d'un morceau, récupérée à la demande sur Ultimate Guitar
// (la version « Chords » la mieux notée). Rien n'est enregistré dans les données du groupe.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TAB_HOST = /^https:\/\/tabs\.ultimate-guitar\.com\//;

const json = (body, status, cache) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': cache.browser,
      ...(cache.cdn ? { 'netlify-cdn-cache-control': cache.cdn } : {}),
    },
  });
const FOUND = { browser: 'public, max-age=86400', cdn: 'public, durable, max-age=2592000, stale-while-revalidate=604800' };
const MISSING = { browser: 'public, max-age=3600', cdn: 'public, durable, max-age=86400' };
const NOSTORE = { browser: 'no-store' };

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function decode(s) {
  return s
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

// Les pages d'Ultimate Guitar embarquent leurs données en JSON dans <div class="js-store" data-content="…">.
function storeOf(html) {
  const m = html.match(/<div[^>]*class="js-store"[^>]*data-content="([^"]*)"/) || html.match(/<div[^>]*data-content="([^"]*)"[^>]*class="js-store"/);
  if (!m) return null;
  try { return JSON.parse(decode(m[1])); } catch { return null; }
}
const pageData = (st) => (st && st.store && st.store.page && st.store.page.data) || null;

async function get(url) {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(7000),
  });
  if (!r.ok) { const e = new Error('http ' + r.status); e.blocked = r.status === 403 || r.status === 429 || r.status === 503; throw e; }
  return r.text();
}

function pick(results, artist, title) {
  const a = norm(artist), t = norm(title);
  const a1 = a.split(' ').find((w) => w.length > 2) || a;
  const scored = (Array.isArray(results) ? results : [])
    .filter((r) => r && r.type === 'Chords' && TAB_HOST.test(r.tab_url || ''))
    .map((r) => {
      const rt = norm(r.song_name), ra = norm(r.artist_name);
      const titleOk = rt === t || rt.startsWith(t) || t.startsWith(rt);
      const artistOk = !!a1 && ra.includes(a1);
      const score = (titleOk ? 20 : 0) + (artistOk ? 20 : 0) + (Number(r.rating) || 0) * Math.log10((Number(r.votes) || 0) + 1);
      return { r, score, ok: titleOk && artistOk };
    })
    .filter((x) => x.ok)
    .sort((x, y) => y.score - x.score);
  return scored.length ? scored[0].r : null;
}

export default async (req) => {
  const p = new URL(req.url).searchParams;
  const title = (p.get('title') || '').trim().slice(0, 150);
  const artist = (p.get('artist') || '').trim().slice(0, 150);
  if (!title || !artist) return json({ found: false }, 400, NOSTORE);

  try {
    const search = pageData(storeOf(await get(`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(`${artist} ${title}`)}`)));
    if (!search) return json({ found: false, error: 'format' }, 502, NOSTORE);
    const best = pick(search.results, artist, title);
    if (!best) return json({ found: false }, 200, MISSING);

    const d = pageData(storeOf(await get(best.tab_url)));
    const view = (d && d.tab_view) || {};
    const content = view.wiki_tab && typeof view.wiki_tab.content === 'string' ? view.wiki_tab.content : '';
    if (!content.trim()) return json({ found: false, error: 'format' }, 502, NOSTORE);
    const meta = view.meta || {};
    const tuning = meta.tuning && (meta.tuning.name || meta.tuning.value);
    return json({
      found: true,
      content: content.replace(/\r\n?/g, '\n').slice(0, 60000),
      capo: Number(meta.capo) || 0,
      tuning: typeof tuning === 'string' ? tuning : '',
      key: (d.tab && d.tab.tonality_name) || best.tonality_name || '',
      version: Number(best.version) || 1,
      rating: Math.round((Number(best.rating) || 0) * 10) / 10,
      votes: Number(best.votes) || 0,
      url: best.tab_url,
      source: 'Ultimate Guitar',
    }, 200, FOUND);
  } catch (e) {
    return json({ found: false, error: e && e.blocked ? 'blocked' : 'source' }, 502, NOSTORE);
  }
};

export const config = { path: '/api/chords' };
