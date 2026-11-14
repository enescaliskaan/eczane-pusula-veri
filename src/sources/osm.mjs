// Tüm eczaneler (nöbetçi olmayanlar dahil): OpenStreetMap — lisans ODbL (atıf zorunlu)
import { getJson } from '../http.mjs';
import { ensurePharmacyName, uniqueJoin } from '../osm-util.mjs';
import { cleanPhone } from '../text.mjs';
import { sleep } from '../time.mjs';

const ENDPOINTS = (process.env.OVERPASS_URLS ?? 'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const UA = `NobetciEczanemVeri/1.0 (+https://github.com/${process.env.GITHUB_REPOSITORY ?? 'eczane-pusula-veri'})`;

export const OSM_ATTRIBUTION = '© OpenStreetMap katkıda bulunanlar (ODbL)';

const round = (n) => Math.round(n * 1e5) / 1e5;

/** Overpass öğesi → kompakt satır: [enlem, boylam, ad, adres, telefon, çalışma saatleri, ilçe] */
export function toRow(el) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const t = el.tags ?? {};
  const rawName = t.name ?? t['name:tr'];
  const house = t['addr:housenumber'];
  const street = [t['addr:street'], house ? `No:${house}` : undefined].filter(Boolean).join(' ');
  const district = t['addr:district'] ?? t['addr:county'] ?? '';
  const address = uniqueJoin([t['addr:neighbourhood'] ?? t['addr:suburb'], street, district, t['addr:city']]);
  const phone = (t.phone ?? t['contact:phone'] ?? '').split(';')[0]?.trim();
  return [
    round(lat),
    round(lon),
    rawName ? ensurePharmacyName(rawName) : 'Eczane',
    address,
    phone ? cleanPhone(phone) ?? '' : '',
    t.opening_hours ?? '',
    district,
  ];
}

async function overpass(query, timeoutMs) {
  let lastError;
  for (const endpoint of ENDPOINTS) {
    try {
      return await getJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': UA },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs,
      });
    } catch (e) {
      lastError = e;
      await sleep(4000);
    }
  }
  throw lastError ?? new Error('Overpass yanıt vermedi');
}

/** Tek il (yedek yol). */
export async function fetchOsmProvince(province) {
  const query = `[out:json][timeout:90];area["ISO3166-2"="${province.iso}"]->.a;(node["amenity"="pharmacy"](area.a);way["amenity"="pharmacy"](area.a););out center tags;`;
  const json = await overpass(query, 100_000);
  return (json.elements ?? []).map(toRow).filter(Boolean);
}

/**
 * 81 il tek sorguda: her il için önce il alanı (etiketleriyle), ardından o ildeki eczaneler gelir.
 * İl başına ayrı sorgudan çok daha hızlı ve sunucuya daha az yük.
 */
export const NATIONWIDE_QUERY = `[out:json][timeout:600];
area["ISO3166-2"~"^TR-[0-9][0-9]$"]->.provs;
foreach.provs->.p(
  .p out tags;
  (node["amenity"="pharmacy"](area.p);way["amenity"="pharmacy"](area.p););
  out center tags;
);`;

/** Yanıtı il koduna göre ayırır: Map<"TR-45", rows[]> */
export function splitNationwide(json) {
  const byIso = new Map();
  let current = null;
  for (const el of json.elements ?? []) {
    if (el.type === 'area') {
      const iso = el.tags?.['ISO3166-2'];
      current = typeof iso === 'string' && /^TR-\d\d$/.test(iso) ? iso : null;
      if (current && !byIso.has(current)) byIso.set(current, []);
      continue;
    }
    if (!current) continue;
    const row = toRow(el);
    if (row) byIso.get(current).push(row);
  }
  return byIso;
}

export async function fetchOsmNationwide() {
  return splitNationwide(await overpass(NATIONWIDE_QUERY, 660_000));
}
