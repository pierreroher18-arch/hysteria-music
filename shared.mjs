// Code partagé entre le navigateur et la fonction Netlify.
// Modèle de données + application des modifications ("ops").

export const MEMBERS = [
  { id: 'achille', name: 'Achille', color: '#b5562f' },
  { id: 'quentin', name: 'Quentin', color: '#2f6f9a' },
  { id: 'mathieu', name: 'Mathieu', color: '#7c4f8e' },
  { id: 'pierre', name: 'Pierre', color: '#b98a12' },
];

export const LEVELS = [
  { v: 0, label: 'Pas commencé' },
  { v: 1, label: 'Je découvre' },
  { v: 2, label: 'En place' },
  { v: 3, label: 'Ça roule' },
  { v: 4, label: 'Prêt pour la scène' },
];

export const GEAR_CATS = [
  { id: 'guitares', label: 'Guitares' },
  { id: 'basses', label: 'Basses' },
  { id: 'batterie', label: 'Batterie et percus' },
  { id: 'claviers', label: 'Claviers' },
  { id: 'amplis', label: 'Amplis et baffles' },
  { id: 'effets', label: 'Pédales, multi-effets' },
  { id: 'micros', label: 'Micros' },
  { id: 'inears', label: 'In-ears et retours' },
  { id: 'sono', label: 'Sono, table de mixage, interface' },
  { id: 'cables', label: 'Câbles et multiprises' },
  { id: 'pieds', label: 'Pieds et stands' },
  { id: 'accessoires', label: 'Accessoires (cordes, piles, médiators…)' },
  { id: 'autre', label: 'Autre' },
];

export const DEFAULT_PLACE = 'La Vapeur';

export const TUNINGS = ['Standard', 'Demi-ton en dessous', 'Un ton en dessous', 'Drop D', 'Drop C♯', 'Drop C', 'Open G', 'Open D', 'DADGAD'];

const ROOTS = new Set(['songs', 'notes', 'events', 'gigs', 'gear', 'avail', 'members', 'log']);
// Racines où l'on peut créer un niveau intermédiaire (ex. avail/2026-11-20/pierre).
const FREE_ROOTS = new Set(['avail']);
const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_VALUE_CHARS = 20000;

export const ytMusic = (q) => 'https://music.youtube.com/search?q=' + encodeURIComponent(q);

// Tempo et tonalité relevés sur des sources publiques (karaoke-version, Musicnotes,
// Wikipedia…). Ceux laissés vides sont à compléter dans « Modifier ».
const SEED_SONGS = [
  ['Wonderwall', 'Oasis', 'F♯m', 87],
  ["Don't Look Back in Anger", 'Oasis', 'C', 82],
  ['Purple Rain', 'Prince', 'B♭', 58],
  ["Sweet Child O' Mine", "Guns N' Roses", 'D♭', 125],
  ["Knockin' on Heaven's Door", 'Bob Dylan', 'G', 70],
  ['Plug In Baby', 'Muse', 'Bm', 136],
  ['Hysteria', 'Muse', 'Am', 94],
  ['Cocaine', 'Eric Clapton', 'E', 105],
  ['Au cœur de la nuit', 'Téléphone', 'Em', 162],
  ['Umbrella', 'Rihanna', 'B♭m', 87],
  ['Éteins la lumière', 'Axel Bauer', 'Am', 145],
  ['You Shook Me All Night Long', 'AC/DC', 'G', 128],
  ['Highway to Hell', 'AC/DC', 'A', 116],
  ['Supersonic', 'Oasis', 'F♯m', 104],
  ["(I Can't Get No) Satisfaction", 'The Rolling Stones', 'E', 137],
  ["Jumpin' Jack Flash", 'The Rolling Stones', 'B', 138],
  ['Hey Joe', 'Jimi Hendrix', '', null],
  ['New York avec toi', 'Téléphone', '', null],
  ['La bombe humaine', 'Téléphone', '', null],
  ['The Art of Letting Go', 'Myles Kennedy', '', null],
  ['Yellow', 'Coldplay', '', null],
  ['Cake by the Ocean', 'DNCE', '', null],
  ["Don't Cry", "Guns N' Roses", '', null],
  ['Paradise City', "Guns N' Roses", 'F♯', 103],
];

export function seedState() {
  const songs = {};
  SEED_SONGS.forEach(([title, artist, key, bpm], i) => {
    const id = 's' + String(i + 1).padStart(2, '0');
    songs[id] = {
      id, title, artist, key, bpm,
      link: ytMusic(artist + ' ' + title),
      order: i + 1,
      levels: {},
    };
  });
  return { v: 2, songs, notes: {}, events: {}, gigs: {}, gear: {}, avail: {}, members: {}, log: {} };
}

export function newId(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function validPath(path) {
  return Array.isArray(path)
    && path.length >= 1 && path.length <= 5
    && path.every((k) => typeof k === 'string' && SAFE_KEY.test(k))
    && ROOTS.has(path[0]);
}

// Applique une liste d'ops sur l'état (le modifie sur place) et le renvoie.
// op = { op: 'set', path: [...], value } | { op: 'del', path: [...] }
export function applyOps(state, ops) {
  if (!Array.isArray(ops)) return state;
  for (const o of ops) {
    if (!o || !validPath(o.path)) continue;
    const path = o.path;
    // On ne recrée pas un élément supprimé par quelqu'un d'autre entre-temps.
    if (path.length > 2 && !FREE_ROOTS.has(path[0])) {
      const parent = state[path[0]] && state[path[0]][path[1]];
      if (!parent || typeof parent !== 'object') continue;
    }
    if (o.op === 'set') {
      if (o.value === undefined) continue;
      if (JSON.stringify(o.value).length > MAX_VALUE_CHARS) continue;
      let node = state;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (!node[k] || typeof node[k] !== 'object' || Array.isArray(node[k])) node[k] = {};
        node = node[k];
      }
      node[path[path.length - 1]] = o.value;
    } else if (o.op === 'del') {
      let node = state;
      for (let i = 0; i < path.length - 1; i++) {
        node = node && node[path[i]];
      }
      if (node && typeof node === 'object') delete node[path[path.length - 1]];
    }
  }
  return state;
}
