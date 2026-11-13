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

export function cleanPhone(raw) {
  const s = cleanSpaces(raw);
  if (!s) return undefined;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `0${digits}`.replace(/^0(\d{3})(\d{3})(\d{2})(\d{2})$/, '0 ($1) $2 $3 $4');
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.replace(/^0(\d{3})(\d{3})(\d{2})(\d{2})$/, '0 ($1) $2 $3 $4');
  }
  return s;
}
