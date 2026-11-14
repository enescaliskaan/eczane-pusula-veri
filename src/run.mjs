// Nöbetçi eczane verisini toplar ve statik JSON olarak yazar.
// Kullanım: node src/run.mjs --out public [--only 34,6] [--no-osm] [--no-nominatim]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveCoordinates } from './coords.mjs';
import { Session, withRetry } from './http.mjs';
import { PROVINCES } from './provinces.mjs';
import { fetchEdevlet } from './sources/edevlet.mjs';
import { fetchIzmir, IZMIR_ATTRIBUTION } from './sources/izmir.mjs';
import { fetchNosy } from './sources/nosy.mjs';
import { fetchOsmNationwide, fetchOsmProvince, OSM_ATTRIBUTION } from './sources/osm.mjs';
import { hashId } from './text.mjs';
import { addDays, sleep, todayKey, trParts } from './time.mjs';

// ---------- Ayarlar ----------
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = path.resolve(arg('--out') ?? 'public');
const ONLY = arg('--only')
  ?.split(',')
  .map((s) => parseInt(s, 10))
  .filter(Number.isFinite);
const NO_OSM = args.includes('--no-osm');
const NO_NOMINATIM = args.includes('--no-nominatim');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const EDEVLET_DELAY_MS = Number(env('EDEVLET_DELAY_MS', 1500));
const NOSY_KEY = env('NOSY_API_KEY', '');
const NOSY_MAX = Number(env('NOSY_MAX_PER_RUN', 12));
const OSM_MAX = Number(env('OSM_MAX_PER_RUN', 81));
const OSM_BUDGET_MS = Number(env('OSM_BUDGET_MIN', 18)) * 60_000;
const OSM_MAX_AGE_MS = Number(env('OSM_MAX_AGE_DAYS', 7)) * 86_400_000;
const NOMINATIM_MAX = NO_NOMINATIM ? 0 : Number(env('NOMINATIM_MAX_PER_RUN', 400));
const CONTACT = env('CONTACT_EMAIL', '');
const REPO = env('GITHUB_REPOSITORY', 'eczane-pusula-veri');
const GEO_UA = `NobetciEczanemVeri/1.0 (+https://github.com/${REPO})${CONTACT ? ` ${CONTACT}` : ''}`;

const V1 = path.join(OUT, 'v1');
const log = (...m) => console.log(...m);

// ---------- Yardımcılar ----------
async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}

/** Şu an geçerli nöbet günü (sabah 08:30'dan önce önceki gün) */
function dutyDateKey(now = new Date()) {
  const p = trParts(now);
  const today = todayKey(now);
  return p.h * 60 + p.min >= 8 * 60 + 30 ? today : addDays(today, -1);
}

