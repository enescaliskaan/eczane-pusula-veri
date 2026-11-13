// Tüm eczaneler (nöbetçi olmayanlar dahil): OpenStreetMap — lisans ODbL (atıf zorunlu)
import { getJson } from '../http.mjs';
import { ensurePharmacyName, uniqueJoin } from '../osm-util.mjs';
import { cleanPhone } from '../text.mjs';
import { sleep } from '../time.mjs';

const ENDPOINTS = (process.env.OVERPASS_URLS ?? 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const OSM_ATTRIBUTION = '© OpenStreetMap katkıda bulunanlar (ODbL)';

const round = (n) => Math.round(n * 1e5) / 1e5;

/**
 * Bir ilin tüm eczaneleri. Kompakt biçim (dosya küçük kalsın diye):
 * [enlem, boylam, ad, adres, telefon, çalışma saatleri, ilçe]
 */
export async function fetchOsmProvince(province) {
  const query = `[out:json][timeout:180];area["ISO3166-2"="${province.iso}"]->.a;(node["amenity"="pharmacy"](area.a);way["amenity"="pharmacy"](area.a););out center tags;`;
  let lastError;
  for (const endpoint of ENDPOINTS) {
    try {
      const json = await getJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 200_000,
      });
      const rows = [];
      for (const el of json.elements ?? []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (typeof lat !== 'number' || typeof lon !== 'number') continue;
        const t = el.tags ?? {};
        const rawName = t.name ?? t['name:tr'];
        const house = t['addr:housenumber'];
        const street = [t['addr:street'], house ? `No:${house}` : undefined].filter(Boolean).join(' ');
        const district = t['addr:district'] ?? t['addr:county'] ?? '';
        const address = uniqueJoin([t['addr:neighbourhood'] ?? t['addr:suburb'], street, district, t['addr:city']]);
        const phone = (t.phone ?? t['contact:phone'] ?? '').split(';')[0]?.trim();
        rows.push([
          round(lat),
          round(lon),
          rawName ? ensurePharmacyName(rawName) : 'Eczane',
          address,
          phone ? cleanPhone(phone) ?? '' : '',
          t.opening_hours ?? '',
          district,
        ]);
      }
      return rows;
    } catch (e) {
      lastError = e;
      await sleep(5000);
    }
  }
  throw lastError ?? new Error('Overpass yanıt vermedi');
}
