// Relais des pochettes (Deezer, iTunes) pour que l'appli puisse en tirer la couleur dominante.
const ALLOWED = [/(^|\.)dzcdn\.net$/, /(^|\.)mzstatic\.com$/];

export default async (req) => {
  let target;
  try {
    target = new URL(new URL(req.url).searchParams.get('u') || '');
  } catch {
    return new Response('Adresse invalide', { status: 400 });
  }
  if (target.protocol !== 'https:' || !ALLOWED.some((r) => r.test(target.hostname))) {
    return new Response('Source non autorisée', { status: 403 });
  }
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(5000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return new Response('Image introuvable', { status: 502 });
    return new Response(r.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800' } });
  } catch {
    return new Response('Image introuvable', { status: 502 });
  }
};

export const config = { path: '/api/cover' };
