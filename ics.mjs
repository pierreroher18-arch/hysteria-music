// Fichier .ics pour ajouter une répète ou un concert à l'agenda du téléphone,
// avec un rappel la veille. Ne lit aucune donnée du groupe : il met en forme ce qu'on lui envoie.

const clean = (s, n) => String(s || '').replace(/\r\n?/g, '\n').slice(0, n);
const text = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// Lignes de 75 octets au plus, comme le veut le format.
function fold(line) {
  const enc = new TextEncoder();
  let out = '', cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 74) { out += cur + '\r\n '; cur = ''; bytes = 1; }
    cur += ch;
    bytes += b;
  }
  return out + cur;
}

const pad = (n) => String(n).padStart(2, '0');
// Heure « flottante » : l'heure locale du téléphone, sans fuseau.
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;

export default async (req) => {
  const p = new URL(req.url).searchParams;
  const date = p.get('d') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Date manquante', { status: 400 });
  const time = /^\d{2}:\d{2}$/.test(p.get('h') || '') ? p.get('h') : '20:00';
  const dur = Math.min(720, Math.max(30, Number(p.get('dur')) || 180));
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const end = new Date(start.getTime() + dur * 60000);
  const title = clean(p.get('t'), 120) || 'Hysteria';
  const place = clean(p.get('loc'), 160);
  const desc = clean(p.get('desc'), 1500);
  const id = (p.get('id') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || `${date}-${time.replace(':', '')}`;
  const now = new Date();
  const utc = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hysteria//Planning//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${id}@hysteria`,
    `DTSTAMP:${utc}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(title)}`,
    place && `LOCATION:${text(place)}`,
    desc && `DESCRIPTION:${text(desc)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(title)} demain`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).map(fold);

  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="hysteria-${date}.ics"`,
      'cache-control': 'no-store',
    },
  });
};

export const config = { path: '/api/ics' };
