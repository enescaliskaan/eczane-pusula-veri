// İzmir Büyükşehir Belediyesi Açık Veri Portalı — lisans: CC BY 4.0 (atıf zorunlu)
import { getJson } from '../http.mjs';
import { normalizeLatLon } from '../html.mjs';
import { cleanPhone, cleanSpaces, titleCaseTr } from '../text.mjs';
import { todayKey } from '../time.mjs';

export const IZMIR_URL = process.env.IZMIR_URL ?? 'https://openapi.izmir.bel.tr/api/ibb/nobetcieczaneler';
export const IZMIR_ATTRIBUTION = 'İzmir Büyükşehir Belediyesi Açık Veri Portalı (CC BY 4.0)';

/** Büyük/küçük harf ve alt çizgiden bağımsız alan okuma: field(item, 'LokasyonX') ↔ LOKASYON_X */
function field(item, ...names) {
  const wanted = names.map((n) => n.toLowerCase().replace(/_/g, ''));
  for (const [key, value] of Object.entries(item)) {
    if (wanted.includes(key.toLowerCase().replace(/_/g, ''))) return value;
  }
  return undefined;
}

function findArray(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const value of Object.values(json)) if (Array.isArray(value)) return value;
  }
  return [];
}

export function parseIzmir(json) {
  return findArray(json)
    .filter((x) => x && typeof x === 'object')
    .map((item) => {
      const name = titleCaseTr(String(field(item, 'Adi', 'EczaneAdi', 'Name') ?? ''));
      if (!name) return null;
      const coords = normalizeLatLon(field(item, 'LokasyonX', 'Enlem', 'Lat'), field(item, 'LokasyonY', 'Boylam', 'Lon'));
      return {
        name,
        district: titleCaseTr(String(field(item, 'Bolge', 'Ilce') ?? '')) || undefined,
        address: cleanSpaces(field(item, 'Adres') ?? ''),
        phone: cleanPhone(String(field(item, 'Telefon') ?? '')),
        directions: cleanSpaces(field(item, 'BolgeAciklama', 'Aciklama') ?? '') || undefined,
        lat: coords?.[0],
        lon: coords?.[1],
        city: 'İzmir',
        _date: String(field(item, 'Tarih') ?? ''),
      };
    })
    .filter(Boolean);
}

/** İzmir'in bugünkü nöbetçi listesi. */
export async function fetchIzmir() {
  const json = await getJson(IZMIR_URL);
  const items = parseIzmir(json);
  if (items.length === 0) return { status: 'empty', pharmacies: [], dateKey: todayKey() };
  const m = items[0]._date.match(/(\d{4})-(\d{2})-(\d{2})/);
  const dateKey = m ? `${m[1]}-${m[2]}-${m[3]}` : todayKey();
  for (const p of items) delete p._date;
  return { status: 'ok', pharmacies: items, dateKey };
}
