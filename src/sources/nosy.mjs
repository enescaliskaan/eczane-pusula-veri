// Yedek kaynak: NosyAPI (ayda 500 ücretsiz kredi). Yalnızca e-Devlet'te boş kalan iller için kullanılır.
import { getJson } from '../http.mjs';
import { normalizeLatLon } from '../html.mjs';
import { cleanPhone, cleanSpaces, titleCaseTr } from '../text.mjs';
import { dateKey, trParts } from '../time.mjs';

const BASE = 'https://www.nosyapi.com/apiv2/service/pharmacies-on-duty';

function parseTr(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return undefined;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+03:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

export async function fetchNosy(province, apiKey) {
  const json = await getJson(`${BASE}?city=${encodeURIComponent(province.slug)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const status = String(json?.status ?? '').toLowerCase();
  if (status && status !== 'success') {
    return { status: 'error', pharmacies: [], message: String(json?.messageTR ?? json?.message ?? 'NosyAPI hatası') };
  }
  const list = Array.isArray(json?.data) ? json.data : [];
  const pharmacies = list
    .map((raw) => {
      const name = titleCaseTr(String(raw.pharmacyName ?? ''));
      if (!name) return null;
      const coords = normalizeLatLon(raw.latitude, raw.longitude);
      return {
        name,
        district: titleCaseTr(String(raw.district ?? '')) || undefined,
        address: cleanSpaces(raw.address ?? ''),
        phone: cleanPhone(String(raw.phone ?? '')),
        directions: cleanSpaces(raw.directions ?? '') || undefined,
        lat: coords?.[0],
        lon: coords?.[1],
        dutyStart: parseTr(raw.pharmacyDutyStart),
        dutyEnd: parseTr(raw.pharmacyDutyEnd),
        city: province.name,
      };
    })
    .filter(Boolean);

  const firstStart = pharmacies.find((p) => p.dutyStart)?.dutyStart;
  const key = firstStart ? dateKey(trParts(new Date(firstStart))) : undefined;
  return { status: pharmacies.length ? 'ok' : 'empty', pharmacies, dateKey: key };
}
