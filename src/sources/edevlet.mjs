// Resmî kaynak: e-Devlet "TİTCK - Nöbetçi Eczane Sorgulama"
// Veriyi TEB bildirir, il sağlık müdürlükleri onaylar.
import { extractCoords, parseTables, stripTags } from '../html.mjs';
import { cleanPhone, cleanSpaces, normalizeTr, titleCaseTr } from '../text.mjs';
import { addDays, edevletDate, parseTrDateTime } from '../time.mjs';

export const EDEVLET_URL =
  process.env.EDEVLET_URL ?? 'https://www.turkiye.gov.tr/saglik-titck-nobetci-eczane-sorgulama';

const HTML_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.5',
};

export function findToken(html) {
  const s = String(html);
  const patterns = [
    /name=["']token["'][^>]*?value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*?name=["']token["']/i,
    /data-token=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

const COLUMN_RULES = [
  ['name', (h) => h.includes('eczane') || h === 'adi' || h.includes('eczane adi')],
  ['district', (h) => h.includes('ilce') || h.includes('semt') || h.includes('bolge')],
  ['address', (h) => h.includes('adres')],
  ['phone', (h) => h.includes('telefon') || h.includes('tel')],
  ['start', (h) => h.includes('basla') || h.includes('baslangic')],
  ['end', (h) => h.includes('bitis')],
  ['directions', (h) => h.includes('tarif') || h.includes('aciklama')],
];

function mapColumns(labels) {
  const map = {};
  labels.forEach((label, index) => {
    const h = normalizeTr(label ?? '');
    if (!h) return;
    for (const [key, test] of COLUMN_RULES) {
      if (map[key] === undefined && test(h)) {
        // "Eczane Adresi" hem eczane hem adres içerir → adres öncelikli
        if (key === 'name' && h.includes('adres')) continue;
        if (key === 'name' && h.includes('telefon')) continue;
        map[key] = index;
        break;
      }
    }
  });
  return map;
}

// Bilinen kaynak koddaki sıra (başlık bulunamazsa)
const FALLBACK_COLUMNS = { district: 0, name: 1, address: 2, phone: 3, start: 4, end: 5 };

const EMPTY_PATTERNS = [/kay[ıi]t bulunamad/i, /sonu[cç] bulunamad/i, /n[öo]bet[cç]i eczane bulunamad/i, /bilgi bulunamad/i];

/**
 * e-Devlet sonuç sayfasını ayrıştırır.
 * @returns {{ status: 'ok'|'empty'|'error', pharmacies: object[], message?: string }}
 */
export function parseEdevletResult(html, { dateKey, ilName }) {
  const tables = parseTables(html);
  let best = null;
  for (const t of tables) {
    if (t.rows.length === 0) continue;
    const headerMap = mapColumns(t.headers);
    const labelMap = mapColumns(t.rows[0].cells.map((c) => c.label ?? ''));
    const map = Object.keys(headerMap).length >= 2 ? headerMap : Object.keys(labelMap).length >= 2 ? labelMap : null;
    const score = (map ? 10 : 0) + t.rows.length;
    if (!best || score > best.score) best = { table: t, map, score };
  }

  const text = stripTags(html);
  if (!best) {
    if (EMPTY_PATTERNS.some((re) => re.test(text))) return { status: 'empty', pharmacies: [] };
    return { status: 'error', pharmacies: [], message: `Tablo bulunamadı: ${text.slice(0, 160)}` };
  }

  const cols = best.map ?? (best.table.rows[0].cells.length >= 6 ? FALLBACK_COLUMNS : null);
  if (!cols || cols.name === undefined) {
    return { status: 'error', pharmacies: [], message: 'Tablo sütunları tanınamadı.' };
  }

  const pharmacies = [];
  for (const row of best.table.rows) {
    const cell = (key) => (cols[key] !== undefined ? cleanSpaces(row.cells[cols[key]]?.text ?? '') : '');
    const name = titleCaseTr(cell('name'));
    if (!name || normalizeTr(name).includes('bulunamad')) continue;

    let dutyStart = parseTrDateTime(cell('start'), dateKey);
    let dutyEnd = parseTrDateTime(cell('end'), dateKey);
    // Bitiş yalnızca saat olarak gelip başlangıçtan önceyse ertesi güne aittir
    if (dutyStart && dutyEnd && Date.parse(dutyEnd) <= Date.parse(dutyStart) && /^\d{1,2}[:.]\d{2}$/.test(cell('end'))) {
      dutyEnd = parseTrDateTime(cell('end'), addDays(dateKey, 1));
    }
    if (dutyStart && dutyEnd && Date.parse(dutyEnd) <= Date.parse(dutyStart)) {
      dutyStart = undefined;
      dutyEnd = undefined;
    }

    const coords = extractCoords(row.html);
    pharmacies.push({
      name,
      district: titleCaseTr(cell('district')) || undefined,
      address: cell('address'),
      phone: cleanPhone(cell('phone')),
      directions: cell('directions') || undefined,
      lat: coords?.[0],
      lon: coords?.[1],
      dutyStart,
      dutyEnd,
      city: ilName,
    });
  }

  if (pharmacies.length === 0) {
    return EMPTY_PATTERNS.some((re) => re.test(text))
      ? { status: 'empty', pharmacies: [] }
      : { status: 'error', pharmacies: [], message: 'Tablo boş.' };
  }
  return { status: 'ok', pharmacies };
}

/** Bir il ve gün için e-Devlet'ten nöbetçi listesini çeker. */
export async function fetchEdevlet(session, province, dateKey) {
  const page = await session.get(EDEVLET_URL, HTML_HEADERS);
  if (!page.ok) return { status: 'error', pharmacies: [], message: `Sayfa açılamadı (HTTP ${page.status})` };
  const token = findToken(page.text);
  if (!token) return { status: 'error', pharmacies: [], message: 'Güvenlik anahtarı (token) bulunamadı.' };

  const form = new URLSearchParams({
    'ilkod-address-il': String(province.plaka),
    'ilkod-address-ilce': '',
    'ilkod-full': '',
    ilkod: String(province.plaka),
    nobetTarihi: edevletDate(dateKey),
    token,
    btn: 'Sorgula',
  });
  const origin = new URL(EDEVLET_URL).origin;
  const result = await session.post(`${EDEVLET_URL}?submit`, form, {
    ...HTML_HEADERS,
    Origin: origin,
    Referer: EDEVLET_URL,
  });
  if (!result.ok) return { status: 'error', pharmacies: [], message: `Sorgu başarısız (HTTP ${result.status})` };
  return parseEdevletResult(result.text, { dateKey, ilName: province.name });
}
