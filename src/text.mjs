const MAP = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

export function normalizeTr(text) {
  return String(text ?? '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (ch) => MAP[ch] ?? ch)
    .replace(/̇/g, '');
}

export function slugTr(text) {
  return normalizeTr(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function cleanSpaces(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['eczanesi', 'eczane', 'ecz', 'eczanes', 'pharmacy', 've', 'nobetci']);

export function keyWords(name) {
  return new Set(
    normalizeTr(name)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

export function sameWords(a, b) {
  if (a.size === 0 || a.size !== b.size) return false;
  for (const w of a) if (!b.has(w)) return false;
  return true;
}

/** "ŞİFA ECZANESİ" → "Şifa Eczanesi" */
export function titleCaseTr(text) {
  const s = cleanSpaces(text);
  if (!s) return s;
  const lettersOnly = s.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '');
  const isUpper = lettersOnly.length > 0 && lettersOnly === lettersOnly.toLocaleUpperCase('tr-TR');
  if (!isUpper) return s;
  return s
    .toLocaleLowerCase('tr-TR')
    .split(' ')
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w))
    .join(' ');
}

export function ensurePharmacyName(name) {
  const n = normalizeTr(name);
  if (n.includes('eczane') || n.includes('ecz.')) return name;
  return `${name} Eczanesi`;
}

/** Kısa, kararlı kimlik (FNV-1a 32 bit) */
export function hashId(text) {
  let h = 0x811c9dc5;
  const s = normalizeTr(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Türkiye telefon numarası: (+90) 0 (2xx-5xx) xxx xx xx — ayırıcılar isteğe bağlı.
// Hücrede nöbet saati/tarihi gibi başka rakamlar da olabilir; yalnızca ilk numarayı alır.
const PHONE_RE = /(?:\+?\s*90[\s.-]*)?\(?\s*0?\s*\(?\s*([2-5]\d{2})\s*\)?[\s.-]*(\d{3})[\s.-]*(\d{2})[\s.-]*(\d{2})/;

/** Metindeki ilk telefon numarası → "0 (236) 237 10 08"; bulunamazsa undefined. */
export function extractPhone(raw) {
  const s = cleanSpaces(raw);
  if (!s) return undefined;
  const m = s.match(PHONE_RE);
  return m ? `0 (${m[1]}) ${m[2]} ${m[3]} ${m[4]}` : undefined;
}

export function cleanPhone(raw) {
  return extractPhone(raw);
}

/** Büyük harfli adresi okunur yapar; "NO:186/A" gibi kısımları korur. */
export function prettyAddress(text) {
  const s = titleCaseTr(text);
  return s
    .replace(/([^\s])\.(?=no\s*[:.])/gi, '$1. ')
    .replace(/\b(no|kat|daire)\s*[:.]\s*/gi, (m, w) => `${w.charAt(0).toUpperCase()}${w.slice(1).toLowerCase()}:`)
    .replace(/\/\s*([a-zçğıöşü])/g, (m, c) => `/${c.toLocaleUpperCase('tr-TR')}`).replace(/\bMah\b\.?/g, 'Mah.').replace(/\bCad\b\.?/g, 'Cad.').replace(/\bSok\b\.?/g, 'Sok.')
    .replace(/(\d\s*\/?\s*)([a-zçğıöşü])(?![a-zçğıöşü])/g, (m, a, b) => a + b.toLocaleUpperCase('tr-TR'));
}