function finalize(province, pharmacies, dateKey) {
  const seen = new Set();
  const out = [];
  for (const p of pharmacies) {
    const id = hashId(`${province.plaka}|${p.name}|${p.district ?? ''}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const item = { id, name: p.name };
    if (p.district) item.district = p.district;
    item.address = p.address ?? '';
    if (p.phone) item.phone = p.phone;
    if (typeof p.lat === 'number' && typeof p.lon === 'number') {
      item.lat = Math.round(p.lat * 1e6) / 1e6;
      item.lon = Math.round(p.lon * 1e6) / 1e6;
      if (p.approx) item.approx = true;
    }
    if (p.dutyStart) item.dutyStart = p.dutyStart;
    if (p.dutyEnd) item.dutyEnd = p.dutyEnd;
    if (p.directions) item.directions = p.directions;
    out.push(item);
  }
  out.sort(
    (a, b) => (a.district ?? '').localeCompare(b.district ?? '', 'tr') || a.name.localeCompare(b.name, 'tr'),
  );
  return { date: dateKey, pharmacies: out };
}

function bounds(points) {
  if (points.length === 0) return null;
  const lats = points.map((p) => p[0]).sort((a, b) => a - b);
  const lons = points.map((p) => p[1]).sort((a, b) => a - b);
  // Uç değerleri at (yanlış etiketlenmiş noktalar kutuyu büyütmesin)
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(f * (arr.length - 1))))];
  const r = (n) => Math.round(n * 1e4) / 1e4;
  return {
    bbox: [r(q(lats, 0.01)), r(q(lons, 0.01)), r(q(lats, 0.99)), r(q(lons, 0.99))],
    center: [r(q(lats, 0.5)), r(q(lons, 0.5))],
  };
}

function statusPage(report) {
  const rows = report.provinces
    .map(
      (p) =>
        `<tr class="${p.count ? '' : 'bos'}"><td>${String(p.plaka).padStart(2, '0')}</td><td>${p.name}</td><td>${p.count}</td><td>${
          p.source ?? '-'
        }</td><td>${p.note ?? ''}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nöbetçi Eczanem Veri</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#0b0d11;color:#e8eaed}table{border-collapse:collapse;width:100%;max-width:820px}td,th{padding:6px 8px;border-bottom:1px solid #2a2f36;text-align:left}tr.bos td{color:#ff6b75}h1{color:#ff3b4a;font-size:20px}small{color:#9aa4ae}</style></head>
<body><h1>Nöbetçi Eczanem — veri durumu</h1><p><small>Son çalışma: ${report.finishedAt} · Nöbet günü: ${report.dutyDate} · Dolu il: ${
    report.filled
  }/81</small></p><table><tr><th>Plaka</th><th>İl</th><th>Nöbetçi</th><th>Kaynak</th><th>Not</th></tr>${rows}</table>
<p><small>Kaynaklar: T.C. Sağlık Bakanlığı TİTCK (e-Devlet), ${IZMIR_ATTRIBUTION}, NosyAPI, ${OSM_ATTRIBUTION}.</small></p></body></html>`;
}

// ---------- Ana akış ----------
async function main() {
  const startedAt = new Date();
  const today = todayKey(startedAt);
  const dates = [today, addDays(today, 1)];
  const dutyDate = dutyDateKey(startedAt);
  const provinces = ONLY?.length ? PROVINCES.filter((p) => ONLY.includes(p.plaka)) : PROVINCES;

  log(`Başlangıç: ${startedAt.toISOString()} · Bugün: ${today} · İl sayısı: ${provinces.length}`);

  const geocacheFile = path.join(OUT, 'cache', 'geocode.json');
  const geocache = await readJson(geocacheFile, {});
  // Toplam süre GitHub'ın iş süresi sınırını aşmasın: adres aramaları en geç 55. dakikada durur
  const budget = { nominatimLeft: NOMINATIM_MAX, nosyLeft: NOSY_KEY ? NOSY_MAX : 0, deadline: Date.now() + 55 * 60_000 };

  // 1) OpenStreetMap: eski/eksik illeri yenile (çalışma başına sınırlı)
  const osmData = new Map();
  for (const p of provinces) {
    osmData.set(p.plaka, await readJson(path.join(V1, 'osm', `${p.code}.json`), null));
  }
  if (!NO_OSM) {
    const stale = provinces
      .map((p) => ({ p, age: osmData.get(p.plaka)?.updatedAt ? Date.now() - Date.parse(osmData.get(p.plaka).updatedAt) : Infinity }))
      .filter((x) => x.age > OSM_MAX_AGE_MS)
      .sort((a, b) => b.age - a.age)
      .slice(0, OSM_MAX);
    const osmStarted = Date.now();
    const saveOsm = async (p, rows) => {
      const data = { v: 1, plaka: p.plaka, il: p.name, updatedAt: new Date().toISOString(), attribution: OSM_ATTRIBUTION, rows };
      await writeJson(path.join(V1, 'osm', `${p.code}.json`), data);
      osmData.set(p.plaka, data);
    };

    // Çok il eskiyse: 81 il tek sorguda (birkaç dakika)
    const done = new Set();
    if (stale.length >= 5) {
      try {
        log(`OSM: ${stale.length} il eski, tüm Türkiye tek sorguyla indiriliyor…`);
        const byIso = await fetchOsmNationwide();
        let total = 0;
        for (const { p } of stale) {
          const rows = byIso.get(p.iso);
          if (rows && rows.length > 0) {
            await saveOsm(p, rows);
            done.add(p.plaka);
            total += rows.length;
          }
        }
        log(`OSM tüm Türkiye: ${done.size} il, ${total} eczane (${Math.round((Date.now() - osmStarted) / 1000)} sn)`);
      } catch (e) {
        log(`OSM tüm Türkiye: HATA ${e.message} — il il denenecek`);
      }
    }

    // Kalanlar il il (süre sınırlı)
    for (const { p } of stale.filter((x) => !done.has(x.p.plaka))) {
      if (Date.now() - osmStarted > OSM_BUDGET_MS) {
        log(`OSM: süre doldu, kalan iller sonraki çalışmada.`);
        break;
      }
      try {
        const rows = await fetchOsmProvince(p);
        await saveOsm(p, rows);
        log(`OSM ${p.code} ${p.name}: ${rows.length} eczane`);
      } catch (e) {
        log(`OSM ${p.code} ${p.name}: HATA ${e.message}`);
      }
      await sleep(3000);
    }
  }

  // 2) Nöbetçi listeleri
  const session = new Session();
  const report = { startedAt: startedAt.toISOString(), dutyDate, provinces: [] };
  const indexItems = [];
  let edevletOk = 0;

  for (const province of provinces) {
    const file = path.join(V1, 'il', `${province.code}.json`);
    const prev = await readJson(file, null);
    const prevDays = new Map((prev?.days ?? []).map((d) => [d.date, d]));
    const fresh = new Map(); // date -> { source, pharmacies }
    const notes = [];

    // İzmir: belediye açık verisi (koordinatlı)
    if (province.plaka === 35) {
      try {
        const r = await withRetry(() => fetchIzmir(), { tries: 2 });
        if (r.status === 'ok') fresh.set(r.dateKey, { source: 'izmir', pharmacies: r.pharmacies });
      } catch (e) {
        notes.push(`İzmir BB: ${e.message}`);
      }
    }

    // e-Devlet: bugün ve yarın
    for (const dk of dates) {
      if (fresh.has(dk)) continue;
      try {
        const r = await withRetry(() => fetchEdevlet(session, province, dk), { tries: 2, delayMs: 3000 });
        if (r.status === 'ok') {
          fresh.set(dk, { source: 'edevlet', pharmacies: r.pharmacies });
          edevletOk++;
        } else if (r.status === 'error') {
          notes.push(`e-Devlet ${dk}: ${r.message}`);
        } else if (dk === today) {
          notes.push('e-Devlet: kayıt yok');
        }
      } catch (e) {
        notes.push(`e-Devlet ${dk}: ${e.message}`);
      }
      await sleep(EDEVLET_DELAY_MS);
    }

    // Yedek: NosyAPI (bugünün listesi hiçbir yerde yoksa)
    const hasCurrent = (k) => fresh.get(k)?.pharmacies.length || prevDays.get(k)?.pharmacies?.length;
    if (!hasCurrent(dutyDate) && !hasCurrent(today) && budget.nosyLeft > 0) {
      budget.nosyLeft--;
      try {
        const r = await fetchNosy(province, NOSY_KEY);
        if (r.status === 'ok') {
          fresh.set(r.dateKey ?? dutyDate, { source: 'nosyapi', pharmacies: r.pharmacies });
          notes.push('NosyAPI yedeği kullanıldı');
        } else {
          notes.push(`NosyAPI: ${r.message ?? 'boş'}`);
        }
      } catch (e) {
        notes.push(`NosyAPI: ${e.message}`);
      }
    }

    // Koordinatlar
    const osmRows = osmData.get(province.plaka)?.rows ?? [];
    const coordStats = { source: 0, cache: 0, osm: 0, nominatim: 0, missing: 0 };
    for (const [, day] of fresh) {
      const s = await resolveCoordinates(province, day.pharmacies, {
        geocache,
        osmRows,
        budget,
        userAgent: GEO_UA,
        email: CONTACT,
        log,
      });
      for (const k of Object.keys(coordStats)) coordStats[k] += s[k];
    }

    // Birleştir: yeni veri yalnızca doluysa eskisinin yerine geçer; dünden eskiler atılır
    const keepFrom = addDays(today, -1);
    const days = new Map();
    for (const [dk, d] of prevDays) if (dk >= keepFrom) days.set(dk, d);
    for (const [dk, d] of fresh) {
      if (d.pharmacies.length === 0) continue;
      days.set(dk, { ...finalize(province, d.pharmacies, dk), source: d.source, fetchedAt: new Date().toISOString() });
    }
    const dayList = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    const updatedAt = fresh.size > 0 ? new Date().toISOString() : (prev?.updatedAt ?? null);
    const current = days.get(dutyDate) ?? days.get(today) ?? null;
    const sources = [...new Set(dayList.map((d) => d.source))];

    const data = {
      v: 1,
      plaka: province.plaka,
      il: province.name,
      slug: province.slug,
      updatedAt,
      checkedAt: new Date().toISOString(),
      attribution: sources.includes('izmir') ? IZMIR_ATTRIBUTION : 'T.C. Sağlık Bakanlığı TİTCK (e-Devlet)',
      days: dayList,
    };
    await writeJson(file, data);

    // İndeks için bölge sınırları ve ilçeler
    const points = [
      ...osmRows.map((r) => [r[0], r[1]]),
      ...dayList.flatMap((d) => d.pharmacies.filter((p) => typeof p.lat === 'number').map((p) => [p.lat, p.lon])),
    ];
    const districts = [
      ...new Set(dayList.flatMap((d) => d.pharmacies.map((p) => p.district).filter(Boolean))),
    ].sort((a, b) => a.localeCompare(b, 'tr'));

    indexItems.push({
      plaka: province.plaka,
      name: province.name,
      slug: province.slug,
      count: current?.pharmacies.length ?? 0,
      source: current?.source ?? null,
      updatedAt,
      districts,
      osmUpdatedAt: osmData.get(province.plaka)?.updatedAt ?? null,
      osmCount: osmRows.length,
      ...(bounds(points) ?? {}),
    });

    const line = `${province.code} ${province.name.padEnd(15)} ${String(current?.pharmacies.length ?? 0).padStart(4)} eczane · ${
      current?.source ?? '-'
    } · konum: kaynak ${coordStats.source}, önbellek ${coordStats.cache}, osm ${coordStats.osm}, adres ${coordStats.nominatim}, yok ${coordStats.missing}${
      notes.length ? ` · ${notes.join(' | ')}` : ''
    }`;
    log(line);
    report.provinces.push({
      plaka: province.plaka,
      name: province.name,
      count: current?.pharmacies.length ?? 0,
      source: current?.source ?? null,
      coords: coordStats,
      note: notes.join(' | ') || undefined,
    });
  }

  // 3) İndeks, önbellek, rapor
  // --only ile çalışıldıysa diğer illerin indeks kayıtlarını koru
  const prevIndex = await readJson(path.join(V1, 'index.json'), { provinces: [] });
  const merged = new Map((prevIndex.provinces ?? []).map((p) => [p.plaka, p]));
  for (const item of indexItems) merged.set(item.plaka, item);
  const index = {
    v: 1,
    updatedAt: new Date().toISOString(),
    dutyDate,
    attribution: [`T.C. Sağlık Bakanlığı TİTCK (e-Devlet)`, IZMIR_ATTRIBUTION, OSM_ATTRIBUTION],
    provinces: [...merged.values()].sort((a, b) => a.plaka - b.plaka),
  };
  await writeJson(path.join(V1, 'index.json'), index);
  await writeJson(geocacheFile, geocache);

  report.finishedAt = new Date().toISOString();
  report.filled = index.provinces.filter((p) => p.count > 0).length;
  report.edevletOk = edevletOk;
  report.nosyUsed = (NOSY_KEY ? NOSY_MAX : 0) - budget.nosyLeft;
  report.nominatimUsed = NOMINATIM_MAX - budget.nominatimLeft;
  await writeJson(path.join(V1, 'rapor.json'), report);
  await writeFile(path.join(OUT, '.nojekyll'), '');
  await writeFile(
    path.join(OUT, 'index.html'),
    statusPage({ ...report, provinces: index.provinces.map((p) => ({ ...p, note: report.provinces.find((r) => r.plaka === p.plaka)?.note })) }),
  );

  log(`\nBitti. Dolu il: ${report.filled}/81 · e-Devlet başarılı sorgu: ${edevletOk} · NosyAPI: ${report.nosyUsed} · adres arama: ${report.nominatimUsed}`);

  // e-Devlet tamamen çalışmadıysa iş "başarısız" görünsün → GitHub e-posta ile haber verir
  if (edevletOk === 0 && provinces.some((p) => p.plaka !== 35)) {
    console.error('UYARI: e-Devlet\'ten hiç veri alınamadı. Sayfa yapısı değişmiş ya da erişim engellenmiş olabilir.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
