// Türkiye saati: UTC+3, yaz saati yok.
const OFFSET = 3 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');

export function trParts(date = new Date()) {
  const d = new Date(date.getTime() + OFFSET);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
  };
}

export function dateKey(p) {
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

export function addDays(key, days) {
  const { y, m, d } = parseKey(key);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

export function todayKey(now = new Date()) {
  return dateKey(trParts(now));
}

/** e-Devlet formu için: "13/11/2026" */
export function edevletDate(key) {
  const { y, m, d } = parseKey(key);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** Türkiye saatindeki yerel tarih/saat → ISO (UTC) */
export function trToIso(y, m, d, h = 0, min = 0) {
  const t = Date.UTC(y, m - 1, d, h, min) - OFFSET;
  return new Date(t).toISOString();
}

/**
 * "13/11/2026 08:30", "13.11.2026 08:30:00", "2026-11-13 08:30" veya yalnızca "08:30"
 * metnini ISO'ya çevirir. Yalnızca saat varsa `baseKey` tarihi kullanılır.
 */
export function parseTrDateTime(text, baseKey) {
  const s = String(text ?? '').trim();
  if (!s) return undefined;
  let m = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\D+(\d{1,2})[:.](\d{2}))?/);
  if (m) return trToIso(+m[3], +m[2], +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return trToIso(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  m = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (m && baseKey) {
    const { y, m: mo, d } = parseKey(baseKey);
    return trToIso(y, mo, d, +m[1], +m[2]);
  }
  return undefined;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
