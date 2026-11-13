// Kaynakta koordinatı olmayan eczaneler için konum bulma:
// 1) önceki günlerden önbellek  2) OpenStreetMap'te aynı adlı eczane  3) Nominatim adres arama (sınırlı)
import { inTurkey } from './html.mjs';
import { keyWords, normalizeTr, sameWords } from './text.mjs';
import { sleep } from './time.mjs';

const NOMINATIM_URL = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search';
const MISS_RETRY_MS = 14 * 86_400_000;

export function cacheKey(plaka, p) {
  return `${plaka}|${[...keyWords(p.name)].sort().join(' ')}|${normalizeTr(p.district ?? '')}`;
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const r = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2;
  return 12_742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function matchOsm(p, osmRows) {
  if (!osmRows?.length) return null;
  const words = keyWords(p.name);
  if (words.size === 0) return null;
  const candidates = osmRows.filter((row) => sameWords(words, keyWords(row[2])));
  if (candidates.length === 0) return null;
  const district = normalizeTr(p.district ?? '');
  if (district && district !== 'merkez') {
    const inDistrict = candidates.filter((row) => normalizeTr(`${row[6]} ${row[3]}`).includes(district));
    if (inDistrict.length === 1) return inDistrict[0];
    if (inDistrict.length > 1) return null;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

async function nominatim(query, userAgent, email) {
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=tr&accept-language=tr&q=${encodeURIComponent(query)}${
    email ? `&email=${encodeURIComponent(email)}` : ''
  }`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const list = await res.json();
  const first = Array.isArray(list) ? list[0] : null;
  if (!first) return null;
  const lat = parseFloat(first.lat);
  const lon = parseFloat(first.lon);
  return inTurkey(lat, lon) ? [lat, lon] : null;
}

/**
 * pharmacies dizisindeki eksik koordinatları yerinde doldurur.
 * budget: { nominatimLeft: number }  — Nominatim kullanım kurallarına uymak için çalışma başına sınır.
 */
export async function resolveCoordinates(province, pharmacies, { geocache, osmRows, budget, userAgent, email, log }) {
  const stats = { source: 0, cache: 0, osm: 0, nominatim: 0, missing: 0 };
  const now = Date.now();

  for (const p of pharmacies) {
    const key = cacheKey(province.plaka, p);
    if (typeof p.lat === 'number' && typeof p.lon === 'number') {
      geocache[key] = { lat: p.lat, lon: p.lon, src: 'kaynak', t: now };
      stats.source++;
      continue;
    }
    const cached = geocache[key];
    if (cached && typeof cached.lat === 'number') {
      p.lat = cached.lat;
      p.lon = cached.lon;
      if (cached.src === 'nominatim') p.approx = true;
      stats.cache++;
      continue;
    }
    const osm = matchOsm(p, osmRows);
    if (osm) {
      p.lat = osm[0];
      p.lon = osm[1];
      geocache[key] = { lat: p.lat, lon: p.lon, src: 'osm', t: now };
      stats.osm++;
      continue;
    }
    if (cached?.miss && now - cached.t < MISS_RETRY_MS) {
      stats.missing++;
      continue;
    }
    if (budget.nominatimLeft > 0 && p.address) {
      budget.nominatimLeft--;
      try {
        const queries = [
          [p.address, p.district, province.name, 'Türkiye'].filter(Boolean).join(', '),
          [p.address.replace(/\bNo\s*[:.]?\s*\S+/gi, '').replace(/\s+/g, ' '), p.district, province.name].filter(Boolean).join(', '),
        ];
        let found = null;
        for (const q of queries) {
          found = await nominatim(q, userAgent, email);
          await sleep(1100); // en fazla 1 istek/saniye
          if (found) break;
        }
        // Akıl sağlığı kontrolü: ildeki diğer eczanelere çok uzak olmasın
        if (found && osmRows?.length) {
          const nearest = Math.min(...osmRows.slice(0, 400).map((r) => distanceKm(found[0], found[1], r[0], r[1])));
          if (nearest > 40) found = null;
        }
        if (found) {
          p.lat = found[0];
          p.lon = found[1];
          p.approx = true;
          geocache[key] = { lat: p.lat, lon: p.lon, src: 'nominatim', t: now };
          stats.nominatim++;
          continue;
        }
        geocache[key] = { miss: true, t: now };
      } catch (e) {
        log?.(`  Nominatim hatası: ${e.message}`);
      }
    }
    stats.missing++;
  }
  return stats;
}
